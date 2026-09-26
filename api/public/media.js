// api/public/media.js
// ============================================================================
// Public, read-only media listing, read straight from the local SQLite
// `media` table (assets/js/store.js's VELIX.media.list, used by
// admin.html's Media Library panel). This is genuinely public data (URLs
// are already served statically from /uploads/*), so no auth is required
// to list it.
//
//   GET /api/public/media?folder=<bucket>&limit=<n>
// ============================================================================

const { getDb } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    const db = getDb();
    const query = req.query || {};
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 500);
    const folder = typeof query.folder === 'string' ? query.folder : '';

    const rows = folder
      ? db.prepare('SELECT * FROM media WHERE folder = ? ORDER BY uploaded_at DESC LIMIT ?').all(folder, limit)
      : db.prepare('SELECT * FROM media ORDER BY uploaded_at DESC LIMIT ?').all(limit);

    res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    console.error('[api/public/media] error:', err);
    res.status(500).json({ ok: false, error: 'Could not load media.' });
  }
};
