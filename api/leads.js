// api/leads.js
// CRM write path (§23) for leads submitted directly through the visible
// lead-capture form (chat-widget.js's leadForm()), as opposed to leads
// created implicitly by the AI via the create_lead function call in
// api/chat.js. Both paths converge on the same store so the admin
// dashboard has one list either way.

const { checkRateLimit } = require('../lib/rateLimit');
const store = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const limit = checkRateLimit(`ip:${ip}:leads`);
  if (!limit.allowed) {
    res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });
    return;
  }

  if (!body.name || typeof body.name !== 'string') {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }

  const lead = {
    id: `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(body.name).slice(0, 200),
    phone: body.phone ? String(body.phone).slice(0, 60) : '',
    email: body.email ? String(body.email).slice(0, 200) : '',
    company: body.company ? String(body.company).slice(0, 200) : '',
    projectDetails: body.projectDetails ? String(body.projectDetails).slice(0, 2000) : '',
    budget: body.budget ? String(body.budget).slice(0, 100) : '',
    timeline: body.timeline ? String(body.timeline).slice(0, 100) : '',
    source: body.source ? String(body.source).slice(0, 100) : 'Website Form',
    conversationId: body.conversationId || null,
    status: 'New',
    createdAt: new Date().toISOString()
  };

  await store.saveLead(lead);
  await store.logEvent({ type: 'lead_created', sessionId: body.sessionId || null, payload: { name: lead.name, source: lead.source } });

  res.status(200).json({ success: true, lead, durable: store.isDurable() });
};
