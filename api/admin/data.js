// api/admin/data.js
// ============================================================================
// Single gateway for every privileged admin data operation (projects, news,
// leads, conversations, activity log, settings, media). Every request MUST
// pass requireAdmin() first — that is enforced here, on the server, not by
// hiding buttons in admin.html. The client can send whatever it wants; if
// the session cookie doesn't verify, nothing below this line ever runs.
//
// POST body shape: { resource, action, payload }
//   resource: 'projects' | 'news' | 'leads' | 'conversations' | 'activity'
//            | 'settings' | 'media'
//   action:   resource-specific (see the switch below)
//   payload:  action-specific arguments
//
// Backed entirely by the local SQLite database (lib/db.js). Every query
// below is a parameterized prepared statement
// (db.prepare(sql).get/all/run(params)) — values are always bound as
// parameters, never concatenated into the SQL string, which is what
// actually defends against SQL injection here. There is no "database not
// configured" state: SQLite is a local file created automatically (see
// lib/db.js), so CRUD works as soon as the server is running.
// Row<->app-shape mapping (projectFromRow/projectToRow etc., in
// lib/models.js) keeps the same field names and shape the dashboard
// already expects; SQLite has no native boolean/array/object column type,
// so booleans are stored as 0/1 and arrays/objects as JSON text.
// ============================================================================

const { requireAdmin } = require('../../lib/adminAuth');
const { getDb, uuid, toJson, fromJson } = require('../../lib/db');
const { deleteUploadedFile } = require('../../lib/fileStorage');
const { slugify, projectFromRow, projectToRow, newsFromRow, newsToRow } = require('../../lib/models');
const { publish } = require('../../lib/publish');

// Actions that can change what a visitor sees on the PUBLIC site — every
// other action (all/trashed listings, leads/conversations/activity/media,
// which are never read from public-data/*.json) has no reason to trigger a
// publish. Keeping this list explicit (rather than "publish on every
// projects/news call") makes it obvious at a glance which admin actions
// actually push new content live.
const PUBLISHING_ACTIONS = {
  projects: new Set(['save', 'remove', 'restore', 'permanentlyDelete', 'setPublished', 'setFeatured', 'duplicate', 'bulk']),
  news: new Set(['save', 'remove', 'restore', 'setPublished', 'bulk'])
};

// Bad-input errors (unknown action, a record that doesn't exist, etc.)
// should map to 400/404, not 500 — 500 is reserved for genuine unexpected
// server errors (a real DB failure, a bug).
function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}
function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function uniqueSlug(db, table, base, excludeId) {
  let slug = base, n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hit = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slug);
    if (!hit || hit.id === excludeId) return slug;
    slug = base + '-' + (n++);
  }
}

function logActivity(db, text, icon) {
  try { db.prepare('INSERT INTO activity_log (id, text, icon) VALUES (?, ?, ?)').run(uuid(), text, icon || 'dot'); } catch (e) { /* non-fatal */ }
}

/* ---------------------------------------------------------------------
   Resource handlers
   --------------------------------------------------------------------- */
function handleProjects(action, payload) {
  const db = getDb();
  switch (action) {
    case 'all': {
      const rows = db.prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY sort_order DESC, created_at DESC').all();
      return rows.map(projectFromRow);
    }
    case 'trashed': {
      const rows = db.prepare('SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
      return rows.map(projectFromRow);
    }
    case 'save': {
      const project = payload || {};
      if (Array.isArray(project.gallery) && project.gallery.length > 15) {
        project.gallery = project.gallery.slice(0, 15);
      }
      const row = projectToRow(project);
      if (!project.id) {
        row.id = uuid();
        row.slug = uniqueSlug(db, 'projects', project.slug ? slugify(project.slug) : slugify(project.title), null);
        const cols = Object.keys(row);
        const placeholders = cols.map(c => '@' + c).join(', ');
        const saved = db.prepare(`INSERT INTO projects (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`).get(row);
        logActivity(db, `New project added: "${project.title}"`, 'project');
        return projectFromRow(saved);
      }
      const existing = db.prepare('SELECT slug FROM projects WHERE id = ?').get(project.id);
      if (!existing) throw notFound('Project not found.');
      row.slug = existing.slug === project.slug ? project.slug : uniqueSlug(db, 'projects', slugify(project.slug || project.title), project.id);
      const setClause = Object.keys(row).map(c => `${c} = @${c}`).join(', ');
      const saved = db.prepare(`UPDATE projects SET ${setClause} WHERE id = @id RETURNING *`).get(Object.assign({}, row, { id: project.id }));
      logActivity(db, `Project updated: "${project.title}"`, 'project');
      return projectFromRow(saved);
    }
    case 'remove': {
      const target = db.prepare('SELECT title FROM projects WHERE id = ?').get(payload.id);
      db.prepare('UPDATE projects SET deleted_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?').run(payload.id);
      if (target) logActivity(db, `Project deleted: "${target.title}"`, 'project');
      return { ok: true };
    }
    case 'restore': {
      db.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ?').run(payload.id);
      logActivity(db, 'Project restored', 'project');
      return { ok: true };
    }
    case 'permanentlyDelete': {
      db.prepare('DELETE FROM projects WHERE id = ?').run(payload.id);
      return { ok: true };
    }
    case 'setPublished': {
      db.prepare('UPDATE projects SET published = ? WHERE id = ?').run(payload.published ? 1 : 0, payload.id);
      logActivity(db, payload.published ? 'Project published' : 'Project unpublished', 'project');
      return { ok: true };
    }
    case 'setFeatured': {
      db.prepare('UPDATE projects SET featured = ? WHERE id = ?').run(payload.featured ? 1 : 0, payload.id);
      return { ok: true };
    }
    case 'duplicate': {
      const original = db.prepare('SELECT * FROM projects WHERE id = ?').get(payload.id);
      if (!original) throw notFound('Project not found.');
      const copy = projectFromRow(original);
      copy.id = null;
      copy.title = copy.title + ' (Copy)';
      copy.slug = '';
      copy.published = false;
      return handleProjects('save', copy);
    }
    case 'bulk': {
      const { ids, bulkAction } = payload;
      if (!Array.isArray(ids) || !ids.length) return { ok: true };
      const placeholders = ids.map(() => '?').join(', ');
      if (bulkAction === 'publish') db.prepare(`UPDATE projects SET published = 1 WHERE id IN (${placeholders})`).run(...ids);
      else if (bulkAction === 'unpublish') db.prepare(`UPDATE projects SET published = 0 WHERE id IN (${placeholders})`).run(...ids);
      else if (bulkAction === 'delete') db.prepare(`UPDATE projects SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${placeholders})`).run(...ids);
      else if (bulkAction === 'restore') db.prepare(`UPDATE projects SET deleted_at = NULL WHERE id IN (${placeholders})`).run(...ids);
      return { ok: true };
    }
    default:
      throw badRequest(`Unknown projects action: ${action}`);
  }
}

function handleNews(action, payload) {
  const db = getDb();
  switch (action) {
    case 'all': {
      const rows = db.prepare('SELECT * FROM news WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
      return rows.map(newsFromRow);
    }
    case 'save': {
      const article = payload || {};
      const row = newsToRow(article);
      if (!article.id) {
        row.id = uuid();
        row.slug = uniqueSlug(db, 'news', article.slug ? slugify(article.slug) : slugify(article.title), null);
        const cols = Object.keys(row);
        const placeholders = cols.map(c => '@' + c).join(', ');
        const saved = db.prepare(`INSERT INTO news (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`).get(row);
        logActivity(db, `New article published: "${article.title}"`, 'news');
        return newsFromRow(saved);
      }
      const existing = db.prepare('SELECT slug FROM news WHERE id = ?').get(article.id);
      if (!existing) throw notFound('Article not found.');
      row.slug = existing.slug === article.slug ? article.slug : uniqueSlug(db, 'news', slugify(article.slug || article.title), article.id);
      const setClause = Object.keys(row).map(c => `${c} = @${c}`).join(', ');
      const saved = db.prepare(`UPDATE news SET ${setClause} WHERE id = @id RETURNING *`).get(Object.assign({}, row, { id: article.id }));
      logActivity(db, `Article updated: "${article.title}"`, 'news');
      return newsFromRow(saved);
    }
    case 'remove': {
      const target = db.prepare('SELECT title FROM news WHERE id = ?').get(payload.id);
      db.prepare('UPDATE news SET deleted_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?').run(payload.id);
      if (target) logActivity(db, `Article deleted: "${target.title}"`, 'news');
      return { ok: true };
    }
    case 'restore': {
      db.prepare('UPDATE news SET deleted_at = NULL WHERE id = ?').run(payload.id);
      return { ok: true };
    }
    case 'setPublished': {
      db.prepare('UPDATE news SET published = ? WHERE id = ?').run(payload.published ? 1 : 0, payload.id);
      return { ok: true };
    }
    case 'bulk': {
      const { ids, bulkAction } = payload;
      if (!Array.isArray(ids) || !ids.length) return { ok: true };
      const placeholders = ids.map(() => '?').join(', ');
      if (bulkAction === 'publish') db.prepare(`UPDATE news SET published = 1 WHERE id IN (${placeholders})`).run(...ids);
      else if (bulkAction === 'unpublish') db.prepare(`UPDATE news SET published = 0 WHERE id IN (${placeholders})`).run(...ids);
      else if (bulkAction === 'delete') db.prepare(`UPDATE news SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${placeholders})`).run(...ids);
      else if (bulkAction === 'restore') db.prepare(`UPDATE news SET deleted_at = NULL WHERE id IN (${placeholders})`).run(...ids);
      return { ok: true };
    }
    default:
      throw badRequest(`Unknown news action: ${action}`);
  }
}

function handleLeads(action, payload) {
  const db = getDb();
  switch (action) {
    case 'all': {
      const rows = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
      return rows.map(r => Object.assign({}, r, { notes: fromJson(r.notes, []) }));
    }
    case 'update': {
      const patch = payload.patch || {};
      // Only ever touch columns that genuinely exist on `leads`, and only
      // the ones actually present in the patch — same allowlist approach
      // as handleSettings below, so a crafted payload can't target an
      // arbitrary column.
      const ALLOWED = ['name', 'phone', 'email', 'company', 'project_details', 'budget', 'timeline', 'source', 'status'];
      const keys = Object.keys(patch).filter(k => ALLOWED.includes(k));
      if (!keys.length) {
        const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.id);
        if (!row) throw notFound('Lead not found.');
        return Object.assign({}, row, { notes: fromJson(row.notes, []) });
      }
      const setClause = keys.map(k => `${k} = @${k}`).join(', ');
      const params = Object.assign({}, patch, { id: payload.id });
      const saved = db.prepare(`UPDATE leads SET ${setClause} WHERE id = @id RETURNING *`).get(params);
      if (!saved) throw notFound('Lead not found.');
      return Object.assign({}, saved, { notes: fromJson(saved.notes, []) });
    }
    case 'remove': {
      db.prepare('DELETE FROM leads WHERE id = ?').run(payload.id);
      return { ok: true };
    }
    case 'addNote': {
      const row = db.prepare('SELECT notes FROM leads WHERE id = ?').get(payload.id);
      const notes = fromJson(row && row.notes, []);
      notes.push({ text: payload.note, at: new Date().toISOString() });
      db.prepare('UPDATE leads SET notes = ? WHERE id = ?').run(toJson(notes, []), payload.id);
      return { ok: true };
    }
    default:
      throw badRequest(`Unknown leads action: ${action}`);
  }
}

function handleConversations(action) {
  if (action !== 'all') throw badRequest(`Unknown conversations action: ${action}`);
  const db = getDb();
  const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
  return rows.map(r => Object.assign({}, r, { messages: fromJson(r.messages, []) }));
}

function handleActivity(action) {
  if (action !== 'all') throw badRequest(`Unknown activity action: ${action}`);
  const db = getDb();
  return db.prepare('SELECT * FROM activity_log ORDER BY "at" DESC LIMIT 40').all();
}

const SETTINGS_COLUMNS = ['site_name', 'logo', 'favicon', 'phone', 'email', 'address', 'social_links', 'seo_defaults', 'hero_video_url', 'hero_poster'];
const SETTINGS_JSON_COLUMNS = ['social_links', 'seo_defaults'];

function handleSettings(action, payload) {
  if (action !== 'save') throw badRequest(`Unknown settings action: ${action}`);
  const db = getDb();
  const patch = payload || {};
  // Allowlisted column set (matches lib/db.js's settings table exactly) —
  // a request can only ever update real settings columns, never inject an
  // arbitrary one, regardless of what the payload object contains.
  const keys = Object.keys(patch).filter(k => SETTINGS_COLUMNS.includes(k));
  if (keys.length) {
    const params = { id: 1 };
    keys.forEach((k) => { params[k] = SETTINGS_JSON_COLUMNS.includes(k) ? toJson(patch[k], {}) : patch[k]; });
    const setClause = keys.map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE settings SET ${setClause} WHERE id = @id`).run(params);
  }
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  logActivity(db, 'Website settings updated', 'settings');
  return Object.assign({}, row, {
    social_links: fromJson(row.social_links, {}),
    seo_defaults: fromJson(row.seo_defaults, {})
  });
}

function handleMedia(action, payload) {
  const db = getDb();
  switch (action) {
    // Listing is public (GET /api/public/media) — anyone can read it.
    // Uploading and deleting stay here, behind requireAdmin(). Uploading
    // itself happens through the dedicated raw-bytes endpoint
    // api/admin/upload.js (a direct, multipart-free byte upload straight
    // to local disk), which inserts the resulting row itself; this
    // resource only needs to support removal.
    case 'remove': {
      const row = db.prepare('SELECT storage_path FROM media WHERE id = ?').get(payload.id);
      if (row) {
        const del = deleteUploadedFile(row.storage_path);
        if (!del.ok) console.warn('[api/admin/data] media remove: file delete failed', del.error);
      }
      db.prepare('DELETE FROM media WHERE id = ?').run(payload.id);
      return { ok: true };
    }
    default:
      throw badRequest(`Unknown media action: ${action}`);
  }
}

/* ---------------------------------------------------------------------
   Entry point
   --------------------------------------------------------------------- */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const session = requireAdmin(req, res); // sends 401 itself if not authenticated — nothing below runs
  if (!session) return;

  const body = req.body || {};
  const { resource, action, payload } = body;

  try {
    let data;
    switch (resource) {
      case 'projects': data = handleProjects(action, payload); break;
      case 'news': data = handleNews(action, payload); break;
      case 'leads': data = handleLeads(action, payload); break;
      case 'conversations': data = handleConversations(action); break;
      case 'activity': data = handleActivity(action); break;
      case 'settings': data = handleSettings(action, payload); break;
      case 'media': data = handleMedia(action, payload); break;
      default:
        res.status(400).json({ ok: false, error: `Unknown resource: ${resource}` });
        return;
    }

    // Publish step: regenerate public-data/*.json + sitemap.xml from
    // SQLite and best-effort push them to the static host's git remote —
    // see lib/publish.js. This is the "Admin -> Backend -> Persistent
    // Storage -> Publish -> Public Static Content" pipeline: the database
    // write above already succeeded and is durable on its own regardless of
    // what happens here, so a publish failure (e.g. no network right now)
    // is reported back to the admin UI but never turns this into a failed
    // request — nothing about the save itself is undone or blocked.
    let published;
    if (PUBLISHING_ACTIONS[resource] && PUBLISHING_ACTIONS[resource].has(action)) {
      try {
        published = publish(`Publish: ${resource} ${action}`);
      } catch (err) {
        console.error('[api/admin/data] publish() threw unexpectedly', err);
        published = { snapshot: null, git: { ok: false, error: err.message } };
      }
    }

    res.status(200).json({ ok: true, data, published });
  } catch (err) {
    console.error('[api/admin/data]', resource, action, err);
    const status = (err && err.statusCode) || 500;
    res.status(status).json({ ok: false, error: (err && err.message) || 'Request failed.' });
  }
};
