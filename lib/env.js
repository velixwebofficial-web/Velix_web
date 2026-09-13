// lib/env.js
// Tiny .env.local / .env loader shared by server.js and any standalone
// script that needs the same environment (e.g. scripts/publish-site.js
// respecting GIT_AUTO_PUSH). No dependency: KEY=value lines, optional
// quotes, # comments, blank lines skipped. Values already present in
// process.env (e.g. set by the shell) win — same behavior server.js has
// always had, just no longer duplicated.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return false;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

/** Loads .env.local then .env (first-wins, same order server.js has always used). */
function loadEnv() {
  const loadedEnvLocal = loadEnvFile('.env.local');
  loadEnvFile('.env');
  return { loadedEnvLocal };
}

module.exports = { loadEnv, loadEnvFile };
