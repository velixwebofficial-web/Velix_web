// lib/rateLimit.js
// AI gateway guardrail (§3). MVP note: basic rate limiting (~20
// messages/session/hour) and simple input length caps — full anomaly
// detection is a later phase.
//
// Implementation note: serverless functions don't share memory across
// instances, so this in-memory limiter is a best-effort backstop, not a
// hard global guarantee. It still stops the common case (one abusive
// browser tab hammering one warm instance) at zero infra cost. When Vercel
// KV is configured (see lib/store.js), upgrade this to a KV-backed counter
// for a real cross-instance limit — the seam is isolated to this file.

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_MESSAGE_LENGTH = 2000;

const buckets = new Map(); // key -> { count, windowStart }

function checkRateLimit(key) {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, retryAfterMs: WINDOW_MS - (now - entry.windowStart) };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - entry.count };
}

function validateMessageLength(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Message is empty.' };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, error: 'Message is too long.' };
  return { ok: true };
}

// Very lightweight prompt-injection pattern flagging (§30). This is a
// nice-to-have signal for logging, NOT the real defense — the real defense
// is that pricing/actions only ever happen through function calls validated
// by the business logic layer (lib/pricingEngine.js), so a successful
// injection at most produces a rogue sentence, never a rogue discount.
const SUSPICIOUS_PATTERNS = [
  /ignore (all|previous|the) instructions/i,
  /system prompt/i,
  /you are now/i,
  /disregard (your|all) (rules|guidelines)/i,
  /act as (an? )?(unrestricted|jailbroken)/i
];

function flagSuspiciousInput(text) {
  return SUSPICIOUS_PATTERNS.some((re) => re.test(text));
}

module.exports = { checkRateLimit, validateMessageLength, flagSuspiciousInput, MAX_MESSAGE_LENGTH };
