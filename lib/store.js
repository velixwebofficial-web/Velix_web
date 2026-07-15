// lib/store.js
// Server-side data layer used by the Vercel Functions in /api (chat, leads,
// admin reads). Backed entirely by Supabase Postgres via the service-role
// key, which bypasses RLS — appropriate here because these functions are
// themselves the trusted server boundary (rate-limited, input-validated).
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
// (see .env.example). There is no in-memory or localStorage fallback:
// without these env vars configured, leads/events simply fail to persist
// and the API returns durable: false so the caller knows to configure it.

const { createClient } = require('@supabase/supabase-js');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
} else {
  console.warn('[store] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — leads/events will not persist.');
}

function isDurable() {
  return !!supabase;
}

async function saveLead(lead) {
  if (!supabase) return lead;
  const { data, error } = await supabase.from('leads').insert({
    name: lead.name,
    phone: lead.phone || '',
    email: lead.email || '',
    company: lead.company || '',
    project_details: lead.projectDetails || '',
    budget: lead.budget || '',
    timeline: lead.timeline || '',
    source: lead.source || 'Website Form',
    conversation_id: lead.conversationId || null,
    status: 'New'
  }).select().single();
  if (error) { console.error('[store] saveLead error', error); return lead; }
  return data;
}

async function listLeads(limit = 100) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[store] listLeads error', error); return []; }
  return data || [];
}

async function logEvent(event) {
  const record = Object.assign({ at: new Date().toISOString() }, event);
  if (!supabase) return record;
  const { error } = await supabase.from('activity_log').insert({
    text: `[event] ${event.type}${event.sessionId ? ' — session ' + event.sessionId : ''}`,
    icon: 'event'
  });
  if (error) console.error('[store] logEvent error', error);
  return record;
}

async function listEvents(limit = 200) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('activity_log').select('*').eq('icon', 'event')
    .order('at', { ascending: false }).limit(limit);
  if (error) { console.error('[store] listEvents error', error); return []; }
  return (data || []).map(r => ({ type: (r.text.match(/^\[event\] (\S+)/) || [])[1] || 'unknown', at: r.at }));
}

module.exports = { saveLead, listLeads, logEvent, listEvents, isDurable };
