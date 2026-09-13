// api/conversations.js
// ============================================================================
// Persists an AI chat transcript. The frontend has no database access of
// any kind (see assets/js/store.js) — this is the only path a chat
// transcript can reach disk through.
//
//   POST /api/conversations   { id, messages: [{role, content}, ...], sessionId }
//   -> { ok: true, data: { id, updatedAt } }
//
// Fire-and-forget from the chat widget's point of view (a transcript-save
// failure must never interrupt an active conversation — see
// assets/js/store.js), but every failure is still a real HTTP error here,
// never a silent "success" the caller can't detect.
//
// Validation, deliberately strict:
//   - `id` must be a short, plain string (the client generates it with
//     VELIX.uid('conv') — never trusted as anything more than an opaque
//     correlation key; it is NOT an admin/session credential and grants no
//     access to anything).
//   - `messages` must be an array, capped in length and per-message size,
//     and every entry must have an allowed `role` and a string `content` —
//     anything else is dropped rather than stored verbatim.
//   - `sessionId`, if present, is capped and stored as-is: it is a
//     visitor-correlation tag (see assets/js/store.js's VELIX.session),
//     never an auth token, so there is nothing to "verify" about it beyond
//     shape — it cannot grant access to anything and is only ever read back
//     by the authenticated admin dashboard.
//   - Rate-limited per IP so a public write endpoint can't be hammered.
// ============================================================================

const { getDb, toJson } = require('../lib/db');
const { checkRateLimit } = require('../lib/rateLimit');

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 4000;
const ALLOWED_ROLES = ['user', 'assistant'];

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_MESSAGES)
    .filter((m) => m && ALLOWED_ROLES.includes(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  const limit = checkRateLimit(`ip:${ip}:conversations`);
  if (!limit.allowed) {
    res.status(429).json({ ok: false, error: 'Too many requests. Please try again shortly.' });
    return;
  }

  const body = req.body || {};
  const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(body.id) ? body.id : null;
  if (!id) {
    res.status(400).json({ ok: false, error: 'A valid conversation id is required.' });
    return;
  }

  const messages = sanitizeMessages(body.messages);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 200) : null;

  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);

    if (existing) {
      db.prepare('UPDATE conversations SET messages = ?, session_id = COALESCE(?, session_id) WHERE id = ?')
        .run(toJson(messages, []), sessionId, id);
    } else {
      db.prepare('INSERT INTO conversations (id, messages, session_id) VALUES (?, ?, ?)')
        .run(id, toJson(messages, []), sessionId);
    }

    const row = db.prepare('SELECT id, updated_at FROM conversations WHERE id = ?').get(id);
    res.status(200).json({ ok: true, data: { id: row.id, updatedAt: row.updated_at } });
  } catch (err) {
    console.error('[api/conversations] error:', err);
    res.status(500).json({ ok: false, error: 'Could not save the conversation.' });
  }
};
