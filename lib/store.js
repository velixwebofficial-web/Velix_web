// lib/store.js
// MVP slice of §33's database design: just `leads` and `events`, per the
// architecture's own MVP note ("sessions, conversations, messages, leads —
// the other four tables can wait"). `sessions`/`conversations`/`messages`
// stay client-side in the browser transcript for now (VELIX.conversations
// in store.js on the frontend) since there's no returning-visitor volume
// yet to justify server-side memory (§7's MVP note).
//
// IMPORTANT HONESTY NOTE: without Vercel KV configured (KV_REST_API_URL /
// KV_REST_API_TOKEN env vars), this falls back to in-memory storage that
// only lives for the current warm serverless instance and is NOT durable
// or cross-device. That fallback exists so the API never crashes if KV
// isn't set up yet, but real production use needs KV connected — see
// .env.example. This mirrors the honesty of the original store.js's own
// comments about localStorage not syncing across devices.

let kv = null;
let kvAvailable = false;

try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    // Lazy require so the dependency is optional if the package isn't installed.
    kv = require('@vercel/kv').kv;
    kvAvailable = true;
  }
} catch (err) {
  console.warn('[store] @vercel/kv not available, using in-memory fallback:', err.message);
}

const memory = {
  leads: [],
  events: []
};

async function saveLead(lead) {
  if (kvAvailable) {
    await kv.lpush('velix:leads', JSON.stringify(lead));
    return lead;
  }
  memory.leads.unshift(lead);
  return lead;
}

async function listLeads(limit = 100) {
  if (kvAvailable) {
    const raw = await kv.lrange('velix:leads', 0, limit - 1);
    return raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
  }
  return memory.leads.slice(0, limit);
}

async function logEvent(event) {
  const record = Object.assign({ at: new Date().toISOString() }, event);
  if (kvAvailable) {
    await kv.lpush('velix:events', JSON.stringify(record));
    return record;
  }
  memory.events.unshift(record);
  if (memory.events.length > 500) memory.events.length = 500;
  return record;
}

async function listEvents(limit = 200) {
  if (kvAvailable) {
    const raw = await kv.lrange('velix:events', 0, limit - 1);
    return raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
  }
  return memory.events.slice(0, limit);
}

module.exports = { saveLead, listLeads, logEvent, listEvents, isDurable: () => kvAvailable };
