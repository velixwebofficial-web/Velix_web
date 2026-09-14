// api/public/settings.js
// ============================================================================
// Public, read-only site settings (site name, contact info, social links,
// SEO defaults, hero content), read straight from the local SQLite
// database. Nothing sensitive
// lives in this table (no credentials, no secrets), so the whole row is
// safe to return as-is; the JSON-shaped columns are parsed back into real
// objects the same way the admin gateway does.
//
//   GET /api/public/settings -> { ok, data: settings }
// ============================================================================

const { getDb, fromJson } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (!row) {
      res.status(200).json({ ok: true, data: {} });
      return;
    }
    res.status(200).json({
      ok: true,
      data: Object.assign({}, row, {
        social_links: fromJson(row.social_links, {}),
        seo_defaults: fromJson(row.seo_defaults, {})
      })
    });
  } catch (err) {
    console.error('[api/public/settings] error:', err);
    res.status(500).json({ ok: false, error: 'Could not load settings.' });
  }
};
