/* ==========================================================================
   VELIX WEB SOLUTIONS — DATA STORE
   Persistent data layer that powers the dynamic Portfolio, News, Leads and
   Settings across the whole site + admin panel.

   STORAGE ARCHITECTURE (post-audit rewrite):
   - Projects & News (the records that hold large base64 images) are stored
     in IndexedDB, which has a quota in the hundreds of MB to several GB
     depending on the browser — enough for ~1000 projects x 15 images each.
   - Leads / Settings / Activity / Conversations (small, no images) stay in
     localStorage for simplicity.
   - A synchronous in-memory cache mirrors IndexedDB so every existing page
     (portfolio.html, project.html, admin.html, chat-widget.js, etc.) can
     keep calling VELIX.projects.all() / VELIX.news.all() exactly as before.
     Pages just need to wait for `VELIX.ready` (a Promise) before their very
     first read, to make sure the cache has been hydrated from IndexedDB.
   - Any failed write (quota exceeded, blocked storage, etc.) now fires a
     'velix:storage-error' event on window instead of failing silently, so
     the admin UI can surface it instead of quietly losing data.

   IMPORTANT (read this before wiring a real backend):
   This is still a client-side data layer — it lives in the visitor's own
   browser, so it will NOT sync across different computers/phones. To make
   this a real production CMS, replace the internals of this file with
   calls to a real backend (Node/Express, Firebase, Supabase, etc.) — the
   rest of the site already calls VELIX.projects.* / VELIX.news.* etc., so
   only this file needs to change.
   ========================================================================== */

(function (global) {
  const KEYS = {
    projects: 'velix_projects',   // legacy localStorage key (migrated from, then cleared)
    news: 'velix_news',           // legacy localStorage key (migrated from, then cleared)
    leads: 'velix_leads',
    settings: 'velix_settings',
    conversations: 'velix_conversations',
    activity: 'velix_activity',
    auth: 'velix_admin_auth',
    session: 'velix_session_token'
  };

  const DB_NAME = 'velix_db';
  const DB_VERSION = 1;
  const STORE_PROJECTS = 'projects';
  const STORE_NEWS = 'news';
  const MAX_GALLERY_IMAGES = 15;
  const MAX_PROJECTS = 1000;

  function notifyStorageError(store, action, error) {
    console.error('VELIX storage error', store, action, error);
    try {
      global.dispatchEvent(new CustomEvent('velix:storage-error', {
        detail: { store, action, message: (error && error.message) || String(error) }
      }));
    } catch (e) { /* CustomEvent unsupported — ignore, error is still logged above */ }
  }

  /* ---------------------------------------------------------------------
     Small localStorage helpers (still used for leads/settings/activity)
     --------------------------------------------------------------------- */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      notifyStorageError(key, 'read', e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      notifyStorageError(key, 'write', e);
      return false;
    }
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function logActivity(text, icon) {
    const activity = read(KEYS.activity, []);
    activity.unshift({ id: uid('act'), text, icon: icon || 'dot', at: new Date().toISOString() });
    write(KEYS.activity, activity.slice(0, 40));
  }

  /* ---------------------------------------------------------------------
     SEED DATA — shown the very first time, before an admin edits anything
     --------------------------------------------------------------------- */
  const SEED_PROJECTS = [
    {
      id: 'proj_seed_1',
      slug: 'marea-fine-dining-restaurant',
      title: 'Marea — Fine Dining Restaurant',
      client: 'Marea Restaurant Group',
      category: 'Restaurant',
      services: ['Web Design', 'Web Development', 'Booking System'],
      technologies: ['HTML5', 'CSS3', 'JavaScript', 'Node.js'],
      completionDate: '2026-03-01',
      featured: true,
      websiteUrl: '',
      description: 'A full digital experience for a fine-dining restaurant: real-time table reservations, a beautifully photographed digital menu, and an events booking flow — built to feel as considered as the food itself.',
      overview: 'Marea needed a digital front door that matched the calm, considered feel of the restaurant itself — not another generic booking widget bolted onto a template site. We designed and built the experience from scratch around their actual guest journey: browse the story, check availability, reserve a table, done.',
      challenge: 'The existing site was a single static page with a PDF menu and a phone number. Guests were abandoning the booking flow because there was no way to see table availability without calling during business hours, and the menu photography wasn\u2019t doing the food any favours on mobile.',
      solution: 'We rebuilt the site around a real-time reservation flow synced to their existing table-management system, re-shot the menu photography for a large-format digital menu, and added an events module so private bookings could be requested directly instead of over email.',
      results: ['42% increase in online reservations within the first month', 'Average session length up from 38s to 2m 10s', 'Private event enquiries moved fully online'],
      cover: '',
      gallery: [],
      _seq: 3
    },
    {
      id: 'proj_seed_2',
      slug: 'origin-specialty-coffee',
      title: 'Origin — Specialty Coffee',
      client: 'Origin Coffee Roasters',
      category: 'E-Commerce',
      services: ['E-Commerce', 'Brand Storytelling', 'Subscriptions'],
      technologies: ['Shopify', 'Liquid', 'JavaScript'],
      completionDate: '2026-01-14',
      featured: true,
      websiteUrl: '',
      description: 'An online store and brand hub for a specialty coffee roastery, with subscription ordering, a roast-origin storytelling section, and same-day delivery scheduling.',
      overview: 'Origin roasts in small batches and wanted their online store to feel as intentional as the coffee itself — with the origin story of every bean given real space, not squeezed into a product description nobody reads.',
      challenge: 'Their previous storefront treated every bag of coffee the same way a generic product listing would, with no way to browse by origin, roast profile, or story — and no subscription option, which was costing them repeat revenue.',
      solution: 'We designed a storytelling-first storefront organized by origin and roast profile, built a flexible subscription flow (weekly / bi-weekly / monthly), and added same-day delivery scheduling for the local market.',
      results: ['Subscription orders now 31% of total revenue', 'Average order value up 18%', 'Same-day delivery adopted by 40% of local customers'],
      cover: '',
      gallery: [],
      _seq: 2
    },
    {
      id: 'proj_seed_3',
      slug: 'meridian-real-estate-platform',
      title: 'Meridian — Real Estate Platform',
      client: 'Meridian Properties',
      category: 'Real Estate',
      services: ['Web Design', 'Web Development', 'Lead Generation'],
      technologies: ['React', 'Node.js', 'PostgreSQL'],
      completionDate: '2025-11-20',
      featured: false,
      websiteUrl: '',
      description: 'A luxury property platform with advanced map-based search, virtual tour embeds and a lead-qualification flow that routes serious buyers straight to an agent.',
      overview: 'Meridian sells properties well above the market average, and their site needed to filter serious buyers from casual browsers without feeling like a wall — while giving agents the qualified context they need before the first call.',
      challenge: 'Leads were arriving as bare contact-form submissions with no context on budget, timeline or which property actually prompted the enquiry, so agents were spending most of a first call just re-qualifying the lead.',
      solution: 'We built a map-based search with saved-search alerts, embedded virtual tours on every listing, and a short qualification flow that captures budget and timeline before routing the lead to the right agent with full context attached.',
      results: ['Agent qualification calls cut by roughly half', 'Saved-search alerts drove 22% of return visits', 'Average lead-to-viewing time down from 6 days to 2'],
      cover: '',
      gallery: [],
      _seq: 1
    }
  ];

  const SEED_NEWS = [
    {
      id: 'news_seed_1',
      title: 'VELIX Web Solutions is now taking on Q3 projects',
      category: 'Studio News',
      cover: '',
      video: '',
      excerpt: "We're opening a limited number of Q3 project slots for new clients across Jordan and the Gulf.",
      body: "<p>We're opening a limited number of Q3 project slots for new clients across Jordan and the Gulf. If you've been thinking about a redesign or a new website built the right way, now is the time to reach out.</p><p>Every project starts with a free consultation — no pressure, just a clear plan.</p>",
      author: 'Moatasm Abdeen',
      createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
      _seq: 1
    }
  ];

  /* --------------------------------------------------------------------------
     IMPORTANT — read this before putting this admin panel online:
     This dashboard checks the password entirely in the browser (client-side).
     Anyone can open DevTools, view this file, and read whatever password is
     set below — a client-side check can NEVER be truly secure by itself.
     For a public production site, do ONE of the following instead of relying
     on this password alone:
       1. Password-protect /admin.html at the hosting level (Vercel/Netlify
          both support this on paid tiers), so the browser never even loads
          this file for the public, OR
       2. Move projects/news/leads to a real backend with server-side auth
          (e.g. a small API + database) instead of localStorage.
     Until then, change the placeholder below to something only you know,
     and treat this panel as a personal convenience tool, not a secure vault.
     -------------------------------------------------------------------------- */
  const SEED_SETTINGS = {
    heroVideoUrl: '',
    heroPoster: '',
    seoTitle: 'VELIX Web Solutions — Premium Web Design & Development',
    seoDescription: 'VELIX Web Solutions designs and builds premium, high-performance websites for ambitious businesses across Jordan, Saudi Arabia, the UAE, Qatar, Kuwait and beyond.',
    darkMode: false,
    adminPassword: 'xK9#mP2$vL7&qRTz8@Wn5*Bh3^Yf6%J2!kQ9#pM6&nX4$'
  };

  function ensureSeedSmallStores() {
    if (!localStorage.getItem(KEYS.leads)) write(KEYS.leads, []);
    if (!localStorage.getItem(KEYS.settings)) write(KEYS.settings, SEED_SETTINGS);
    if (!localStorage.getItem(KEYS.conversations)) write(KEYS.conversations, []);
    if (!localStorage.getItem(KEYS.activity)) write(KEYS.activity, []);
  }
  ensureSeedSmallStores();

  /* ---------------------------------------------------------------------
     IndexedDB layer (projects + news — the record types with big images)
     --------------------------------------------------------------------- */
  const idbSupported = typeof indexedDB !== 'undefined';
  let dbPromise = null;

  function openDB() {
    if (!idbSupported) return Promise.reject(new Error('IndexedDB not supported'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_NEWS)) db.createObjectStore(STORE_NEWS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function idbGetAll(storeName) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function idbPut(storeName, record) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function idbDelete(storeName, id) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function idbBulkPut(storeName, records) {
    if (!records.length) return Promise.resolve(true);
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      records.forEach(r => os.put(r));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  // In-memory caches — these are what every VELIX.projects.* / VELIX.news.*
  // call actually reads from, so all reads stay synchronous like before.
  let projectsCache = [];
  let newsCache = [];
  let projectsSeq = 0;
  let newsSeq = 0;

  function sortBySeqDesc(list) {
    return list.slice().sort((a, b) => (b._seq || 0) - (a._seq || 0));
  }

  // Deep-clone helper: reads (all()/get()/etc.) must hand callers an
  // isolated copy, not a live reference into the cache. Otherwise a caller
  // that mutates a returned object (e.g. the admin edit form appending to
  // project.gallery.desktop before the user hits Save) would silently
  // corrupt the in-memory cache even if Save is never pressed.
  function clone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  /* Gallery model, post-audit: ONE flat array of up to MAX_GALLERY_IMAGES
     image data-URLs. Earlier builds stored { desktop:[], tablet:[], mobile:[] }
     plus a separate beforeAfter:{before,after} pair; this flattens any
     record still in that legacy shape (e.g. already sitting in a returning
     visitor's IndexedDB) into the new shape the very first time it's read,
     so nothing is silently dropped. */
  function flattenGallery(gallery) {
    if (Array.isArray(gallery)) return gallery;
    if (gallery && typeof gallery === 'object') {
      return [].concat(gallery.desktop || [], gallery.tablet || [], gallery.mobile || []);
    }
    return [];
  }

  function normalizeProject(p) {
    if (!p) return p;
    p.gallery = flattenGallery(p.gallery);
    if (p.gallery.length > MAX_GALLERY_IMAGES) p.gallery = p.gallery.slice(0, MAX_GALLERY_IMAGES);
    if (p.beforeAfter) delete p.beforeAfter; // retired field
    // Case-study fields added for the redesigned Project page. Older
    // records simply won't have these yet — default to safe empty values
    // so every template can rely on them existing rather than checking
    // for undefined everywhere.
    if (!Array.isArray(p.services)) p.services = p.services ? [p.services] : [];
    if (typeof p.websiteUrl !== 'string') p.websiteUrl = '';
    if (typeof p.overview !== 'string') p.overview = '';
    if (typeof p.challenge !== 'string') p.challenge = '';
    if (typeof p.solution !== 'string') p.solution = '';
    if (!Array.isArray(p.results)) p.results = p.results ? [p.results] : [];
    return p;
  }

  /* Slugs power the "clean" project URLs (/projects/slug-name, or
     project.html?slug=slug-name where a server rewrite isn't set up — see
     README notes shipped alongside this build). Generated once from the
     title and kept stable after that (editing the title later does NOT
     change an existing slug, so old shared links keep working). */
  function slugify(str) {
    return (str || '').toString().toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project';
  }

  function ensureProjectSlugs(list) {
    const taken = new Map(); // slug -> project id already using it
    list.forEach(p => { if (p.slug) taken.set(p.slug, p.id); });
    list.forEach(p => {
      if (p.slug) return;
      const base = slugify(p.title);
      let slug = base, n = 2;
      while (taken.has(slug) && taken.get(slug) !== p.id) slug = base + '-' + (n++);
      p.slug = slug;
      taken.set(slug, p.id);
    });
    return list;
  }

  /* One-time migration: if the browser still has the old localStorage
     arrays (from before this fix) and IndexedDB is empty, move the data
     over instead of discarding it. */
  function migrateLegacyLocalStorage() {
    let legacyProjects = read(KEYS.projects, null);
    let legacyNews = read(KEYS.news, null);
    const tasks = [];
    if (Array.isArray(legacyProjects) && legacyProjects.length) {
      legacyProjects = legacyProjects.map((p, i) => Object.assign({ _seq: legacyProjects.length - i }, p));
      tasks.push(idbBulkPut(STORE_PROJECTS, legacyProjects).then(() => {
        localStorage.removeItem(KEYS.projects);
      }).catch(e => notifyStorageError('projects', 'migrate', e)));
    }
    if (Array.isArray(legacyNews) && legacyNews.length) {
      legacyNews = legacyNews.map((n, i) => Object.assign({ _seq: legacyNews.length - i }, n));
      tasks.push(idbBulkPut(STORE_NEWS, legacyNews).then(() => {
        localStorage.removeItem(KEYS.news);
      }).catch(e => notifyStorageError('news', 'migrate', e)));
    }
    return Promise.all(tasks);
  }

  function loadCachesFromDB() {
    return Promise.all([idbGetAll(STORE_PROJECTS), idbGetAll(STORE_NEWS)]).then(([projects, news]) => {
      if (!projects.length) {
        projects = SEED_PROJECTS.slice();
        idbBulkPut(STORE_PROJECTS, projects).catch(e => notifyStorageError('projects', 'seed', e));
      }
      if (!news.length) {
        news = SEED_NEWS.slice();
        idbBulkPut(STORE_NEWS, news).catch(e => notifyStorageError('news', 'seed', e));
      }
      const missingSlugIds = new Set(projects.filter(p => !p.slug).map(p => p.id));
      projects = ensureProjectSlugs(projects.map(normalizeProject));
      if (missingSlugIds.size) {
        idbBulkPut(STORE_PROJECTS, projects.filter(p => missingSlugIds.has(p.id)))
          .catch(e => notifyStorageError('projects', 'slug-backfill', e));
      }
      projectsCache = sortBySeqDesc(projects);
      newsCache = sortBySeqDesc(news);
      projectsSeq = projects.reduce((m, p) => Math.max(m, p._seq || 0), 0);
      newsSeq = news.reduce((m, n) => Math.max(m, n._seq || 0), 0);
    });
  }

  // Fallback if IndexedDB is genuinely unavailable (very old/locked-down
  // browser): keep working off localStorage rather than breaking entirely,
  // but this path can't reach the 1000-projects/15-images-each capacity —
  // it's a compatibility fallback, not the primary architecture.
  function loadCachesFromLocalStorageFallback() {
    let projects = read(KEYS.projects, null);
    let news = read(KEYS.news, null);
    if (!Array.isArray(projects) || !projects.length) projects = SEED_PROJECTS.slice();
    if (!Array.isArray(news) || !news.length) news = SEED_NEWS.slice();
    projects = ensureProjectSlugs(projects.map(normalizeProject));
    projects.forEach((p, i) => { if (p._seq == null) p._seq = projects.length - i; });
    news.forEach((n, i) => { if (n._seq == null) n._seq = news.length - i; });
    projectsCache = sortBySeqDesc(projects);
    newsCache = sortBySeqDesc(news);
    projectsSeq = projectsCache.reduce((m, p) => Math.max(m, p._seq || 0), 0);
    newsSeq = newsCache.reduce((m, n) => Math.max(m, n._seq || 0), 0);
    write(KEYS.projects, projectsCache);
    write(KEYS.news, newsCache);
  }

  let usingFallback = false;

  const ready = (idbSupported
    ? migrateLegacyLocalStorage().then(loadCachesFromDB).catch(e => {
        notifyStorageError('db', 'init', e);
        usingFallback = true;
        loadCachesFromLocalStorageFallback();
      })
    : Promise.resolve().then(() => {
        usingFallback = true;
        loadCachesFromLocalStorageFallback();
      })
  );

  // ROOT-CAUSE FIX: these used to be fire-and-forget — idbPut()'s promise was
  // started but never returned, so projects.save() resolved (in the caller's
  // eyes) the instant the in-memory cache was updated, with the actual
  // IndexedDB write still pending in the background. If the admin closed the
  // modal and navigated to another page (a completely normal thing to do
  // right after saving) before that write finished, the new page loaded a
  // fresh JS context, re-read IndexedDB, and the just-created project simply
  // wasn't there yet — "created from Admin but doesn't appear," and only
  // intermittently, depending on image size / disk speed / how fast the
  // admin clicked away. Returning the promise lets every caller `await`
  // real durability before treating a save as done.
  // Defense-in-depth: track writes that are in flight so that if any code
  // path (now or in the future) forgets to await projects.save()/remove(),
  // the browser still warns before a tab close/navigation can silently drop
  // that write — rather than the project just vanishing with no trace.
  let pendingWrites = 0;
  function trackWrite(promise) {
    pendingWrites++;
    const done = () => { pendingWrites = Math.max(0, pendingWrites - 1); };
    promise.then(done, done);
    return promise;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (e) => {
      if (pendingWrites > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function persistProject(record, isDelete) {
    if (usingFallback) {
      write(KEYS.projects, projectsCache);
      return Promise.resolve();
    }
    const p = isDelete ? idbDelete(STORE_PROJECTS, record.id) : idbPut(STORE_PROJECTS, record);
    return trackWrite(p.catch(e => { notifyStorageError('projects', isDelete ? 'delete' : 'save', e); throw e; }));
  }

  function persistNews(record, isDelete) {
    if (usingFallback) {
      write(KEYS.news, newsCache);
      return Promise.resolve();
    }
    const p = isDelete ? idbDelete(STORE_NEWS, record.id) : idbPut(STORE_NEWS, record);
    return trackWrite(p.catch(e => { notifyStorageError('news', isDelete ? 'delete' : 'save', e); throw e; }));
  }

  /* ---------------------------------------------------------------------
     Image helper: resize + compress before storing, so a gallery of 15
     photos doesn't blow past storage limits the way raw camera photos
     (often 3-8MB each) would.
     --------------------------------------------------------------------- */
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function imageToDataURL(file, opts) {
    opts = opts || {};
    const maxDim = opts.maxDim || 1600;
    const quality = opts.quality != null ? opts.quality : 0.82;
    if (!file || !/^image\//.test(file.type) || file.type === 'image/svg+xml' || file.type === 'image/gif') {
      // Non-raster or animated formats: store as-is rather than risk
      // breaking transparency/animation by re-encoding.
      return fileToDataURL(file);
    }
    return fileToDataURL(file).then(dataUrl => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim) {
          resolve(dataUrl); // already small enough, skip re-encoding
          return;
        }
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          resolve(dataUrl); // canvas tainted or unsupported — fall back to original
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    }));
  }

  /* ---------------------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------------------- */
  const VELIX = {
    KEYS,
    uid,
    logActivity,
    ready,
    MAX_GALLERY_IMAGES,
    MAX_PROJECTS,

    projects: {
      all() { return clone(projectsCache); },
      get(id) { return clone(projectsCache.find(p => p.id === id)) || null; },
      getBySlug(slug) { return clone(projectsCache.find(p => p.slug === slug)) || null; },
      featured() { return clone(projectsCache.filter(p => p.featured)); },
      byCategory(cat) { return clone(cat ? projectsCache.filter(p => p.category === cat) : projectsCache); },
      categories() { return [...new Set(projectsCache.map(p => p.category).filter(Boolean))]; },
      count() { return projectsCache.length; },
      // The previous/next project relative to `project`'s position in the
      // full listing (same order as the Portfolio grid) — used by the
      // "Next Project" section at the bottom of the Project page.
      neighbors(project) {
        const idx = projectsCache.findIndex(p => p.id === project.id);
        if (idx === -1 || !projectsCache.length) return { prev: null, next: null };
        const len = projectsCache.length;
        return {
          prev: len > 1 ? clone(projectsCache[(idx - 1 + len) % len]) : null,
          next: len > 1 ? clone(projectsCache[(idx + 1) % len]) : null
        };
      },
      save(project) {
        // Gallery is a single flat array of up to MAX_GALLERY_IMAGES images.
        // (Older records may still have the legacy {desktop,tablet,mobile}
        // shape from before this fix — normalizeProject() already flattens
        // those on read, but guard here too in case save() is called with
        // a hand-built object.)
        if (!Array.isArray(project.gallery)) project.gallery = flattenGallery(project.gallery);
        if (project.gallery.length > MAX_GALLERY_IMAGES) {
          project.gallery = project.gallery.slice(0, MAX_GALLERY_IMAGES);
        }
        delete project.beforeAfter; // retired field — see architectural audit notes above
        if (!project.id) {
          // Note: MAX_PROJECTS (1000) is a documented design target for the
          // capacity this data layer is built to handle comfortably — it is
          // intentionally NOT enforced as a hard cap here. The task requires
          // no hidden limits, so saving project #1001+ is still allowed; it
          // just isn't the scale this architecture was specifically verified
          // against.
          project.id = uid('proj');
          project._seq = ++projectsSeq;
          if (!project.slug) ensureProjectSlugs(projectsCache.concat(project));
          projectsCache.unshift(project);
          logActivity(`New project added: "${project.title}"`, 'project');
        } else {
          const idx = projectsCache.findIndex(p => p.id === project.id);
          if (idx > -1) {
            project._seq = projectsCache[idx]._seq;
            if (!project.slug) project.slug = projectsCache[idx].slug; // keep existing slug stable on edit
            projectsCache[idx] = project;
          } else {
            project._seq = ++projectsSeq;
            projectsCache.unshift(project);
          }
          if (!project.slug) ensureProjectSlugs(projectsCache);
          logActivity(`Project updated: "${project.title}"`, 'project');
        }
        // The in-memory cache above is already updated synchronously (so any
        // other code on this same page sees the change immediately); this
        // promise additionally tells the caller once the write is durable in
        // IndexedDB, which callers that navigate right after saving MUST
        // await — see the root-cause note on persistProject().
        return persistProject(project, false).then(() => project);
      },
      remove(id) {
        const target = projectsCache.find(p => p.id === id);
        projectsCache = projectsCache.filter(p => p.id !== id);
        if (!target) return Promise.resolve();
        logActivity(`Project deleted: "${target.title}"`, 'project');
        return persistProject(target, true);
      },
      related(project, limit) {
        limit = limit || 3;
        return clone(projectsCache
          .filter(p => p.id !== project.id && p.category === project.category)
          .concat(projectsCache.filter(p => p.id !== project.id && p.category !== project.category))
          .slice(0, limit));
      }
    },

    news: {
      all() { return clone(newsCache).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); },
      get(id) { return clone(newsCache.find(n => n.id === id)) || null; },
      categories() { return [...new Set(newsCache.map(n => n.category).filter(Boolean))]; },
      save(article) {
        if (!article.id) {
          article.id = uid('news');
          article.createdAt = article.createdAt || new Date().toISOString();
          article._seq = ++newsSeq;
          newsCache.unshift(article);
          logActivity(`New article published: "${article.title}"`, 'news');
        } else {
          const idx = newsCache.findIndex(n => n.id === article.id);
          if (idx > -1) {
            article._seq = newsCache[idx]._seq;
            newsCache[idx] = article;
          } else {
            article._seq = ++newsSeq;
            newsCache.unshift(article);
          }
          logActivity(`Article updated: "${article.title}"`, 'news');
        }
        return persistNews(article, false).then(() => article);
      },
      remove(id) {
        const target = newsCache.find(n => n.id === id);
        newsCache = newsCache.filter(n => n.id !== id);
        if (!target) return Promise.resolve();
        logActivity(`Article deleted: "${target.title}"`, 'news');
        return persistNews(target, true);
      }
    },

    /* -----------------------------------------------------------------
       SESSION MANAGER (AI architecture v2 §6)
       Identifies *who* is talking across messages and across return
       visits, without requiring login. MVP version: a plain UUID-ish
       token in localStorage (persists across visits on the same
       browser/device) rather than a signed JWT — architecture §6's own
       MVP note says this is sufficient before there's a security reason
       to sign it. This token is the join key the AI backend (/api/chat,
       /api/leads) uses to rate-limit and to associate leads/events with
       a visitor without ever needing a login.
       ----------------------------------------------------------------- */
    session: {
      getToken() {
        let token = null;
        try { token = localStorage.getItem(KEYS.session); } catch (e) { /* ignore */ }
        if (!token) {
          token = uid('sess');
          try { localStorage.setItem(KEYS.session, token); } catch (e) { /* ignore */ }
        }
        return token;
      }
    },

    leads: {
      all() { return read(KEYS.leads, []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); },
      get(id) { return this.all().find(l => l.id === id) || null; },
      byStatus(status) { return this.all().filter(l => l.status === status); },
      create(lead) {
        const list = read(KEYS.leads, []);
        const record = Object.assign({
          id: uid('lead'),
          status: 'New',
          notes: [],
          createdAt: new Date().toISOString()
        }, lead);
        list.unshift(record);
        write(KEYS.leads, list);
        logActivity(`New lead captured: ${record.name || 'Unknown visitor'}`, 'lead');

        // CRM integration layer (§23): also push to the server-side leads
        // store (Vercel KV when configured) so the lead survives even if
        // this visitor never opens the admin dashboard on this same
        // browser. Best-effort and non-blocking — the local record above
        // is already saved and the UI already reflects success, so a
        // network hiccup here must never break the visitor-facing flow.
        try {
          fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({}, record, { sessionId: VELIX.session.getToken() }))
          }).catch(() => { /* offline or backend not deployed yet — local record still stands */ });
        } catch (e) { /* fetch unavailable — ignore */ }

        return record;
      },
      update(id, patch) {
        const list = read(KEYS.leads, []);
        const idx = list.findIndex(l => l.id === id);
        if (idx > -1) {
          list[idx] = Object.assign({}, list[idx], patch);
          write(KEYS.leads, list);
          logActivity(`Lead updated: ${list[idx].name || id}`, 'lead');
          return list[idx];
        }
        return null;
      },
      remove(id) {
        const list = read(KEYS.leads, []);
        write(KEYS.leads, list.filter(l => l.id !== id));
      },
      addNote(id, note) {
        const list = read(KEYS.leads, []);
        const idx = list.findIndex(l => l.id === id);
        if (idx > -1) {
          list[idx].notes = list[idx].notes || [];
          list[idx].notes.push({ text: note, at: new Date().toISOString() });
          write(KEYS.leads, list);
        }
      }
    },

    conversations: {
      all() { return read(KEYS.conversations, []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); },
      save(conversation) {
        const list = read(KEYS.conversations, []);
        conversation.updatedAt = new Date().toISOString();
        const idx = list.findIndex(c => c.id === conversation.id);
        if (idx > -1) list[idx] = conversation; else list.unshift(conversation);
        write(KEYS.conversations, list);
      }
    },

    activity: {
      all() { return read(KEYS.activity, []); }
    },

    settings: {
      get() { return read(KEYS.settings, SEED_SETTINGS); },
      save(patch) {
        const current = this.get();
        const updated = Object.assign({}, current, patch);
        write(KEYS.settings, updated);
        logActivity('Website settings updated', 'settings');
        return updated;
      }
    },

    auth: {
      isLoggedIn() { return sessionStorage.getItem(KEYS.auth) === 'true'; },
      login(password) {
        const ok = password === VELIX.settings.get().adminPassword;
        if (ok) sessionStorage.setItem(KEYS.auth, 'true');
        return ok;
      },
      logout() { sessionStorage.removeItem(KEYS.auth); }
    },

    /* Read an <input type=file> as a base64 data URL, unmodified. Kept for
       non-image files (e.g. hero video) and as a low-level primitive. */
    fileToDataURL,

    /* Preferred helper for photos: resizes to a sane max dimension and
       re-encodes as JPEG so galleries of many photos stay well within
       storage limits. Falls back to the untouched file for SVG/GIF. */
    imageToDataURL
  };

  global.VELIX = VELIX;
})(window);
