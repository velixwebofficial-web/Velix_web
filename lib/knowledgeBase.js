// lib/knowledgeBase.js
// Single source of truth for every fact the AI is allowed to state.
//
// MVP note (per architecture §9): flat JSON files in the repo, loaded once
// and cached in module scope (serverless functions reuse warm module state
// between invocations on the same instance, so this avoids re-reading disk
// on every request — see §57 performance). Move to a DB-backed KB only once
// updates need to happen without a redeploy.

const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '..', 'knowledge');
const FILES = ['packages', 'policies', 'process', 'faqs', 'competitors', 'services', 'company'];

let cache = null;

function loadKnowledgeBase() {
  if (cache) return cache;
  const kb = {};
  for (const name of FILES) {
    const filePath = path.join(KB_DIR, `${name}.json`);
    try {
      kb[name] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      // A missing/corrupt KB file must never crash the whole gateway —
      // degrade gracefully and let the AI say "let me confirm that"
      // rather than 500ing the entire chat.
      console.error(`[knowledgeBase] failed to load ${name}.json:`, err.message);
      kb[name] = null;
    }
  }
  cache = kb;
  return cache;
}

// MVP context-builder strategy (§8): the knowledge base is small enough
// today to inject in full on every turn rather than building topic-based
// retrieval. This function is the single seam to upgrade later — swap its
// body for a selective/embedded lookup without touching callers.
function buildKnowledgeContext() {
  const kb = loadKnowledgeBase();
  return JSON.stringify(kb, null, 0);
}

function getPackage(packageId) {
  const kb = loadKnowledgeBase();
  if (!kb.packages) return null;
  return kb.packages.packages.find((p) => p.id === packageId) || null;
}

function getAddon(addonId) {
  const kb = loadKnowledgeBase();
  if (!kb.packages) return null;
  return kb.packages.addons.find((a) => a.id === addonId) || null;
}

module.exports = { loadKnowledgeBase, buildKnowledgeContext, getPackage, getAddon };
