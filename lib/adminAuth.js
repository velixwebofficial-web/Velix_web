// lib/adminAuth.js
// ============================================================================
// VELIX ADMIN AUTHENTICATION — server-side, session-cookie based.
//
// Server-side session-cookie authentication. There is exactly ONE admin
// account, configured entirely through environment
// variables (never in source, never in git, never sent to the browser):
//
//   ADMIN_EMAIL            — the admin's login email (plain string)
//   ADMIN_PASSWORD_HASH    — a bcrypt hash of the admin's password
//                            (generate with `node scripts/hash-admin-password.js`)
//   ADMIN_SESSION_SECRET   — a long random string used to sign session
//                            cookies (generate with `openssl rand -base64 48`
//                            or `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
//
// The plaintext password is NEVER stored anywhere — only its bcrypt hash,
// which is one-way (cannot be reversed back into the password). Login
// compares the submitted password against that hash with bcrypt.compare(),
// entirely on the server. Nothing password-related ever reaches the client.
//
// SESSION MODEL
// A session is a signed, stateless token (HMAC-SHA256 over a JSON payload
// of {email, iat, exp}) stored in an HttpOnly cookie — never readable by
// JavaScript in the browser, never stored in localStorage/sessionStorage.
// - HttpOnly: JavaScript on the page (including any injected via XSS)
//   cannot read or steal the cookie.
// - Secure (in production): only ever sent over HTTPS.
// - SameSite=Strict: the browser will not attach this cookie to any
//   cross-site request, which is this architecture's CSRF defense — a
//   malicious page on another origin cannot make the browser send the
//   admin's session cookie along with a forged request.
// - Signed + expiring: forging a valid token without ADMIN_SESSION_SECRET
//   is computationally infeasible, and every token stops working after
//   SESSION_TTL_MS regardless. There is no server-side session store to
//   attack (no "session fixation" surface — the server always mints a
//   brand-new signed token on login, it never accepts a client-supplied
//   session id and adopts it).
// - Sliding expiration: every authenticated request re-signs and re-sets
//   the cookie with a fresh expiry, so an actively-used session doesn't
//   expire mid-work, but an idle one expires after SESSION_TTL_MS.
//
// EVERY protected admin API route MUST call requireAdmin(req, res) FIRST,
// before touching the database or any admin data, and stop (return) if it
// returns null — see api/admin/data.js for the pattern. This is what
// "the server rejects unauthorized requests" actually means: it is
// enforced here, not by hiding buttons in the browser.
// ============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE_NAME = 'velix_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, sliding

function isProd() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

/* ---------------------------------------------------------------------
   Signed session tokens (stateless — no DB/session store needed).
   --------------------------------------------------------------------- */
function sign(payloadB64) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set on the server.');
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function createSessionToken(email) {
  const payload = { email, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  let expectedSig;
  try {
    expectedSig = sign(payloadB64);
  } catch (e) {
    return null; // ADMIN_SESSION_SECRET missing/misconfigured
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // forged/tampered token

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.email || !payload.exp) return null;
  if (Date.now() > payload.exp) return null; // expired
  return payload;
}

/* ---------------------------------------------------------------------
   Cookies
   --------------------------------------------------------------------- */
function parseCookies(req) {
  if (req.cookies && typeof req.cookies === 'object') return req.cookies; // Vercel's Node runtime already parses these
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch (e) { out[key] = val; }
  });
  return out;
}

function serializeCookie(name, value, { maxAgeSeconds, clear } = {}) {
  let str = `${name}=${clear ? '' : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict`;
  if (isProd()) str += '; Secure';
  str += clear
    ? '; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    : `; Max-Age=${maxAgeSeconds}`;
  return str;
}

function setSessionCookie(res, email) {
  const token = createSessionToken(email);
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, token, { maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) }));
  return token;
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, '', { clear: true }));
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

/**
 * The one function every protected admin route must call first.
 * Returns the session payload ({email, iat, exp}) if valid, and slides the
 * cookie's expiry forward. Sends a 401 itself and returns null if not —
 * callers must check for null and stop (do not touch the database or any data).
 */
function requireAdmin(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Not authenticated.' });
    return null;
  }
  setSessionCookie(res, session.email); // sliding expiration on every authenticated call
  return session;
}

/* ---------------------------------------------------------------------
   Password verification
   --------------------------------------------------------------------- */
async function verifyAdminCredentials(email, password) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminEmail || !adminHash) {
    return { ok: false, error: 'The admin account is not configured on the server yet (missing ADMIN_EMAIL / ADMIN_PASSWORD_HASH).' };
  }
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return { ok: false, error: 'Incorrect email or password.' };
  }
  const emailMatches = email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
  // Always run bcrypt.compare, even when the email is already known to be
  // wrong, so a wrong-email response takes the same time as a
  // wrong-password one — avoids leaking which one was wrong via timing.
  const passwordMatches = await bcrypt.compare(password, adminHash);
  if (!emailMatches || !passwordMatches) {
    return { ok: false, error: 'Incorrect email or password.' };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------
   Login attempt rate limiting (in-memory best-effort — see the same
   caveat in lib/rateLimit.js: serverless instances don't share memory,
   so this is a backstop against a single hammering client, not a hard
   global guarantee).
   --------------------------------------------------------------------- */
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();

function checkLoginRateLimit(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: LOGIN_WINDOW_MS - (now - entry.windowStart) };
  }
  entry.count += 1;
  return { allowed: true };
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  requireAdmin,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  verifyAdminCredentials,
  checkLoginRateLimit
};
