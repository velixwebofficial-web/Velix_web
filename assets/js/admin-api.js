/* ==========================================================================
   VELIX — ADMIN API CLIENT (admin.html only)

   Talks exclusively to /api/admin/* — the new server-side session-cookie
   auth system in lib/adminAuth.js + api/admin/*.js. This file replaces
   every staff-gated method that used to live on VELIX.* in store.js
   (VELIX.auth, VELIX.projects.save/remove/..., VELIX.news.save/remove/...,
   VELIX.leads.update/remove/addNote, VELIX.conversations.all,
   VELIX.activity.all, VELIX.settings.save, VELIX.media.remove, uploadFile).

   Nothing here ever holds a password or a session token in JS — the
   session lives entirely in an HttpOnly cookie the browser manages on its
   own; this file only ever calls fetch() with credentials included and
   reads back plain JSON results. A 401 from any call means "not logged
   in" — this file does not and cannot fake a logged-in state.

   Only admin.html loads this script. Public pages never do, and never
   need to: they still read published content through the ordinary
   VELIX.projects / VELIX.news read methods in store.js, backed by the
   local /api/public/* endpoints.
   ========================================================================== */
(function (global) {
  /* Every failure mode below is surfaced with a distinct, useful message
     instead of letting a raw "Failed to fetch" (or nothing at all) reach
     the login screen — that exact message is what the browser's fetch()
     throws for a NETWORK-level failure (no server listening, wrong
     origin, CORS blocked, DNS/connection failure — importantly, this is
     what you get if this page is opened as a file:// path, or the local
     dev server / deployment simply isn't running), which is a completely
     different problem from a 401 ("wrong credentials") or a 500 ("server
     is up but the request failed"). Distinguishing them is what lets
     someone actually fix the right thing instead of assuming the admin
     code itself is broken. */
  async function call(path, options) {
    let res;
    try {
      res = await fetch(path, Object.assign({
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      }, options));
    } catch (networkErr) {
      const error = new Error(
        'Could not reach the server at ' + path + '. This page needs to be served over ' +
        'http(s) by a running server — it will not work opened as a file:// path. If ' +
        'you\'re developing locally, make sure `npm run dev` is running and you opened ' +
        'this page at its http://localhost address; if this is a live deployment, the ' +
        'server may be down or misconfigured.'
      );
      error.networkError = true;
      error.cause = networkErr;
      throw error;
    }

    let json = null;
    let parseError = null;
    try { json = await res.json(); } catch (e) { parseError = e; }

    if (parseError) {
      const error = new Error(`The server responded (status ${res.status}) but not with valid JSON — this usually means a misconfigured route or an unhandled server error, not a login problem.`);
      error.status = res.status;
      error.invalidJson = true;
      throw error;
    }

    if (!res.ok || !json || json.ok === false) {
      const fallback = {
        400: 'The request was malformed.',
        401: 'Not signed in, or the session has expired.',
        403: 'You do not have permission to do that.',
        404: `No API route found at ${path}. If you're running this locally, this usually means server.js isn't running — see "How to start the server" in README.md.`,
        429: 'Too many attempts — please wait a few minutes and try again.',
        500: 'The server hit an internal error handling this request.',
        503: 'The server is up, but a required service (e.g. the database) is not configured yet.'
      }[res.status] || `Request failed (status ${res.status}).`;
      const error = new Error((json && json.error) || fallback);
      error.status = res.status;
      throw error;
    }
    return json;
  }

  function post(path, body) {
    return call(path, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  function gateway(resource, action, payload) {
    return post('/api/admin/data', { resource, action, payload }).then(r => r.data);
  }

  /* ---------------------------------------------------------------------
     Media upload: POST the raw file bytes directly to
     /api/admin/upload?folder=...&fileName=...&width=...&height=... — the
     server validates type/size, writes the file to the local uploads/
     directory, and records it in the media table, all in one request (see
     api/admin/upload.js and lib/fileStorage.js). There is no signed-URL
     step and no separate storage service: the file goes straight from the
     browser to this Node server and onto local disk.
     --------------------------------------------------------------------- */
  // Client-side validation is a courtesy for instant feedback only — the
  // real enforcement is server-side (lib/fileStorage.js's EXT_FOR_MIME
  // allowlist), since this check can always be bypassed by calling the API
  // directly. Kept here anyway so an admin gets an immediate, clear error
  // instead of waiting on a round trip for something obviously wrong.
  const UPLOAD_LIMITS = {
    image: { types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'], maxBytes: 8 * 1024 * 1024, label: 'JPG, PNG, WebP, GIF, or SVG image under 8 MB' },
    video: { types: ['video/mp4', 'video/webm'], maxBytes: 50 * 1024 * 1024, label: 'MP4 or WebM video under 50 MB' }
  };
  function validateUploadFile(file) {
    const kind = /^video\//.test(file.type) ? 'video' : 'image';
    const rule = UPLOAD_LIMITS[kind];
    if (!rule.types.includes(file.type)) {
      throw new Error(`"${file.name}" is not an allowed file type. Please choose a ${rule.label}.`);
    }
    if (file.size > rule.maxBytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`"${file.name}" is ${mb} MB, which is too large. Please choose a ${rule.label}.`);
    }
  }

  async function readFileDimensions(file) {
    if (!/^image\//.test(file.type) || file.type === 'image/svg+xml') return { width: null, height: null };
    try {
      const dims = await new Promise((resolve) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(objUrl); };
        img.onerror = () => { resolve({ w: null, h: null }); URL.revokeObjectURL(objUrl); };
        img.src = objUrl;
      });
      return { width: dims.w, height: dims.h };
    } catch (e) {
      return { width: null, height: null }; // best-effort only
    }
  }

  async function uploadFile(file, folder) {
    if (!file) return '';
    validateUploadFile(file);
    const { width, height } = await readFileDimensions(file);

    const params = new URLSearchParams();
    params.set('folder', folder || 'uploads');
    params.set('fileName', encodeURIComponent(file.name || 'file'));
    if (width) params.set('width', String(width));
    if (height) params.set('height', String(height));

    let res;
    try {
      res = await fetch(`/api/admin/upload?${params.toString()}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
    } catch (networkErr) {
      const error = new Error('Could not reach the server to upload this file.');
      error.networkError = true;
      throw error;
    }

    let json = null;
    try { json = await res.json(); } catch (e) { /* handled by the !res.ok check below */ }
    if (!res.ok || !json || json.ok === false) {
      throw new Error((json && json.error) || `Upload failed (status ${res.status}).`);
    }

    return json.data.url;
  }

  const admin = {
    auth: {
      async login(email, password) {
        try {
          const r = await post('/api/admin/login', { email, password });
          return { ok: true, email: r.email };
        } catch (e) {
          // 401 here just means "wrong credentials" — call() already gives
          // that a clear message. A network error, an invalid-JSON
          // response, or a 5xx get their own distinct messages too (see
          // call() above), so whatever reaches the login screen actually
          // describes what went wrong instead of a bare "Failed to fetch".
          return { ok: false, error: e.message, networkError: !!e.networkError, status: e.status || null };
        }
      },
      async logout() {
        try { await post('/api/admin/logout'); } catch (e) { /* clear the local UI state regardless — worst case the cookie outlives its usefulness until it expires on its own */ }
      },
      async checkSession() {
        // A 401 here is the NORMAL, expected shape of "not logged in yet"
        // — it is not an error and must not be reported as one. Only a
        // genuine network-level failure (no server reachable at all,
        // e.g. this page opened as file://, or the server isn't running)
        // is worth surfacing distinctly, so the login screen can explain
        // *that* instead of just looking like an ordinary logged-out state.
        let res;
        try {
          res = await fetch('/api/admin/session', { credentials: 'same-origin' });
        } catch (networkErr) {
          return {
            authenticated: false,
            networkError: true,
            error: 'Could not reach the admin server at /api/admin/session. If you\'re developing ' +
              'locally, make sure `npm run dev` is running and this page is open at its ' +
              'http://localhost address — this will not work opened as a file:// path.'
          };
        }
        if (!res.ok) return { authenticated: false };
        let json;
        try { json = await res.json(); } catch (e) { return { authenticated: false }; }
        return { authenticated: !!json.authenticated, email: json.email || null };
      }
    },

    projects: {
      all: () => gateway('projects', 'all'),
      trashed: () => gateway('projects', 'trashed'),
      save: (project) => gateway('projects', 'save', project),
      remove: (id) => gateway('projects', 'remove', { id }),
      restore: (id) => gateway('projects', 'restore', { id }),
      permanentlyDelete: (id) => gateway('projects', 'permanentlyDelete', { id }),
      setPublished: (id, published) => gateway('projects', 'setPublished', { id, published }),
      setFeatured: (id, featured) => gateway('projects', 'setFeatured', { id, featured }),
      duplicate: (id) => gateway('projects', 'duplicate', { id }),
      bulk: (ids, bulkAction) => gateway('projects', 'bulk', { ids, bulkAction })
    },

    news: {
      all: () => gateway('news', 'all'),
      save: (article) => gateway('news', 'save', article),
      remove: (id) => gateway('news', 'remove', { id }),
      restore: (id) => gateway('news', 'restore', { id }),
      setPublished: (id, published) => gateway('news', 'setPublished', { id, published }),
      bulk: (ids, bulkAction) => gateway('news', 'bulk', { ids, bulkAction })
    },

    leads: {
      all: () => gateway('leads', 'all'),
      update: (id, patch) => gateway('leads', 'update', { id, patch }),
      remove: (id) => gateway('leads', 'remove', { id }),
      addNote: (id, note) => gateway('leads', 'addNote', { id, note })
    },

    conversations: {
      all: () => gateway('conversations', 'all')
    },

    activity: {
      all: () => gateway('activity', 'all')
    },

    settings: {
      save: (patch) => gateway('settings', 'save', patch)
    },

    media: {
      remove: (id) => gateway('media', 'remove', { id })
    },

    uploadFile
  };

  global.VELIX = global.VELIX || {};
  global.VELIX.admin = admin;
})(window);
