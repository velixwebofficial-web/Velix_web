#!/usr/bin/env node
/* ==========================================================================
   VELIX — lightweight static-site "lint/test" pass.
   There's no framework/bundler here, so this codifies the checks that
   actually matter for this codebase instead of pulling in a heavy toolchain:
     1. Every .js file must be syntactically valid (node --check).
     2. Every .html file's <script> tags must balance.
     3. No Windows-style backslash paths in src="" / href="" (breaks on a
        case-sensitive Linux filesystem).
     4. No reference to Supabase (or any old cloud-database dependency)
        anywhere in tracked source — a permanent regression guard for the
        Supabase -> SQLite/local-storage migration: this project must never
        silently grow a dependency on Supabase again.
     5. No leftover hardcoded secret-shaped strings (sk-..., JWT-shaped
        tokens, etc.) in tracked source.
   Run with: npm run lint   (or npm test — same script)
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function fail(msg) {
  failures += 1;
  console.error('✗ ' + msg);
}
function pass(msg) {
  console.log('✓ ' + msg);
}

function walk(dir, exts, skipDirs) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full, exts, skipDirs));
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const SKIP = ['node_modules', '.git', '.vercel'];
const jsFiles = walk(ROOT, ['.js'], SKIP);
const htmlFiles = walk(ROOT, ['.html'], SKIP);

// 1. JS syntax
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(`${path.relative(ROOT, f)}: syntax error\n${e.stderr.toString()}`);
  }
}
if (!failures) pass(`${jsFiles.length} JavaScript files are syntactically valid.`);

// 2-3. HTML checks
for (const f of htmlFiles) {
  const rel = path.relative(ROOT, f);
  const html = fs.readFileSync(f, 'utf8');

  const opens = (html.match(/<script/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  if (opens !== closes) fail(`${rel}: <script> tag mismatch (${opens} open, ${closes} close)`);

  const backslashAttr = html.match(/(?:src|href)="[^"]*\\[^"]*"/g);
  if (backslashAttr) fail(`${rel}: backslash path in src/href — ${backslashAttr.join(', ')}`);
}
if (!failures) pass(`${htmlFiles.length} HTML files checked (script tags, paths).`);

// 4. No Supabase references anywhere in tracked source — permanent
// regression guard for the Supabase -> SQLite/local-storage migration.
// data/, uploads/, backups/, node_modules/, and public-data/ are excluded:
// they hold this server's own runtime data, generated publish snapshots,
// and dependencies, not tracked source — public-data/*.json in particular
// is generated verbatim from project/news content written by whoever uses
// the Admin dashboard (e.g. a portfolio project that happens to be built
// on Supabase for a client), not something this check should ever flag.
const SUPABASE_SKIP_DIRS = SKIP.concat(['data', 'uploads', 'backups', 'public-data']);
// This file and README.md are excluded from their own scan: this check's
// source necessarily contains the word "Supabase" to detect it, and
// README.md documents what this check does — neither is a functional
// reference, both are the guard itself.
const SUPABASE_SKIP_FILES = ['check.js', 'README.md'];
const allTrackedFiles = walk(ROOT, ['.js', '.html', '.json', '.md'], SUPABASE_SKIP_DIRS)
  .filter((f) => path.basename(f) !== 'package-lock.json') // third-party lockfile history, not this project's source
  .filter((f) => !SUPABASE_SKIP_FILES.includes(path.basename(f)));
let supabaseFound = false;
for (const f of allTrackedFiles) {
  const text = fs.readFileSync(f, 'utf8');
  if (/supabase/i.test(text)) {
    fail(`${path.relative(ROOT, f)}: still references Supabase — this project must run entirely on SQLite/local storage.`);
    supabaseFound = true;
  }
}
if (!supabaseFound) pass('No Supabase references found anywhere in tracked source.');

// 5. Secret-shaped strings
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /AIza[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ // JWT-shaped token
];
let secretsFound = false;
for (const f of jsFiles.concat(htmlFiles)) {
  const text = fs.readFileSync(f, 'utf8');
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) {
      fail(`${path.relative(ROOT, f)}: looks like it contains a real secret/key — remove it and use an environment variable instead.`);
      secretsFound = true;
    }
  }
}
if (!secretsFound) pass('No hardcoded secret-shaped strings found in source.');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
