// api/public/projects.js
// ============================================================================
// Public, read-only project data, read straight from the local SQLite
// database — there is no client-side database access of any kind (see
// assets/js/store.js). Only ever
// returns PUBLISHED, non-deleted rows; there is no way to reach a draft or
// a soft-deleted project through this route no matter what query string is
// sent — that filter is hardcoded into every query below, not something a
// caller can turn off.
//
//   GET /api/public/projects            -> { ok, data: [project, ...] }
//   GET /api/public/projects/:slug      -> { ok, data: project } | 404
//
// server.js's small public-API route table sets req.query.slug when the
// request path is /api/public/projects/<something>; a plain
// /api/public/projects request has no slug and returns the full list.
// ============================================================================

const { getDb } = require('../../lib/db');
const { projectFromRow } = require('../../lib/models');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const db = getDb();
  const slug = req.query && req.query.slug ? String(req.query.slug) : '';

  try {
    if (slug) {
      const row = db.prepare(
        `SELECT * FROM projects WHERE slug = ? AND published = 1 AND deleted_at IS NULL`
      ).get(slug);
      if (!row) {
        res.status(404).json({ ok: false, error: 'Project not found.' });
        return;
      }
      res.status(200).json({ ok: true, data: projectFromRow(row) });
      return;
    }

    const rows = db.prepare(
      `SELECT * FROM projects WHERE published = 1 AND deleted_at IS NULL
       ORDER BY sort_order DESC, created_at DESC`
    ).all();
    res.status(200).json({ ok: true, data: rows.map(projectFromRow) });
  } catch (err) {
    console.error('[api/public/projects] error:', err);
    res.status(500).json({ ok: false, error: 'Could not load projects.' });
  }
};
