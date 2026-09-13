/* ==========================================================================
   VELIX WEB SOLUTIONS — DATA STORE (static-first, public read layer)

   ARCHITECTURE (see lib/publish.js for the writing side of this):
   Projects and news are read from plain static JSON files —
   /public-data/projects.json and /public-data/news.json — generated from
   SQLite by the admin server every time content is published, and pushed
   to whatever static host serves this site (GitHub Pages / Cloudflare
   Pages / Vercel static / etc.). That means every public page (Home,
   Services, Portfolio, a project page, News, a news article) renders
   correctly from a plain static file server with the Node backend
   completely OFF — there is no request to this app's own API on the read
   path at all, so the backend being down can never break a public page.
   The backend is required only for /admin (see assets/js/admin-api.js).

   Writes (the contact form's VELIX.leads.create, the chat widget's
   VELIX.conversations.save) still go through the server's own validated
   /api/* endpoints, same as before — those are genuinely privileged
   actions with nowhere else to go, and every caller already treats a
   failure there as non-fatal to the page (see script.js's contact-form
   handler and chat-widget.js's local fallback), so a backend outage still
   never breaks page rendering.

   The public API shape (VELIX.projects.*, VELIX.news.*, etc.) is
   unchanged, so no public page needed to change. Every read is backed by
   an in-memory cache populated once from the static JSON files (see
   initialLoad()) and kept fresh with a lightweight periodic refetch (see
   POLL_INTERVAL_MS below) — a cache-busting query string defeats any
   static-host/CDN/browser caching so an admin publish is visible on an
   already-open page within one poll interval, exactly like the previous
   API-polling behavior.
   ========================================================================== */

(function (global) {
  const POLL_INTERVAL_MS = 45000; // how often public pages re-check for a new publish
  const PROJECTS_URL = '/public-data/projects.json';
  const NEWS_URL = '/public-data/news.json';

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function notifyStorageError(store, action, error) {
    console.error('VELIX data error', store, action, error);
    try {
      global.dispatchEvent(new CustomEvent('velix:storage-error', {
        detail: { store, action, message: (error && error.message) || String(error) }
      }));
    } catch (e) { /* CustomEvent unsupported — ignore, error is still logged above */ }
  }

  function notifyUpdated(table) {
    try { global.dispatchEvent(new CustomEvent('velix:updated', { detail: { table } })); } catch (e) { /* ignore */ }
  }

  function clone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  /* -------------------------------------------------------------------
     Small fetch wrapper for the read-only public API. Every endpoint
     here returns { ok, data } or { ok: false, error } — this normalizes
     both a network-level failure and an { ok: false } response into the
     same "throw with a useful message" shape so callers can just
     try/catch (or let notifyStorageError below handle it uniformly).
     ------------------------------------------------------------------- */
  async function apiGet(path) {
    let res;
    try {
      res = await fetch(path, { credentials: 'same-origin' });
    } catch (networkErr) {
      const err = new Error(`Could not reach the server at ${path}.`);
      err.cause = networkErr;
      throw err;
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* fall through to the !ok check below */ }
    if (!res.ok || !json || json.ok === false) {
      throw new Error((json && json.error) || `Request to ${path} failed (status ${res.status}).`);
    }
    return json.data;
  }

  /* -------------------------------------------------------------------
     Static-JSON fetch for the publish snapshot files (public-data/*.json —
     see lib/publish.js). These are plain arrays, not the {ok, data}
     envelope the /api/* routes use, and the query-string timestamp is
     there purely to defeat caching (browser and/or the static host's CDN)
     so a fresh publish shows up within one poll interval rather than
     whenever some cache layer's TTL happens to expire.
     ------------------------------------------------------------------- */
  async function fetchStaticJson(url) {
    const bustedUrl = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
    let res;
    try {
      res = await fetch(bustedUrl, { credentials: 'same-origin', cache: 'no-store' });
    } catch (networkErr) {
      const err = new Error(`Could not load ${url}.`);
      err.cause = networkErr;
      throw err;
    }
    // A 404 here just means nothing has ever been published yet (a fresh
    // deploy before the first Admin publish) — that is an empty site, not
    // an error, so it resolves to [] instead of throwing.
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Request to ${url} failed (status ${res.status}).`);
    try {
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      throw new Error(`${url} did not contain valid JSON.`);
    }
  }

  async function apiPost(path, body) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    } catch (networkErr) {
      const err = new Error(`Could not reach the server at ${path}.`);
      err.cause = networkErr;
      throw err;
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* fall through to the !ok check below */ }
    if (!res.ok || !json || json.ok === false) {
      const err = new Error((json && json.error) || `Request to ${path} failed (status ${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  /* -------------------------------------------------------------------
     In-memory caches. Populated from the local API, kept fresh with a
     periodic poll (see POLL_INTERVAL_MS). Every VELIX.projects and
     VELIX.news read stays synchronous, exactly as before, by reading off
     these caches — the public API (see api/public/projects.js and
     api/public/news.js) only ever returns PUBLISHED, non-deleted rows,
     so these caches can never hold anything a visitor shouldn't see.
     ------------------------------------------------------------------- */
  let projectsCache = [];
  let newsCache = [];

  async function fetchProjects() {
    try {
      projectsCache = await fetchStaticJson(PROJECTS_URL);
    } catch (error) {
      notifyStorageError('projects', 'fetch', error);
    }
  }

  async function fetchNews() {
    try {
      newsCache = await fetchStaticJson(NEWS_URL);
    } catch (error) {
      notifyStorageError('news', 'fetch', error);
    }
  }

  async function initialLoad() {
    await Promise.all([fetchProjects(), fetchNews()]);
  }

  /* Periodic refresh: static files have no push channel to the browser, so
     this re-fetches both public-data/*.json files every POLL_INTERVAL_MS
     and fires velix:updated only when the underlying data actually changed
     (a cheap JSON-string comparison), so pages that don't care don't
     re-render needlessly. */
  function startPolling() {
    let lastProjectsJson = JSON.stringify(projectsCache);
    let lastNewsJson = JSON.stringify(newsCache);
    setInterval(async () => {
      await fetchProjects();
      const projectsJson = JSON.stringify(projectsCache);
      if (projectsJson !== lastProjectsJson) {
        lastProjectsJson = projectsJson;
        notifyUpdated('projects');
      }
      await fetchNews();
      const newsJson = JSON.stringify(newsCache);
      if (newsJson !== lastNewsJson) {
        lastNewsJson = newsJson;
        notifyUpdated('news');
      }
    }, POLL_INTERVAL_MS);
  }

  const ready = initialLoad()
    .catch(e => notifyStorageError('init', 'load', e))
    .then(startPolling);

  /* ---------------------------------------------------------------------
     PUBLIC API — same shape as before for everything that isn't a
     privileged admin write. Admin writes/reads-of-private-data live on
     VELIX.admin.* (assets/js/admin-api.js, admin.html only) instead of
     here.
     --------------------------------------------------------------------- */
  const VELIX = {
    uid,
    ready,
    MAX_GALLERY_IMAGES: 15,

    projects: {
      all() { return clone(projectsCache); },
      get(id) { return clone(projectsCache.find(p => p.id === id)) || null; },
      getBySlug(slug) { return clone(projectsCache.find(p => p.slug === slug)) || null; },
      featured() { return clone(projectsCache.filter(p => p.featured)); },
      byCategory(cat) { return clone(cat ? projectsCache.filter(p => p.category === cat) : projectsCache); },
      categories() { return [...new Set(projectsCache.map(p => p.category).filter(Boolean))]; },
      count() { return projectsCache.length; },
      neighbors(project) {
        const idx = projectsCache.findIndex(p => p.id === project.id);
        if (idx === -1 || !projectsCache.length) return { prev: null, next: null };
        const len = projectsCache.length;
        return {
          prev: len > 1 ? clone(projectsCache[(idx - 1 + len) % len]) : null,
          next: len > 1 ? clone(projectsCache[(idx + 1) % len]) : null
        };
      },
      related(project, limit) {
        limit = limit || 3;
        return clone(projectsCache
          .filter(p => p.id !== project.id && p.category === project.category)
          .concat(projectsCache.filter(p => p.id !== project.id && p.category !== project.category))
          .slice(0, limit));
      },
      // Client-side filter over the already-fetched public cache — the
      // public API has no separate search endpoint (only published rows
      // are ever in this cache to begin with, so there is nothing extra
      // a server-side search would need to protect against).
      async search(term) {
        const t = (term || '').toLowerCase();
        if (!t) return clone(projectsCache);
        return clone(projectsCache.filter(p =>
          (p.title || '').toLowerCase().includes(t) ||
          (p.client || '').toLowerCase().includes(t) ||
          (p.category || '').toLowerCase().includes(t)
        ));
      }
    },

    news: {
      all() { return clone(newsCache).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); },
      get(id) { return clone(newsCache.find(n => n.id === id)) || null; },
      getBySlug(slug) { return clone(newsCache.find(n => n.slug === slug)) || null; },
      categories() { return [...new Set(newsCache.map(n => n.category).filter(Boolean))]; },
      async search(term) {
        const t = (term || '').toLowerCase();
        if (!t) return clone(newsCache);
        return clone(newsCache.filter(n =>
          (n.title || '').toLowerCase().includes(t) ||
          (n.excerpt || '').toLowerCase().includes(t) ||
          (n.category || '').toLowerCase().includes(t)
        ));
      }
    },

    media: {
      // Only ever called by admin.html's Media Library panel (confirmed
      // the sole caller). Throws on failure (in addition to the usual
      // notifyStorageError/banner) instead of swallowing it into an empty
      // array: an admin looking at "no media" needs to be able to tell
      // "the library is genuinely empty" apart from "the request failed."
      // admin.html's renderMedia() already has a try/catch expecting this.
      async list(folder, limit) {
        const params = new URLSearchParams();
        if (folder) params.set('folder', folder);
        if (limit) params.set('limit', String(limit));
        const qs = params.toString();
        try {
          return await apiGet('/api/public/media' + (qs ? `?${qs}` : ''));
        } catch (error) {
          notifyStorageError('media', 'list', error);
          throw error;
        }
      }
    },

    session: {
      getToken() {
        // Anonymous visitor identifier used only to correlate chat leads —
        // not an auth credential. A random per-browser value is fine here.
        let token = null;
        try { token = sessionStorage.getItem('velix_visitor_token'); } catch (e) { /* ignore */ }
        if (!token) {
          token = uid('visitor');
          try { sessionStorage.setItem('velix_visitor_token', token); } catch (e) { /* ignore */ }
        }
        return token;
      }
    },

    leads: {
      // Every lead now goes through the server's validated /api/leads
      // endpoint — the frontend has no way to write to the database
      // directly (see api/leads.js, backed by lib/store.js -> SQLite).
      async create(lead) {
        const payload = {
          name: lead.name || 'Unknown visitor',
          phone: lead.phone || '',
          email: lead.email || '',
          company: lead.company || '',
          projectDetails: lead.projectDetails || lead.project_details || '',
          budget: lead.budget || '',
          timeline: lead.timeline || '',
          source: lead.source || 'Website Form',
          sessionId: lead.sessionId || lead.session_id || VELIX.session.getToken(),
          conversationId: lead.conversationId || lead.conversation_id || null
        };
        try {
          const result = await apiPost('/api/leads', payload);
          return result.lead;
        } catch (error) {
          notifyStorageError('leads', 'create', error);
          throw error;
        }
      }
    },

    conversations: {
      async save(conversation) {
        // Fire-and-forget from the chat widget's point of view (a
        // transcript-save failure must never interrupt an active
        // conversation), but every failure is still logged, not silent —
        // see api/conversations.js for the server-side validation.
        try {
          await apiPost('/api/conversations', {
            id: conversation.id,
            messages: conversation.messages || [],
            sessionId: VELIX.session.getToken()
          });
        } catch (error) {
          notifyStorageError('conversations', 'save', error);
        }
      }
    },

    settings: {
      _cache: null,
      async get() {
        try {
          const data = await apiGet('/api/public/settings');
          VELIX.settings._cache = data;
          return data;
        } catch (error) {
          notifyStorageError('settings', 'fetch', error);
          return VELIX.settings._cache || {};
        }
      }
    }
  };

  global.VELIX = VELIX;
})(window);
