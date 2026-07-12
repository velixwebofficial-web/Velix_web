// api/admin/leads.js
// Admin dashboard read path (§24) for leads captured server-side (via the
// AI's create_lead tool call, or the /api/leads form endpoint) — merged
// client-side with the existing localStorage leads list so nothing already
// built in admin.html breaks; this just adds the leads the AI itself
// captured that never touched the visitor's own localStorage.
//
// Guarded by a shared secret rather than full auth — proportionate to a
// two-person studio's current scale (§31 MVP note); upgrade to real admin
// session auth if/when the dashboard gets more than one operator.

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

  const leads = await store.listLeads(200);
  res.status(200).json({ leads, durable: store.isDurable() });
};
