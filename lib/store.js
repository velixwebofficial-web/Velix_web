// lib/store.js
// Server-side data layer used by the API handlers in /api (chat, leads,
// quote — anything that needs to persist a lead or log an activity/event
// entry outside the admin-authenticated CRUD gateway). Backed entirely by
// the local SQLite database (lib/db.js).
//
// There is no "not configured" state to fall back from: the SQLite
// database file is created
// automatically on first use (see lib/db.js), so persistence here can
// only fail the way any local disk write can fail (permissions, disk
// full) — each function below still logs that and degrades to returning
// the caller's original in-memory object rather than throwing, so a
// database hiccup never crashes a request that was otherwise fine.

const { getDb, uuid } = require('./db');

function isDurable() {
  // Kept for API-response-shape compatibility (api/leads.js echoes this
  // back as `durable`). SQLite is a local file created on demand, so
  // this is always true — a local file has no "unconfigured" state the
  // way a remote service might. An individual write can still fail (disk full,
  // permissions), which each function below reports for that call only.
  return true;
}

async function saveLead(lead) {
  try {
    const db = getDb();
    const id = uuid();
    const row = db.prepare(`
      INSERT INTO leads (id, name, phone, email, company, project_details, budget, timeline, source, session_id, conversation_id, status)
      VALUES (@id, @name, @phone, @email, @company, @project_details, @budget, @timeline, @source, @session_id, @conversation_id, 'New')
      RETURNING *
    `).get({
      id,
      name: lead.name,
      phone: lead.phone || '',
      email: lead.email || '',
      company: lead.company || '',
      project_details: lead.projectDetails || '',
      budget: lead.budget || '',
      timeline: lead.timeline || '',
      source: lead.source || 'Website Form',
      // session_id: ties a lead back to the visitor session/chat that
      // produced it (populated by lib/tools.js's create_lead via
      // context.sessionId for AI-chat leads; api/leads.js's direct-form
      // path has no per-lead session field of its own, so null there is
      // correct, not a gap).
      session_id: lead.sessionId || null,
      conversation_id: lead.conversationId || null
    });
    return row;
  } catch (err) {
    console.error('[store] saveLead error', err);
    return lead;
  }
}

async function listLeads(limit = 100) {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch (err) {
    console.error('[store] listLeads error', err);
    return [];
  }
}

async function logEvent(event) {
  const record = Object.assign({ at: new Date().toISOString() }, event);
  try {
    const db = getDb();
    db.prepare('INSERT INTO activity_log (id, text, icon) VALUES (?, ?, ?)').run(
      uuid(),
      `[event] ${event.type}${event.sessionId ? ' — session ' + event.sessionId : ''}`,
      'event'
    );
  } catch (err) {
    console.error('[store] logEvent error', err);
  }
  return record;
}

async function listEvents(limit = 200) {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM activity_log WHERE icon = 'event' ORDER BY "at" DESC LIMIT ?`).all(limit);
    return rows.map(r => ({ type: (r.text.match(/^\[event\] (\S+)/) || [])[1] || 'unknown', at: r.at }));
  } catch (err) {
    console.error('[store] listEvents error', err);
    return [];
  }
}

module.exports = { saveLead, listLeads, logEvent, listEvents, isDurable };
