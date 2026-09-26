// api/admin/upload.js
// ============================================================================
// Local-storage file upload — a single request replaces a two-step
// signed-upload-URL flow (client asks for a signed URL, client uploads
// straight to a remote storage service, client tells the server to record
// the metadata). There is no equivalent of a "signed URL" for a local
// filesystem, so this collapses that into one request: the client POSTs
// the raw file bytes directly to
// this endpoint (no multipart form — one file per request, which is all
// assets/js/admin-api.js's uploadFile() ever needed, even for a multi-file
// gallery add: it calls this once per file), the server validates and
// writes it to disk (lib/fileStorage.js), and records it in the `media`
// table in the same request — so a partial failure can't leave an
// orphaned Storage object with no DB row, or a DB row with no file, the
// way the old two-step flow theoretically could.
//
// Request:  POST /api/admin/upload?folder=<hint>&fileName=<original name>&width=<n>&height=<n>
//           Body: raw file bytes. Content-Type: the file's real MIME type.
// Response: { ok, data: { id, url, fileName, mimeType, size, width, height, folder } }
//
// requireAdmin() first, same as every other privileged write in this app.
// The size cap is enforced twice: server.js aborts the connection while
// still streaming in if the body exceeds its configured max (so a
// deliberately huge upload can't exhaust server memory before this
// handler even runs), and saveUploadedFile() re-checks the final buffer
// length against the per-media-kind cap regardless.
// ============================================================================

const { requireAdmin } = require('../../lib/adminAuth');
const { getDb, uuid } = require('../../lib/db');
const { saveUploadedFile, deleteUploadedFile } = require('../../lib/fileStorage');

// Original filenames are for display only (the Media Library list, an alt
// text fallback) — never trusted for anything filesystem-related (see
// lib/fileStorage.js's saveUploadedFile(), which derives the on-disk name
// solely from the validated MIME type + a random value). Still worth a
// light sanitize before it goes into the database: strip control
// characters and cap the length.
function sanitizeDisplayName(name) {
  if (typeof name !== 'string' || !name) return 'file';
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'file';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const session = requireAdmin(req, res); // sends 401 itself if not authenticated
  if (!session) return;

  // server.js keeps a non-JSON body as a raw Buffer specifically so this
  // route can accept binary data untouched — see its handleApi().
  const buffer = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buffer || !buffer.length) {
    res.status(400).json({ ok: false, error: 'No file data received.' });
    return;
  }

  const mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
  const query = req.query || {};
  const folderHint = typeof query.folder === 'string' ? query.folder : '';
  const originalName = sanitizeDisplayName(typeof query.fileName === 'string' ? decodeURIComponent(query.fileName) : '');
  const width = query.width ? Number(query.width) || null : null;
  const height = query.height ? Number(query.height) || null : null;

  const saved = saveUploadedFile(buffer, mimeType, folderHint);
  if (!saved.ok) {
    res.status(400).json({ ok: false, error: saved.error });
    return;
  }

  try {
    const db = getDb();
    const id = uuid();
    db.prepare(`
      INSERT INTO media (id, file_name, file_url, storage_path, mime_type, size, width, height, folder)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, originalName, saved.url, saved.storagePath, saved.mimeType, saved.size, width, height, saved.bucket);

    res.status(201).json({
      ok: true,
      data: { id, url: saved.url, fileName: originalName, mimeType: saved.mimeType, size: saved.size, width, height, folder: saved.bucket }
    });
  } catch (err) {
    // The file is already on disk but its DB record failed — clean up
    // rather than leave an orphaned file with nothing pointing at it.
    console.error('[api/admin/upload] DB insert failed after file write; removing orphaned file', err);
    deleteUploadedFile(saved.storagePath);
    res.status(500).json({ ok: false, error: 'Could not save the upload record. Please try again.' });
  }
};
