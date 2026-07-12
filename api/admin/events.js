// api/admin/events.js
// Analytics read path (§25 MVP note: "log the events; build visualization
// only once there's enough data for a chart to say something a raw list
// couldn't"). This returns the raw structured event log — conversation
// turns, quotes generated, leads created, escalations, rate limits hit —
// for the dashboard to fold into simple counts. A charted analytics view
// is intentionally deferred; see roadmap note in the chat summary.

const store = require('../../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.ADMIN_API_SECRET;
  if (secret) {
    const provided = req.headers['x-admin-secret'];
    if (provided !== secret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const events = await store.listEvents(300);

  // A few pre-aggregated counts, computed here (deterministic code) rather
  // than asking the model — cheap and exactly what §56's "escalation rate"
  // and "conversion rate" metrics need at MVP scale.
  const counts = events.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  res.status(200).json({ events, counts, durable: store.isDurable() });
};
