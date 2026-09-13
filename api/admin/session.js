// api/admin/session.js
// GET -> tells the client whether it currently has a valid admin session.
// This is the ONLY thing admin.html trusts to decide whether to show the
// dashboard or the login screen — never a client-side flag. It carries no
// sensitive data (just the admin's own email, which they already know).

const { requireAdmin } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }
  const session = requireAdmin(req, res); // sends 401 itself if not authenticated
  if (!session) return;
  res.status(200).json({ ok: true, authenticated: true, email: session.email });
};
