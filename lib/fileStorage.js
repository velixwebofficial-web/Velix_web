// lib/fileStorage.js
// ============================================================================
// VELIX — LOCAL FILE STORAGE
//
// Every uploaded file (project covers/galleries, news covers/videos, media
// library items) is written to disk under uploads/, served back out by
// server.js's static file handler at /uploads/<bucket>/<filename>, and its
// metadata recorded in the SQLite `media` table (see lib/db.js and
// api/admin/data.js's handleMedia()).
//
// SECURITY — this is the one place file uploads are actually accepted, so
// it is the real enforcement point (a client-side check, see
// assets/js/admin-api.js's validateUploadFile(), is a courtesy for instant
// feedback only and can always be bypassed by calling the API directly):
//   - MIME type is checked against a fixed allowlist (the formats this
//     site actually uses — see ALLOWED below).
//   - The file's saved name and extension are NEVER derived from the
//     client-supplied original filename — only from the *validated* MIME
//     type, via EXT_FOR_MIME below, plus a random UUID. This means the
//     original filename cannot inject a path (no path traversal is even
//     possible — nothing user-supplied ever becomes part of a filesystem
//     path) and cannot smuggle in a dangerous extension (.exe, .php,
//     .html, etc. can never appear on disk no matter what the browser
//     sent as a filename).
//   - Size is capped per media kind (image vs video) and enforced while
//     the upload is still streaming in (server.js aborts the connection
//     once the configured cap is exceeded, not after buffering the whole
//     thing) — see MAX_BYTES below and its use in server.js.
//   - deleteUploadedFile() re-validates that the path it's asked to
//     delete resolves inside UPLOADS_ROOT before touching the filesystem,
//     even though every storage_path it's ever called with originates
//     from this module's own saveUploadedFile() in the first place.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const UPLOADS_ROOT = path.join(ROOT, 'uploads');

// The only buckets that exist — matches the required layout exactly.
const BUCKETS = ['projects', 'news', 'media', 'general'];

// Only the formats the existing site actually uses anywhere (project/news
// images, project/news video). Nothing executable, nothing else.
const EXT_FOR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
};
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;   // 8 MB
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;  // 50 MB

function isVideoMime(mimeType) {
  return /^video\//.test(mimeType || '');
}

function maxBytesFor(mimeType) {
  return isVideoMime(mimeType) ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
}

function isAllowedMime(mimeType) {
  return Object.prototype.hasOwnProperty.call(EXT_FOR_MIME, mimeType);
}

// A client sends a free-text "folder" hint (e.g. "projects/cover",
// "projects/gallery", "news/cover", "news/video", or nothing at all for a
// plain Media Library upload). Map that hint to one of the four fixed
// buckets required by this migration — never trust it as a literal path
// segment. Unrecognized/absent input safely falls through to "general".
function resolveBucket(folderHint) {
  const f = (folderHint || '').toString().toLowerCase();
  if (f.startsWith('project')) return 'projects';
  if (f.startsWith('news')) return 'news';
  if (f.startsWith('media') || f === 'uploads' || !f) return 'media';
  return 'general';
}

function ensureUploadDirs() {
  if (!fs.existsSync(UPLOADS_ROOT)) fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  for (const bucket of BUCKETS) {
    const dir = path.join(UPLOADS_ROOT, bucket);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Validates and writes an already-fully-read file buffer to disk.
 * @param {Buffer} buffer - the raw file bytes (already size-capped by the
 *        caller while streaming — see server.js's upload route).
 * @param {string} mimeType - the Content-Type the client declared; this is
 *        what determines the saved extension, NOT the original filename.
 * @param {string} folderHint - free-text bucket hint from the client.
 * @returns {{ok:true, url, storagePath, bucket, fileName, mimeType, size}}
 *          or {ok:false, error} — never throws for a validation failure,
 *          only for a genuine filesystem error.
 */
function saveUploadedFile(buffer, mimeType, folderHint) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, error: 'No file data received.' };
  }
  if (!isAllowedMime(mimeType)) {
    return { ok: false, error: `Unsupported file type "${mimeType || 'unknown'}". Allowed: ${Object.keys(EXT_FOR_MIME).join(', ')}.` };
  }
  const max = maxBytesFor(mimeType);
  if (buffer.length > max) {
    return { ok: false, error: `File is too large (${(buffer.length / (1024 * 1024)).toFixed(1)} MB). Max is ${(max / (1024 * 1024)).toFixed(0)} MB.` };
  }

  ensureUploadDirs();
  const bucket = resolveBucket(folderHint);
  const ext = EXT_FOR_MIME[mimeType];
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const storagePath = `${bucket}/${fileName}`; // stored in the DB and used to build the public URL
  const absPath = path.join(UPLOADS_ROOT, bucket, fileName);

  // Defense in depth: absPath is built entirely from server-controlled
  // values (a fixed bucket name + a random hex filename), so this can
  // never actually resolve outside UPLOADS_ROOT — but check anyway,
  // the same way every path-handling function in this codebase does.
  if (!absPath.startsWith(UPLOADS_ROOT + path.sep)) {
    return { ok: false, error: 'Invalid upload path.' };
  }

  fs.writeFileSync(absPath, buffer);

  return {
    ok: true,
    url: `/uploads/${storagePath}`,
    storagePath,
    bucket,
    fileName,
    mimeType,
    size: buffer.length
  };
}

/**
 * Deletes a previously-saved file. storagePath is expected in the
 * "bucket/filename" shape saveUploadedFile() returns (and what's stored
 * in the media table's storage_path column). Silently no-ops if the file
 * is already gone — deleting a media record whose file was already
 * removed by hand should not be a hard error.
 */
function deleteUploadedFile(storagePath) {
  if (!storagePath || typeof storagePath !== 'string') return { ok: true };
  const absPath = path.join(UPLOADS_ROOT, storagePath);
  if (!absPath.startsWith(UPLOADS_ROOT + path.sep)) {
    return { ok: false, error: 'Refused to delete a path outside the uploads directory.' };
  }
  try {
    fs.unlinkSync(absPath);
  } catch (e) {
    if (e.code !== 'ENOENT') return { ok: false, error: e.message };
  }
  return { ok: true };
}

module.exports = {
  UPLOADS_ROOT,
  BUCKETS,
  EXT_FOR_MIME,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  isVideoMime,
  maxBytesFor,
  isAllowedMime,
  resolveBucket,
  ensureUploadDirs,
  saveUploadedFile,
  deleteUploadedFile
};
