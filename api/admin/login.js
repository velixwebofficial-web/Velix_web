// api/admin/login.js
// POST { email, password } -> sets an HttpOnly session cookie on success.
// The password is checked server-side against ADMIN_PASSWORD_HASH (bcrypt).
// It is never echoed back, never logged, and never stored client-side.

const { verifyAdminCredentials, setSessionCookie, checkLoginRateLimit } = require('../../lib/adminAuth');

function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  return `login:${ip}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const rl = checkLoginRateLimit(clientKey(req));
  if (!rl.allowed) {
    res.status(429).json({ ok: false, error: 'Too many login attempts. Please try again later.' });
    return;
  }

  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    res.status(400).json({ ok: false, error: 'Email and password are required.' });
    return;
  }

  try {
    const result = await verifyAdminCredentials(email, password);
    if (!result.ok) {
      res.status(401).json({ ok: false, error: result.error || 'Incorrect email or password.' });
      return;
    }
    setSessionCookie(res, email.toLowerCase());
    res.status(200).json({ ok: true, email: email.toLowerCase() });
  } catch (err) {
    console.error('[api/admin/login] error', err);
    res.status(500).json({ ok: false, error: 'Login failed. Please try again.' });
  }
};
