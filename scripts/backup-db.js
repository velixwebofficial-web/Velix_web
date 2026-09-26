#!/usr/bin/env node
/* ==========================================================================
   VELIX — SQLite database backup.

   Copies the live database (data/velix.db) to a timestamped file under
   backups/, e.g.:

     backups/velix-2026-09-10-120000.db

   Safe to run at any time, including while the server is running: SQLite's
   WAL mode (enabled in lib/db.js) means readers/writers don't block a
   filesystem-level copy of the main database file, and better-safe-than-sorry
   here just means always doing a checkpoint first (below) so the copy is a
   complete, self-contained snapshot rather than missing whatever is still
   sitting in the WAL file.

   NEVER deletes or modifies the active database — this script only ever
   reads data/velix.db and writes a new file under backups/.

   Usage:
     node scripts/backup-db.js
     npm run backup
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKUPS_DIR = path.join(ROOT, 'backups');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function main() {
  // Use lib/db.js's own getDb() so the checkpoint runs through the same
  // connection the server would use, and so the database (and its
  // directory) genuinely exists before we try to copy it.
  const { getDb, DB_PATH } = require('../lib/db');

  if (!fs.existsSync(DB_PATH)) {
    console.log(`No database found yet at ${DB_PATH} — nothing to back up. (It is created automatically the first time the server runs.)`);
    process.exit(0);
  }

  const db = getDb();
  try {
    // Flush the WAL file into the main database file so the copy below is
    // a complete, self-contained snapshot.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('Could not checkpoint the database before backup (continuing anyway):', err.message);
  }

  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const destName = `velix-${timestamp()}.db`;
  const destPath = path.join(BACKUPS_DIR, destName);
  fs.copyFileSync(DB_PATH, destPath);

  const sizeKb = (fs.statSync(destPath).size / 1024).toFixed(1);
  console.log(`✓ Backed up ${DB_PATH}`);
  console.log(`  -> ${destPath} (${sizeKb} KB)`);
}

main();
