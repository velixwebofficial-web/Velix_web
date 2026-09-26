// lib/db.js
// ============================================================================
// VELIX — LOCAL SQLITE DATA LAYER
//
// The entire database layer. Uses Node's own built-in `node:sqlite`
// module (DatabaseSync) — no native dependency to compile, no separate
// database server, nothing to install beyond Node itself. Requires Node
// >= 22.5.0 (see package.json "engines"); node:sqlite is stable enough for
// this project's needs but still flagged "experimental" by Node itself as
// of this Node version, hence the one warning printed at startup — that is
// expected and harmless.
//
// The database file lives at data/velix.db, created automatically (along
// with the data/ directory and every table) the first time this module is
// required — nothing to run by hand, no migration step.
//
// This module owns the schema and exposes one thing to the rest of the
// app: getDb(), which returns the open, ready-to-query DatabaseSync
// instance. Callers use plain parameterized SQL (db.prepare(sql).get/all/run)
// — never string-concatenated SQL — which is what actually defends against
// SQL injection; see api/admin/data.js and api/public/*.js for the query
// layer built on top of this.
//
// JSON-shaped columns (gallery, technologies, services, results, notes,
// messages, social_links, seo_defaults) are stored as TEXT containing
// JSON — SQLite has no native array/object column type. toJson()/fromJson()
// below are the single place that (de)serializes them, so every caller
// gets real JS arrays/objects back, exactly like the old Postgres jsonb
// columns did.
// ============================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'velix.db');

let db = null;

function uuid() {
  return crypto.randomUUID();
}

function toJson(value, fallback) {
  try {
    return JSON.stringify(value === undefined ? fallback : value);
  } catch (e) {
    return JSON.stringify(fallback);
  }
}

function fromJson(text, fallback) {
  if (text == null) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

/* ---------------------------------------------------------------------
   Schema — one table per application concept (same columns, same intent
   throughout the app) so the row<->app-shape mapping code stays simple.
   Booleans are stored as INTEGER
   (0/1) since SQLite has no boolean type; JSON-shaped columns are TEXT.
   `id` columns are TEXT (UUIDv4, generated in JS with crypto.randomUUID()
   — SQLite has no gen_random_uuid()) except activity_log/media/leads/
   conversations, which use the same TEXT-UUID pattern for consistency.
   --------------------------------------------------------------------- */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  subtitle           TEXT NOT NULL DEFAULT '',
  short_description  TEXT NOT NULL DEFAULT '',
  full_description   TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT '',
  client             TEXT NOT NULL DEFAULT '',
  location           TEXT NOT NULL DEFAULT '',
  completion_date    TEXT,
  featured           INTEGER NOT NULL DEFAULT 0,
  published          INTEGER NOT NULL DEFAULT 0,
  cover_image        TEXT NOT NULL DEFAULT '',
  gallery            TEXT NOT NULL DEFAULT '[]',
  technologies       TEXT NOT NULL DEFAULT '[]',
  services           TEXT NOT NULL DEFAULT '[]',
  website_url        TEXT NOT NULL DEFAULT '',
  overview           TEXT NOT NULL DEFAULT '',
  challenge          TEXT NOT NULL DEFAULT '',
  solution           TEXT NOT NULL DEFAULT '',
  results            TEXT NOT NULL DEFAULT '[]',
  seo_title          TEXT NOT NULL DEFAULT '',
  seo_description    TEXT NOT NULL DEFAULT '',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS projects_published_idx ON projects (published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_featured_idx  ON projects (featured) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_category_idx  ON projects (category);
CREATE INDEX IF NOT EXISTS projects_sort_idx      ON projects (sort_order DESC);

CREATE TABLE IF NOT EXISTS news (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  excerpt            TEXT NOT NULL DEFAULT '',
  content            TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT '',
  author             TEXT NOT NULL DEFAULT '',
  cover_image        TEXT NOT NULL DEFAULT '',
  video_url          TEXT NOT NULL DEFAULT '',
  published          INTEGER NOT NULL DEFAULT 0,
  seo_title          TEXT NOT NULL DEFAULT '',
  seo_description    TEXT NOT NULL DEFAULT '',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS news_published_idx ON news (published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS news_created_idx   ON news (created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id             TEXT PRIMARY KEY,
  file_name      TEXT NOT NULL,
  file_url       TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  mime_type      TEXT NOT NULL DEFAULT '',
  size           INTEGER NOT NULL DEFAULT 0,
  width          INTEGER,
  height         INTEGER,
  folder         TEXT NOT NULL DEFAULT '',
  uploaded_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS media_folder_idx   ON media (folder);
CREATE INDEX IF NOT EXISTS media_uploaded_idx ON media (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  site_name        TEXT NOT NULL DEFAULT 'VELIX Web Solutions',
  logo             TEXT NOT NULL DEFAULT '',
  favicon          TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  address          TEXT NOT NULL DEFAULT '',
  social_links     TEXT NOT NULL DEFAULT '{}',
  seo_defaults     TEXT NOT NULL DEFAULT '{}',
  hero_video_url   TEXT NOT NULL DEFAULT '',
  hero_poster      TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS leads (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  company          TEXT NOT NULL DEFAULT '',
  project_details  TEXT NOT NULL DEFAULT '',
  budget           TEXT NOT NULL DEFAULT '',
  timeline         TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'Website Form',
  session_id       TEXT,
  conversation_id  TEXT,
  status           TEXT NOT NULL DEFAULT 'New',
  notes            TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS leads_status_idx  ON leads (status);
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  messages     TEXT NOT NULL DEFAULT '[]',
  session_id   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations (session_id);
CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS activity_log (
  id     TEXT PRIMARY KEY,
  text   TEXT NOT NULL,
  icon   TEXT NOT NULL DEFAULT 'dot',
  at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS activity_at_idx ON activity_log (at DESC);

-- updated_at triggers: SQLite has no "before update, set new.updated_at"
-- language runtime like Postgres's plpgsql — an AFTER UPDATE trigger that
-- writes the column itself (guarded so it doesn't recurse) is the
-- standard equivalent.
CREATE TRIGGER IF NOT EXISTS projects_set_updated_at
AFTER UPDATE ON projects FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS news_set_updated_at
AFTER UPDATE ON news FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE news SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS settings_set_updated_at
AFTER UPDATE ON settings FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS leads_set_updated_at
AFTER UPDATE ON leads FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE leads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
`;

function openDatabase() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const instance = new DatabaseSync(DB_PATH);
  // WAL = readers don't block the writer and vice versa (this app is a
  // single Node process, but the admin dashboard and public pages can
  // both be querying at once). busy_timeout makes a rare lock contention
  // retry briefly instead of throwing SQLITE_BUSY immediately.
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec('PRAGMA busy_timeout = 5000;');
  instance.exec(SCHEMA_SQL);
  return instance;
}

function getDb() {
  if (!db) db = openDatabase();
  return db;
}

module.exports = { getDb, uuid, toJson, fromJson, DB_PATH, DATA_DIR };
