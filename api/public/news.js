// api/public/news.js
// ============================================================================
// Public, read-only news data — same role as api/public/projects.js. Only
// PUBLISHED, non-deleted articles are ever reachable here.
//
//   GET /api/public/news         -> { ok, data: [article, ...] }
//   GET /api/public/news/:id     -> { ok, data: article } | 404
//
// :id is looked up against both `id` and `slug` (news links in this app
// have historically used both — news-post.html?id=... and, on newer pages,
// a slug-shaped id), so either form of the old identifier keeps working.
// ============================================================================

const { getDb } = require('../../lib/db');
const { newsFromRow } = require('../../lib/models');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const db = getDb();
  const id = req.query && req.query.id ? String(req.query.id) : '';

  try {
    if (id) {
      const row = db.prepare(
        `SELECT * FROM news WHERE (id = ? OR slug = ?) AND published = 1 AND deleted_at IS NULL`
      ).get(id, id);
      if (!row) {
        res.status(404).json({ ok: false, error: 'Article not found.' });
        return;
      }
      res.status(200).json({ ok: true, data: newsFromRow(row) });
      return;
    }

    const rows = db.prepare(
      `SELECT * FROM news WHERE published = 1 AND deleted_at IS NULL
       ORDER BY created_at DESC`
    ).all();
    res.status(200).json({ ok: true, data: rows.map(newsFromRow) });
  } catch (err) {
    console.error('[api/public/news] error:', err);
    res.status(500).json({ ok: false, error: 'Could not load news.' });
  }
};
