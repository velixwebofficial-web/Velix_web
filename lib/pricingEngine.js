// lib/pricingEngine.js
// Computes actual prices. This is deterministic code, never the LLM doing
// arithmetic — per architecture §18, a pricing bug here is the most
// damaging possible failure mode, so this file is intentionally boring,
// small, and heavily commented rather than clever.

const { getPackage, getAddon, loadKnowledgeBase } = require('./knowledgeBase');

class PricingError extends Error {}

/**
 * @param {{ packageId: string, addonIds?: string[] }} input
 * @returns {{ ok: true, breakdown: object } | { ok: false, error: string }}
 */
function computeQuote(input) {
  const kb = loadKnowledgeBase();
  if (!kb.packages) return { ok: false, error: 'Pricing data unavailable.' };

  const pkg = getPackage(input.packageId);
  if (!pkg) {
    return { ok: false, error: `Unknown package "${input.packageId}".` };
  }

  const addonIds = Array.isArray(input.addonIds) ? input.addonIds : [];
  const addonLines = [];
  let hasPriceOnRequestAddon = false;

  for (const id of addonIds) {
    const addon = getAddon(id);
    if (!addon) continue; // ignore unknown addon ids rather than failing the whole quote
    if (addon.price === null || addon.price === undefined) {
      hasPriceOnRequestAddon = true;
      addonLines.push({ id: addon.id, name: addon.name, price: null, note: addon.note });
    } else {
      addonLines.push({ id: addon.id, name: addon.name, price: addon.price });
    }
  }

  const addonTotal = addonLines.reduce((sum, a) => sum + (typeof a.price === 'number' ? a.price : 0), 0);
  const total = pkg.price + addonTotal;

  // Business logic layer (§12): the discount cap lives in code, not in the
  // model's judgment. Currently zero pre-authorized discount — see
  // packages.json business_rules. This is the code-level backstop referenced
  // in §30 (prompt injection protection): even if a visitor talks the model
  // into "agreeing" to a discount in text, the number returned here is
  // unaffected by that text.
  const maxDiscountPercent = kb.packages.business_rules && kb.packages.business_rules.max_discount_percent || 0;

  const referenceNumber = generateReferenceNumber();

  return {
    ok: true,
    breakdown: {
      referenceNumber,
      currency: kb.packages.currency || 'JOD',
      package: { id: pkg.id, name: pkg.name, price: pkg.price, unit: pkg.unit },
      addons: addonLines,
      subtotal: total,
      discountPercent: 0,
      maxDiscountPercentAllowed: maxDiscountPercent,
      total,
      hasPriceOnRequestItems: hasPriceOnRequestAddon,
      generatedAt: new Date().toISOString()
    }
  };
}

function generateReferenceNumber() {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `VLX-${ymd}-${rand}`;
}

module.exports = { computeQuote, PricingError };
