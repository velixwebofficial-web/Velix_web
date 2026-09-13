// api/quote.js
// Direct pricing/quote-generation endpoint (§18, §19), sharing the exact
// same deterministic pricing engine the AI's generate_quote function call
// uses in api/chat.js — one engine, two entry points, so a quote is always
// the same number whether it came from a chat conversation or a future
// on-site "build your own quote" widget.

const { computeQuote } = require('../lib/pricingEngine');
const store = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const result = computeQuote({ packageId: body.packageId, addonIds: body.addonIds });

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  await store.logEvent({ type: 'quote_generated', sessionId: body.sessionId || null, payload: result.breakdown });
  res.status(200).json({ success: true, quote: result.breakdown });
};
