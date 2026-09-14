// lib/publish.js
// ============================================================================
// VELIX — PUBLISHING PIPELINE (the static/serverless architecture change)
//
// WHY THIS FILE EXISTS
// The public website used to be reachable only while this Node process was
// running (it served the static files itself, and the frontend called its
// /api/public/* routes live). That dependency is removed in two parts:
//
//   1. generateSnapshot() reads the current PUBLISHED, non-deleted state
//      straight out of SQLite (no second data store) and writes it to
//      public-data/projects.json, public-data/news.json, and sitemap.xml
//      at the project root. assets/js/store.js reads those files directly.
//
//   2. publishToGhPages() copies an EXPLICIT ALLOWLIST of public files
//      (see PUBLIC_ALLOWLIST below — HTML pages, assets/, uploads/,
//      public-data/, sitemap.xml, and the handful of hosting-config files)
//      into a separate `gh-pages` branch, using a git worktree, and pushes
//      it. `main` (this branch) keeps the full application source —
//      server.js, lib/, api/, scripts/, package*.json, knowledge/, the
//      Windows service scripts, docs — none of that is ever copied.
//      GitHub Pages / Cloudflare Pages / Vercel are then pointed at
//      `gh-pages`, so nothing they serve can ever include backend source.
//
// Both steps run from publish(), called after every publish-affecting
// admin action (api/admin/data.js) and once at server startup. The git
// step is entirely best-effort: it NEVER throws and NEVER blocks an admin
// write from succeeding. If git isn't available, gh-pages can't be
// reached, or there's no network right now, public-data/*.json and
// sitemap.xml are still correct on local disk; only the "push it live"
// step is skipped (retried on the next publish, or `npm run publish-site`
// by hand).
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { getDb } = require('./db');
const { projectFromRow, newsFromRow } = require('./models');
const { buildSitemapXml } = require('./sitemap');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DATA_DIR = path.join(ROOT, 'public-data');
const PROJECTS_JSON = path.join(PUBLIC_DATA_DIR, 'projects.json');
const NEWS_JSON = path.join(PUBLIC_DATA_DIR, 'news.json');
const SITEMAP_XML = path.join(ROOT, 'sitemap.xml');

const GH_PAGES_BRANCH = 'gh-pages';
// A sibling-of-tmp directory, not inside ROOT — a git worktree's directory
// must not live inside the worktree it's linked from in a way that creates
// a nested repo, and putting it in the OS temp dir means it's naturally
// disposable (rebuilt from scratch if it's ever missing) rather than
// something that needs to be tracked, backed up, or manually cleaned up.
const WORKTREE_DIR = path.join(os.tmpdir(), 'velix-gh-pages-worktree');

// ----------------------------------------------------------------------
// EXPLICIT ALLOWLIST of what is allowed onto the public deployment branch.
// Anything not listed here — server.js, lib/, api/, scripts/,
// package.json/package-lock.json, node_modules/, data/, .env*, README*,
// AI_PLATFORM_README.md, the *.ps1/*.bat Windows service scripts,
// knowledge/, .git* — is NEVER copied, full stop, regardless of what
// exists in the working tree. This is deliberately an allowlist rather
// than "copy everything except X": a new backend file added later is safe
// by default (excluded) instead of unsafe by default (leaked).
// ----------------------------------------------------------------------
const PUBLIC_ALLOWLIST = [
  // Public pages — every page a visitor can actually navigate to.
  // admin.html is intentionally NOT here: it has no backend to talk to on
  // a static host (the API doesn't exist there) and is not "required by
  // visitors" — it stays on `main`/the admin server only.
  'index.html', 'about.html', 'services.html', 'portfolio.html', 'project.html',
  'news.html', 'news-post.html', 'contact.html', 'privacy.html', 'terms.html',
  '404.html',
  // Hosting/SEO config these public pages depend on.
  'CNAME', 'robots.txt', '_redirects', 'vercel.json',
  'google802435ed5d3e41cd.html', // Search Console site-verification file
  // Directories, copied whole (see EXCLUDE_RELATIVE for the one carve-out).
  'assets', 'uploads', 'public-data'
];
// sitemap.xml is regenerated fresh every publish and copied explicitly in
// copyPublicFiles() below (it lives at the root next to the allowlist
// entries above, not inside one of them, and always exists once
// generateSnapshot() has run, so it doesn't need an existence check there).

// A file that lives inside an otherwise-public directory but is itself
// admin-only — no public page ever loads it (see assets/js/store.js vs.
// assets/js/admin-api.js), so it has no reason to ship to a static host
// with no backend behind it.
const EXCLUDE_RELATIVE = new Set(['assets/js/admin-api.js']);

function writeJsonIfChanged(filePath, data) {
  const next = JSON.stringify(data, null, 2) + '\n';
  try {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === next) return false; // no-op: avoids a pointless rewrite/diff
  } catch (e) { /* file doesn't exist yet — fall through and write it */ }
  fs.writeFileSync(filePath, next);
  return true;
}

function writeTextIfChanged(filePath, text) {
  try {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === text) return false;
  } catch (e) { /* doesn't exist yet */ }
  fs.writeFileSync(filePath, text);
  return true;
}

/**
 * Regenerates every static artifact from the current SQLite state. Safe to
 * call as often as needed — it always reflects exactly what's published
 * right now, and writes are skipped when nothing actually changed.
 * @returns {{changed: boolean, files: string[]}}
 */
function generateSnapshot() {
  if (!fs.existsSync(PUBLIC_DATA_DIR)) fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  const db = getDb();
  const changedFiles = [];

  const projectRows = db.prepare(
    `SELECT * FROM projects WHERE published = 1 AND deleted_at IS NULL
     ORDER BY sort_order DESC, created_at DESC`
  ).all();
  if (writeJsonIfChanged(PROJECTS_JSON, projectRows.map(projectFromRow))) changedFiles.push('public-data/projects.json');

  const newsRows = db.prepare(
    `SELECT * FROM news WHERE published = 1 AND deleted_at IS NULL
     ORDER BY created_at DESC`
  ).all();
  if (writeJsonIfChanged(NEWS_JSON, newsRows.map(newsFromRow))) changedFiles.push('public-data/news.json');

  const xml = buildSitemapXml(db);
  if (writeTextIfChanged(SITEMAP_XML, xml)) changedFiles.push('sitemap.xml');

  return { changed: changedFiles.length > 0, files: changedFiles };
}

// ----------------------------------------------------------------------
// git helpers
// ----------------------------------------------------------------------
function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}
function gitOk(cwd, args) {
  try { git(cwd, args); return true; } catch (e) { return false; }
}
function isGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Removes every entry directly inside `dir` except a literal `.git` (a
 * worktree's `.git` is a plain file — a pointer into the main repo's
 * metadata — never a directory to walk into, but this treats either shape
 * the same way: leave it alone, remove everything else). This is how the
 * public branch's working tree gets brought back to "exactly the allowlist
 * below, nothing else" on every publish, instead of accumulating whatever
 * used to be there.
 */
function clearDirExceptGit(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Copies exactly PUBLIC_ALLOWLIST (skipping EXCLUDE_RELATIVE, and silently
 * skipping any listed entry that doesn't currently exist — e.g. no
 * uploads/ yet on a fresh install) from ROOT into destDir, plus
 * sitemap.xml. Nothing outside this list is ever copied, no matter what
 * else exists in ROOT.
 */
function copyPublicFiles(destDir) {
  for (const entry of PUBLIC_ALLOWLIST) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(destDir, entry), {
      recursive: true,
      filter: (from) => {
        const rel = path.relative(ROOT, from).split(path.sep).join('/');
        return !EXCLUDE_RELATIVE.has(rel);
      }
    });
  }
  if (fs.existsSync(SITEMAP_XML)) {
    fs.cpSync(SITEMAP_XML, path.join(destDir, 'sitemap.xml'));
  }
}

/**
 * Ensures a git worktree exists at WORKTREE_DIR, checked out on
 * GH_PAGES_BRANCH, and returns true on success. Handles every starting
 * condition: worktree already there and valid; worktree directory present
 * but stale/corrupted (recreated); branch already exists locally; branch
 * exists on the remote but not locally yet; branch doesn't exist anywhere
 * yet (brand new — created as an orphan branch with no shared history with
 * main, the standard way a GitHub Pages deployment branch is built).
 */
function ensureWorktree() {
  const gitFile = path.join(WORKTREE_DIR, '.git');
  if (fs.existsSync(gitFile)) {
    // Looks like a worktree already — confirm it's actually usable and on
    // the right branch; if not, tear it down and rebuild below.
    try {
      const branch = git(WORKTREE_DIR, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      if (branch === GH_PAGES_BRANCH) return true;
    } catch (e) { /* fall through to rebuild */ }
    try { git(ROOT, ['worktree', 'remove', '--force', WORKTREE_DIR]); } catch (e) { /* ignore */ }
    fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });
  } else if (fs.existsSync(WORKTREE_DIR)) {
    // A leftover plain directory (not a real worktree) at the same path.
    fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });
  }
  try { git(ROOT, ['worktree', 'prune']); } catch (e) { /* ignore */ }

  // Best-effort: see whether gh-pages already exists locally and/or on the
  // remote, so we attach to it instead of creating a conflicting branch.
  try { git(ROOT, ['fetch', 'origin', GH_PAGES_BRANCH]); } catch (e) { /* offline, or branch doesn't exist remotely yet — fine */ }
  const hasLocalBranch = gitOk(ROOT, ['show-ref', '--verify', '--quiet', `refs/heads/${GH_PAGES_BRANCH}`]);
  const hasRemoteBranch = gitOk(ROOT, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${GH_PAGES_BRANCH}`]);

  try {
    if (hasLocalBranch) {
      git(ROOT, ['worktree', 'add', WORKTREE_DIR, GH_PAGES_BRANCH]);
    } else if (hasRemoteBranch) {
      git(ROOT, ['worktree', 'add', WORKTREE_DIR, '-b', GH_PAGES_BRANCH, `origin/${GH_PAGES_BRANCH}`]);
    } else {
      // Brand new: no gh-pages branch anywhere yet. Portable two-step
      // orphan creation (works on any git version that supports
      // worktrees at all — doesn't rely on the newer `worktree add
      // --orphan` flag): attach a detached worktree, then make it an
      // orphan branch from inside it. copyPublicFiles() + the
      // clear-first step in publishToGhPages() take care of the fact
      // that the detached checkout initially contains all of main's
      // files (backend included) — none of that is committed, since
      // everything gets wiped before the allowlist copy runs.
      git(ROOT, ['worktree', 'add', '--detach', WORKTREE_DIR]);
      git(WORKTREE_DIR, ['checkout', '--orphan', GH_PAGES_BRANCH]);
    }
  } catch (err) {
    throw new Error(`could not create the gh-pages worktree: ${(err.stderr || err.message || '').toString().trim()}`);
  }
  return true;
}

/**
 * Best-effort: builds the gh-pages branch from the current on-disk state
 * (public-data/*.json + sitemap.xml must already be regenerated by
 * generateSnapshot() before this runs) and pushes it. NEVER throws —
 * every failure (git missing, no worktree support, no network, no push
 * credentials) is caught and reported in the result instead, because a
 * publish problem must never turn an admin save into a failed request.
 * @returns {{ok: boolean, skipped?: boolean, reason?: string, error?: string}}
 */
function publishToGhPages(message) {
  if (process.env.GIT_AUTO_PUSH === 'false') {
    return { ok: true, skipped: true, reason: 'GIT_AUTO_PUSH=false — static files were written locally but not pushed to gh-pages.' };
  }
  if (!isGitRepo()) {
    return { ok: false, skipped: true, reason: 'Not a git repository — run `npm run publish-site` after configuring git, or copy the files listed in lib/publish.js\'s PUBLIC_ALLOWLIST to your static host manually.' };
  }

  try {
    ensureWorktree();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Converge with whatever's already on the remote gh-pages branch before
  // rebuilding it locally, so two machines publishing at different times
  // don't diverge into a conflict. Best-effort — a failure here (offline)
  // just means we publish on top of whatever this worktree already had.
  try { git(WORKTREE_DIR, ['fetch', 'origin', GH_PAGES_BRANCH]); } catch (e) { /* ignore */ }
  gitOk(WORKTREE_DIR, ['reset', '--hard', `origin/${GH_PAGES_BRANCH}`]);

  try {
    clearDirExceptGit(WORKTREE_DIR);
    copyPublicFiles(WORKTREE_DIR);
    git(WORKTREE_DIR, ['add', '-A']);
  } catch (err) {
    return { ok: false, error: `Building the gh-pages worktree failed: ${(err.stderr || err.message || '').toString().trim()}` };
  }

  const status = git(WORKTREE_DIR, ['status', '--porcelain']).trim();
  if (!status) return { ok: true, skipped: true, reason: 'Nothing new to publish — gh-pages already matches the current public content.' };

  try {
    git(WORKTREE_DIR, ['commit', '-m', message || 'Publish site content']);
  } catch (err) {
    return { ok: false, error: `git commit (gh-pages) failed: ${(err.stderr || err.message || '').toString().trim()}` };
  }

  try {
    git(WORKTREE_DIR, ['push', 'origin', `HEAD:${GH_PAGES_BRANCH}`]);
  } catch (err) {
    return {
      ok: false,
      error: `Committed locally to gh-pages, but git push failed (${(err.stderr || err.message || '').toString().trim()}). ` +
        'The commit is safe on this machine — fix git credentials/network, then run `npm run publish-site` to push it.'
    };
  }

  return { ok: true };
}

/**
 * The one function admin write routes call: regenerate the static snapshot
 * from SQLite, then best-effort build+push the gh-pages branch. Never
 * throws.
 * @param {string} reason short human-readable label used as the commit message
 * @param {{force?: boolean}} [opts] force=true also runs the gh-pages step
 *   when generateSnapshot() found no DB changes — used for the startup
 *   sync and the manual `npm run publish-site` run, both of which exist
 *   specifically to make sure gh-pages is fully seeded/caught up even when
 *   nothing changed in SQLite since the last run (first-time setup, or
 *   recovering from an earlier failed push).
 * @returns {{snapshot: {changed, files}, git: object}}
 */
function publish(reason, opts) {
  const force = !!(opts && opts.force);
  let snapshot;
  try {
    snapshot = generateSnapshot();
  } catch (err) {
    console.error('[lib/publish] generateSnapshot failed:', err);
    return { snapshot: { changed: false, files: [], error: err.message }, git: { ok: false, skipped: true, reason: 'Snapshot generation failed — nothing to publish.' } };
  }

  if (!snapshot.changed && !force) {
    return { snapshot, git: { ok: true, skipped: true, reason: 'No content changes to publish.' } };
  }

  let git_;
  try {
    git_ = publishToGhPages(reason || `Publish: ${snapshot.files.join(', ') || 'sync'}`);
  } catch (err) {
    // Defense in depth — publishToGhPages already catches everything
    // internally, but this file's one hard rule is that publish() itself
    // can never throw, no matter what.
    git_ = { ok: false, error: err.message };
  }
  if (!git_.ok && !git_.skipped) console.error('[lib/publish] gh-pages publish step failed:', git_.error);
  return { snapshot, git: git_ };
}

module.exports = {
  generateSnapshot, publishToGhPages, publish,
  PUBLIC_DATA_DIR, PROJECTS_JSON, NEWS_JSON, SITEMAP_XML,
  PUBLIC_ALLOWLIST, EXCLUDE_RELATIVE, WORKTREE_DIR, GH_PAGES_BRANCH
};
