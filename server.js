#!/usr/bin/env node
/* ==========================================================================
   VELIX — persistent Node.js server (static site + /api/*.js handlers +
   /uploads/* local file storage), the single entry point for running this
   project as an ordinary long-lived process on any machine — including a
   Windows PC as a permanent local server. No cloud account, CLI login, or
   external database is required: everything the app needs (SQLite database,
   uploaded files) lives on the same disk as this file.

   USAGE
     1. Copy .env.example to .env.local and fill in real values
        (ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET,
        ANTHROPIC_API_KEY).
     2. npm install
     3. npm start   (or npm run dev — identical; both run this file)
     4. Open http://localhost:3000/ (or http://<PORT>/ if PORT is set).

   CONFIGURATION (environment variables — see .env.example)
     PORT   — TCP port to listen on (default 3000)
     HOST   — network interface to bind (default 0.0.0.0, i.e. every
              interface — NOT hardcoded to localhost, so this machine is
              reachable from other devices on the same network/router).

   WHAT THIS PROCESS OWNS
     - Serves every static file in this directory (HTML/CSS/JS/images) —
       the public website.
     - Serves /uploads/* — files saved locally by the admin dashboard (see
       lib/fileStorage.js) — no special routing needed beyond the generic
       static handler below, since uploads/ lives at the project root.
     - Executes every api/*.js file (including api/admin/*.js and
       api/public/*.js) with the same (req, res) => {...} contract those
       files already assume: req.body parsed (JSON for
       application/json requests, a raw Buffer otherwise — required for
       binary file uploads, see the upload route below), req.query parsed
       from the URL, and res.status(code).json(obj) / res.send(data)
       available.
     - Opens data/velix.db on first use via lib/db.js and keeps that one
       connection alive for the life of this process (api/*.js modules are
       require()'d once and cached the normal Node way — NOT re-required
       per request — so there is exactly one open SQLite connection for as
       long as this process runs, not one per request).
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname);

// .env.local / .env loading (lib/env.js — shared with scripts/publish-site.js
// so a standalone publish respects the same GIT_AUTO_PUSH etc.). This MUST
// run before PORT/HOST (and anything else that reads process.env) are read
// below — otherwise .env.local's values would never take effect.
const { loadedEnvLocal } = require('./lib/env').loadEnv();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/* ---------------------------------------------------------------------
   Static file serving (covers the whole public site AND /uploads/*,
   since uploads/ lives at the project root — no special-casing needed).
   --------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

// Uploaded files are safe to cache aggressively (their names are random and
// never reused — see lib/fileStorage.js); everything else stays no-cache so
// admin edits show up immediately without a hard refresh.
function cacheControlFor(pathname) {
  return pathname.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate';
}

// Top-level directories/files that must NEVER be reachable over HTTP, no
// matter what path is requested: they hold the SQLite database (leads,
// conversations — real customer data), server-side source, dependencies,
// or secrets. Without this, a plain GET to e.g. /data/velix.db or
// /.env.local would previously have been served as a static file like any
// other — server.js has always claimed in README.md that this can't
// happen, but nothing before this list actually enforced it. This is a
// pure hardening fix: it does not touch any legitimately public path
// (assets/, uploads/, public-data/, or any root-level .html/.css/.js/.txt
// page the site already serves).
const STATIC_DENY_TOP_LEVEL = new Set([
  'data', 'backups', 'node_modules', 'lib', 'scripts', 'api', '.git',
  // Root-level implementation files — not secrets, but server-side source
  // that no visitor has any legitimate reason to download.
  'server.js', 'package.json', 'package-lock.json'
]);
function isDeniedStaticPath(safePath) {
  const normalized = safePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const firstSegment = normalized.split('/')[0];
  if (STATIC_DENY_TOP_LEVEL.has(firstSegment)) return true;
  const basename = path.basename(normalized);
  // Any dotfile that looks like an env file (.env, .env.local, .env.example,
  // .env.production, ...) or version-control metadata is denied wherever it
  // appears, not just at the root.
  if (/^\.env(\..*)?$/.test(basename)) return true;
  return false;
}

function serveStatic(req, res, pathname) {
  // A rewritten destination (see REWRITES below) can carry a query string,
  // e.g. "/project.html?slug=foo" — that's meaningful to the browser's URL
  // bar (which keeps showing the original /projects/foo) but not to this
  // filesystem lookup, so it's stripped here rather than treated as part
  // of the file path.
  const pathOnly = pathname.split('?')[0];
  let safePath = path.normalize(decodeURIComponent(pathOnly)).replace(/^(\.\.[/\\])+/, '');
  if (isDeniedStaticPath(safePath)) { res.statusCode = 403; res.end('Forbidden'); return; }
  let filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('Forbidden'); return; }
  if (pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('404 Not Found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', cacheControlFor(pathname));
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------------------------------------------------------------
   vercel.json's rewrites, mirrored here so routing stays consistent
   between environments. Keep this in sync by hand if vercel.json ever
   changes — it's a short, fixed list.
   --------------------------------------------------------------------- */
const REWRITES = [
  { test: /^\/sitemap\.xml$/, dest: () => '/api/sitemap' },
  { test: /^\/projects\/([^/]+)$/, dest: (m) => `/project.html?slug=${m[1]}` }
];
function applyRewrites(pathname) {
  for (const r of REWRITES) {
    const m = pathname.match(r.test);
    if (m) return r.dest(m);
  }
  return null;
}

/* ---------------------------------------------------------------------
   Public API dynamic path segments — /api/public/projects/:slug and
   /api/public/news/:id. Checked before the generic exact-path-to-file
   mapping below (which would otherwise 404, since there is no literal
   api/public/projects/<slug>.js file on disk). Every other route in this
   app (admin gateway, leads, chat, conversations, quote, sitemap, the
   plain-list public routes) is a normal 1:1 path, handled by the generic
   mapping with no entry needed here.
   --------------------------------------------------------------------- */
const PUBLIC_API_PARAM_ROUTES = [
  { test: /^\/api\/public\/projects\/([^/]+)$/, file: 'public/projects', param: 'slug' },
  { test: /^\/api\/public\/news\/([^/]+)$/, file: 'public/news', param: 'id' }
];

/* ---------------------------------------------------------------------
   /api/*.js execution. Each handler gets: req.body (parsed JSON for
   application/json requests; a raw Buffer for anything else — this is
   what lets api/admin/upload.js accept binary file bytes untouched),
   req.query (parsed from the URL, plus any dynamic path param resolved
   above), and res.status()/res.json()/res.send().

   Every api/*.js module is require()'d at most once and reused for the
   life of this process (Node's normal require cache — there is
   deliberately no per-request cache-busting here), so lib/db.js's single
   open SQLite connection is genuinely shared across every request rather
   than being reopened every time.
   --------------------------------------------------------------------- */
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;      // 2 MB — plenty for any JSON API payload here
const UPLOAD_MAX_BODY_BYTES = 55 * 1024 * 1024;      // 55 MB — headroom above fileStorage's 50 MB video cap

function maxBodyBytesFor(pathname) {
  return pathname === '/api/admin/upload' ? UPLOAD_MAX_BODY_BYTES : DEFAULT_MAX_BODY_BYTES;
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        const err = new Error('Request body too large.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!aborted) reject(err); });
  });
}

const apiHandlerCache = new Map(); // resolved file path -> required handler

function resolveApiFile(rel) {
  const filePath = path.join(ROOT, 'api', rel + '.js');
  if (!filePath.startsWith(path.join(ROOT, 'api') + path.sep) || !fs.existsSync(filePath)) return null;
  return filePath;
}

function loadHandler(filePath) {
  if (!apiHandlerCache.has(filePath)) {
    apiHandlerCache.set(filePath, require(filePath));
  }
  return apiHandlerCache.get(filePath);
}

async function handleApi(req, res, pathname, extraQuery) {
  let filePath = null;
  let paramQuery = extraQuery || null;

  for (const route of PUBLIC_API_PARAM_ROUTES) {
    const m = pathname.match(route.test);
    if (m) {
      filePath = resolveApiFile(route.file);
      paramQuery = Object.assign({}, extraQuery, { [route.param]: decodeURIComponent(m[1]) });
      break;
    }
  }

  if (!filePath) {
    const rel = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
    filePath = resolveApiFile(rel);
  }

  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: `No API route at ${pathname}` }));
    return;
  }

  let rawBody;
  try {
    rawBody = await readBody(req, maxBodyBytesFor(pathname));
  } catch (err) {
    res.statusCode = err.statusCode || 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: err.statusCode === 413 ? 'Request body too large.' : 'Could not read request body.' }));
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (rawBody.length && contentType.includes('application/json')) {
    try { req.body = JSON.parse(rawBody.toString('utf8')); } catch (e) { req.body = {}; }
  } else if (rawBody.length) {
    // Kept as a raw Buffer (never stringified) so binary uploads survive
    // intact — api/admin/upload.js depends on this.
    req.body = rawBody;
  } else {
    req.body = {};
  }

  req.query = Object.assign({}, url.parse(req.url, true).query, paramQuery || {});
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = function (data) { res.end(data); return res; };

  try {
    const handler = loadHandler(filePath);
    await handler(req, res);
  } catch (err) {
    console.error(`[server] ${pathname} threw:`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Internal server error.' }));
    }
  }
}

/* ---------------------------------------------------------------------
   Request router
   --------------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url);
    let pathname = parsed.pathname || '/';

    if (pathname.startsWith('/api/')) { await handleApi(req, res, pathname); return; }

    const rewritten = applyRewrites(pathname);
    if (rewritten) {
      const rewrittenPath = url.parse(rewritten).pathname;
      if (rewrittenPath.startsWith('/api/')) { await handleApi(req, res, rewrittenPath); return; }
      serveStatic(req, res, rewritten);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server] request handler crashed:', err);
    if (!res.headersSent) { res.statusCode = 500; res.end('Internal server error'); }
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log(`  VELIX server running at   http://${displayHost}:${PORT}`);
  console.log(`  Listening on              ${HOST}:${PORT} (set HOST=127.0.0.1 to restrict to this machine only)`);
  console.log(`  Admin login:              http://${displayHost}:${PORT}/admin.html`);
  console.log('');

  // Touch the database once at startup so "database created" is confirmed
  // in the log immediately, not only on the first request.
  try {
    const { DB_PATH } = require('./lib/db');
    require('./lib/db').getDb();
    console.log(`  SQLite database:          ${DB_PATH}`);
  } catch (err) {
    console.error('  ⚠ Could not open the SQLite database:', err.message);
  }
  const { UPLOADS_ROOT, ensureUploadDirs } = require('./lib/fileStorage');
  ensureUploadDirs();
  console.log(`  Local file storage:        ${UPLOADS_ROOT}`);
  console.log('');

  // Self-heal on every boot: if the database changed while this process
  // was last stopped (a restore, a manual DB edit, or simply the static
  // snapshot never having been generated on a fresh clone), bring
  // public-data/*.json + sitemap.xml back in sync with SQLite and push
  // them, without waiting for the next admin edit. Fire-and-forget — this
  // must never delay or block the server actually accepting requests.
  setImmediate(() => {
    try {
      const { publish } = require('./lib/publish');
      const result = publish('Startup sync', { force: true });
      if (result.snapshot.changed) {
        console.log(`  Publish (startup sync):    ${result.snapshot.files.join(', ')}${result.git.ok ? (result.git.skipped ? ' (git: ' + result.git.reason + ')' : ' (pushed)') : ' (git push failed — see log above)'}`);
      }
    } catch (err) {
      console.error('  ⚠ Startup publish sync failed (non-fatal):', err.message);
    }
  });

  if (!loadedEnvLocal) {
    console.warn('  ⚠ No .env.local found. Copy .env.example to .env.local and fill in');
    console.warn('    ADMIN_EMAIL / ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET / ANTHROPIC_API_KEY,');
    console.warn('    then restart this server.');
    console.log('');
  } else if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_SESSION_SECRET) {
    console.warn('  ⚠ .env.local was found but is missing one of ADMIN_EMAIL /');
    console.warn('    ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET — admin login will fail until');
    console.warn('    all three are set.');
    console.log('');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠ ANTHROPIC_API_KEY not set — the AI chat widget will respond with a');
    console.warn('    "not configured" error until it is set.');
    console.log('');
  }
});
