// api/admin/logout.js
// POST -> clears the session cookie. No auth check needed to log out (an
// already-unauthenticated caller clearing a cookie that isn't there is
// harmless), but it must only ever destroy the session, never create one.

const { clearSessionCookie } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
};
