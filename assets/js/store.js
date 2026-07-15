/* ==========================================================================
   VELIX WEB SOLUTIONS — DATA STORE (Supabase-backed)

   This is a full replacement of the old client-side data layer. There is
   no IndexedDB, no localStorage/sessionStorage for content, no seed data,
   no mock data. Every read and write goes to Supabase (Postgres + Auth +
   Storage), and every table is protected by Row Level Security — see
   supabase/schema.sql.

   The public API (VELIX.projects.*, VELIX.news.*, VELIX.auth.*, etc.) is
   kept the same shape the rest of the site already calls, so no other page
   needed to change. The one difference: every call is now backed by a
   live cache that is populated from Supabase and kept in sync in real
   time via Postgres Changes, instead of a browser-local database.
   ========================================================================== */

(function (global) {
  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    console.error('VELIX: Supabase client library did not load. Check the <script> tag order in this page.');
  }
  if (!global.VELIX_SUPABASE_URL || global.VELIX_SUPABASE_URL.indexOf('YOUR-PROJECT-REF') > -1) {
    console.warn('VELIX: supabase-config.js still has placeholder credentials. Fill in your project URL + anon key.');
  }

  const sb = global.supabase.createClient(global.VELIX_SUPABASE_URL, global.VELIX_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

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

  function slugify(str) {
    return (str || '').toString().toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project';
  }

  async function uniqueSlug(table, base, excludeId) {
    let slug = base, n = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = sb.from(table).select('id').eq('slug', slug).limit(1);
      const { data, error } = await q;
      if (error) throw error;
      const hit = data && data[0];
      if (!hit || hit.id === excludeId) return slug;
      slug = base + '-' + (n++);
    }
  }

  async function logActivity(text, icon) {
    try {
      await sb.from('activity_log').insert({ text, icon: icon || 'dot' });
    } catch (e) { /* non-fatal — the dashboard feed simply won't show this entry */ }
  }

  /* -------------------------------------------------------------------
     Row <-> app-shape mapping. DB columns are snake_case; the rest of
     the site (admin.html, project.html, etc.) expects the camelCase /
     legacy field names the old localStorage version used.
     ------------------------------------------------------------------- */
  function projectFromRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      subtitle: r.subtitle || '',
      client: r.client || '',
      category: r.category || '',
      location: r.location || '',
      completionDate: r.completion_date || '',
      featured: !!r.featured,
      published: !!r.published,
      websiteUrl: r.website_url || '',
      description: r.short_description || '',
      overview: r.overview || '',
      challenge: r.challenge || '',
      solution: r.solution || '',
      results: Array.isArray(r.results) ? r.results : [],
      services: Array.isArray(r.services) ? r.services : [],
      technologies: Array.isArray(r.technologies) ? r.technologies : [],
      cover: r.cover_image || '',
      gallery: Array.isArray(r.gallery) ? r.gallery : [],
      seoTitle: r.seo_title || '',
      seoDescription: r.seo_description || '',
      sortOrder: r.sort_order || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at || null
    };
  }

  function projectToRow(p) {
    return {
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle || '',
      client: p.client || '',
      category: p.category || '',
      location: p.location || '',
      completion_date: p.completionDate || null,
      featured: !!p.featured,
      published: p.published !== false,
      website_url: p.websiteUrl || '',
      short_description: p.description || '',
      full_description: p.fullDescription || p.description || '',
      overview: p.overview || '',
      challenge: p.challenge || '',
      solution: p.solution || '',
      results: Array.isArray(p.results) ? p.results : [],
      services: Array.isArray(p.services) ? p.services : [],
      technologies: Array.isArray(p.technologies) ? p.technologies : [],
      cover_image: p.cover || '',
      gallery: Array.isArray(p.gallery) ? p.gallery : [],
      seo_title: p.seoTitle || p.title || '',
      seo_description: p.seoDescription || p.description || ''
    };
  }

  function newsFromRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category || '',
      cover: r.cover_image || '',
      video: r.video_url || '',
      excerpt: r.excerpt || '',
      body: r.content || '',
      author: r.author || '',
      published: !!r.published,
      seoTitle: r.seo_title || '',
      seoDescription: r.seo_description || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at || null
    };
  }

  function newsToRow(n) {
    return {
      slug: n.slug,
      title: n.title,
      category: n.category || '',
      cover_image: n.cover || '',
      video_url: n.video || '',
      excerpt: n.excerpt || '',
      content: n.body || '',
      author: n.author || '',
      published: n.published !== false,
      seo_title: n.seoTitle || n.title || '',
      seo_description: n.seoDescription || n.excerpt || ''
    };
  }

  /* -------------------------------------------------------------------
     In-memory caches. Populated from Supabase, kept fresh with Realtime.
     Every VELIX.projects and VELIX.news read stays synchronous, same as
     before, by reading off these caches — but the data underneath is now
     shared across every browser/device instead of living in one visitor's
     IndexedDB.
     ------------------------------------------------------------------- */
  let projectsCache = [];
  let newsCache = [];
  let currentProfile = null; // { id, email, role } once a staff member is signed in

  function isStaff() {
    return !!(currentProfile && (currentProfile.role === 'admin' || currentProfile.role === 'editor'));
  }

  async function fetchProjects() {
    let q = sb.from('projects').select('*').is('deleted_at', null).order('sort_order', { ascending: false });
    if (!isStaff()) q = q.eq('published', true);
    const { data, error } = await q;
    if (error) { notifyStorageError('projects', 'fetch', error); return; }
    projectsCache = (data || []).map(projectFromRow);
  }

  async function fetchNews() {
    let q = sb.from('news').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    if (!isStaff()) q = q.eq('published', true);
    const { data, error } = await q;
    if (error) { notifyStorageError('news', 'fetch', error); return; }
    newsCache = (data || []).map(newsFromRow);
  }

  async function refreshProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { currentProfile = null; return; }
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) { currentProfile = null; return; }
    currentProfile = data ? { id: data.id, email: data.email, role: data.role } : null;
  }

  async function initialLoad() {
    await refreshProfile();
    await Promise.all([fetchProjects(), fetchNews()]);
  }

  /* Realtime: any change anywhere (this tab, another admin, another
     visitor) re-syncs the cache and tells the current page to re-render. */
  sb.channel('public:projects')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, async () => {
      await fetchProjects();
      notifyUpdated('projects');
    })
    .subscribe();

  sb.channel('public:news')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, async () => {
      await fetchNews();
      notifyUpdated('news');
    })
    .subscribe();

  sb.auth.onAuthStateChange(async () => {
    await refreshProfile();
    await Promise.all([fetchProjects(), fetchNews()]);
    notifyUpdated('auth');
  });

  const ready = initialLoad().catch(e => notifyStorageError('init', 'load', e));

  /* ---------------------------------------------------------------------
     Storage: image uploads go straight to the Supabase "media" bucket and
     come back as public URLs. Nothing is ever embedded as base64.
     --------------------------------------------------------------------- */
  async function uploadFile(file, folder) {
    if (!file) return '';
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${folder || 'uploads'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${cleanName}`;
    const { error } = await sb.storage.from('media').upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (error) { notifyStorageError('media', 'upload', error); throw error; }
    const { data: pub } = sb.storage.from('media').getPublicUrl(path);
    const url = pub.publicUrl;

    let width = null, height = null;
    if (/^image\//.test(file.type) && file.type !== 'image/svg+xml') {
      try {
        const dims = await new Promise((resolve) => {
          const img = new Image();
          const objUrl = URL.createObjectURL(file);
          img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(objUrl); };
          img.onerror = () => { resolve({ w: null, h: null }); URL.revokeObjectURL(objUrl); };
          img.src = objUrl;
        });
        width = dims.w; height = dims.h;
      } catch (e) { /* dimension probing is best-effort only */ }
    }

    await sb.from('media').insert({
      file_name: file.name,
      file_url: url,
      storage_path: path,
      mime_type: file.type || '',
      size: file.size || 0,
      width, height,
      folder: folder || 'uploads'
    });

    return url;
  }

  async function deleteFileByUrl(url) {
    if (!url) return;
    try {
      const { data } = await sb.from('media').select('id, storage_path').eq('file_url', url).maybeSingle();
      if (data) {
        await sb.storage.from('media').remove([data.storage_path]);
        await sb.from('media').delete().eq('id', data.id);
      }
    } catch (e) { /* best-effort cleanup — a stray Storage object is not fatal */ }
  }

  /* ---------------------------------------------------------------------
     PUBLIC API — same shape as the old store, new engine underneath.
     --------------------------------------------------------------------- */
  const VELIX = {
    uid,
    logActivity,
    ready,
    MAX_GALLERY_IMAGES: 15,
    supabase: sb,
    uploadFile,
    deleteFileByUrl,

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
      async search(term) {
        const t = (term || '').toLowerCase();
        const { data, error } = await sb.from('projects').select('*').is('deleted_at', null)
          .or(`title.ilike.%${t}%,client.ilike.%${t}%,category.ilike.%${t}%`);
        if (error) { notifyStorageError('projects', 'search', error); return []; }
        return (data || []).map(projectFromRow);
      },
      async save(project) {
        if (!isStaff()) throw new Error('Sign in required to save a project.');
        if (Array.isArray(project.gallery) && project.gallery.length > VELIX.MAX_GALLERY_IMAGES) {
          project.gallery = project.gallery.slice(0, VELIX.MAX_GALLERY_IMAGES);
        }
        const row = projectToRow(project);
        if (!project.id) {
          row.slug = await uniqueSlug('projects', project.slug ? slugify(project.slug) : slugify(project.title), null);
          const { data, error } = await sb.from('projects').insert(row).select().single();
          if (error) throw error;
          projectsCache.unshift(projectFromRow(data));
          await logActivity(`New project added: "${project.title}"`, 'project');
          return projectFromRow(data);
        }
        const existing = projectsCache.find(p => p.id === project.id);
        row.slug = existing && existing.slug === project.slug
          ? project.slug
          : await uniqueSlug('projects', slugify(project.slug || project.title), project.id);
        const { data, error } = await sb.from('projects').update(row).eq('id', project.id).select().single();
        if (error) throw error;
        const idx = projectsCache.findIndex(p => p.id === project.id);
        if (idx > -1) projectsCache[idx] = projectFromRow(data); else projectsCache.unshift(projectFromRow(data));
        await logActivity(`Project updated: "${project.title}"`, 'project');
        return projectFromRow(data);
      },
      async remove(id) {
        if (!isStaff()) throw new Error('Sign in required to delete a project.');
        const target = projectsCache.find(p => p.id === id);
        const { error } = await sb.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        if (error) { notifyStorageError('projects', 'delete', error); throw error; }
        projectsCache = projectsCache.filter(p => p.id !== id);
        if (target) await logActivity(`Project deleted: "${target.title}"`, 'project');
      },
      async restore(id) {
        if (!isStaff()) throw new Error('Sign in required to restore a project.');
        const { error } = await sb.from('projects').update({ deleted_at: null }).eq('id', id);
        if (error) throw error;
        await fetchProjects();
        await logActivity('Project restored', 'project');
      },
      async permanentlyDelete(id) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { error } = await sb.from('projects').delete().eq('id', id);
        if (error) throw error;
        projectsCache = projectsCache.filter(p => p.id !== id);
      },
      async setPublished(id, published) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { error } = await sb.from('projects').update({ published }).eq('id', id);
        if (error) throw error;
        await fetchProjects();
        await logActivity(published ? 'Project published' : 'Project unpublished', 'project');
      },
      async setFeatured(id, featured) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { error } = await sb.from('projects').update({ featured }).eq('id', id);
        if (error) throw error;
        await fetchProjects();
      },
      async duplicate(id) {
        if (!isStaff()) throw new Error('Sign in required.');
        const original = projectsCache.find(p => p.id === id);
        if (!original) throw new Error('Project not found.');
        const copy = Object.assign({}, original, { id: null, title: original.title + ' (Copy)', slug: '', published: false });
        return VELIX.projects.save(copy);
      },
      async bulk(ids, action) {
        if (!isStaff()) throw new Error('Sign in required.');
        if (action === 'publish') await sb.from('projects').update({ published: true }).in('id', ids);
        else if (action === 'unpublish') await sb.from('projects').update({ published: false }).in('id', ids);
        else if (action === 'delete') await sb.from('projects').update({ deleted_at: new Date().toISOString() }).in('id', ids);
        else if (action === 'restore') await sb.from('projects').update({ deleted_at: null }).in('id', ids);
        await fetchProjects();
      }
    },

    news: {
      all() { return clone(newsCache).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); },
      get(id) { return clone(newsCache.find(n => n.id === id)) || null; },
      getBySlug(slug) { return clone(newsCache.find(n => n.slug === slug)) || null; },
      categories() { return [...new Set(newsCache.map(n => n.category).filter(Boolean))]; },
      async search(term) {
        const t = (term || '').toLowerCase();
        const { data, error } = await sb.from('news').select('*').is('deleted_at', null)
          .or(`title.ilike.%${t}%,excerpt.ilike.%${t}%,category.ilike.%${t}%`);
        if (error) { notifyStorageError('news', 'search', error); return []; }
        return (data || []).map(newsFromRow);
      },
      async save(article) {
        if (!isStaff()) throw new Error('Sign in required to save an article.');
        const row = newsToRow(article);
        if (!article.id) {
          row.slug = await uniqueSlug('news', article.slug ? slugify(article.slug) : slugify(article.title), null);
          const { data, error } = await sb.from('news').insert(row).select().single();
          if (error) throw error;
          newsCache.unshift(newsFromRow(data));
          await logActivity(`New article published: "${article.title}"`, 'news');
          return newsFromRow(data);
        }
        const existing = newsCache.find(n => n.id === article.id);
        row.slug = existing && existing.slug === article.slug
          ? article.slug
          : await uniqueSlug('news', slugify(article.slug || article.title), article.id);
        const { data, error } = await sb.from('news').update(row).eq('id', article.id).select().single();
        if (error) throw error;
        const idx = newsCache.findIndex(n => n.id === article.id);
        if (idx > -1) newsCache[idx] = newsFromRow(data); else newsCache.unshift(newsFromRow(data));
        await logActivity(`Article updated: "${article.title}"`, 'news');
        return newsFromRow(data);
      },
      async remove(id) {
        if (!isStaff()) throw new Error('Sign in required to delete an article.');
        const target = newsCache.find(n => n.id === id);
        const { error } = await sb.from('news').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        if (error) throw error;
        newsCache = newsCache.filter(n => n.id !== id);
        if (target) await logActivity(`Article deleted: "${target.title}"`, 'news');
      },
      async restore(id) {
        if (!isStaff()) throw new Error('Sign in required.');
        await sb.from('news').update({ deleted_at: null }).eq('id', id);
        await fetchNews();
      },
      async setPublished(id, published) {
        if (!isStaff()) throw new Error('Sign in required.');
        await sb.from('news').update({ published }).eq('id', id);
        await fetchNews();
      },
      async bulk(ids, action) {
        if (!isStaff()) throw new Error('Sign in required.');
        if (action === 'publish') await sb.from('news').update({ published: true }).in('id', ids);
        else if (action === 'unpublish') await sb.from('news').update({ published: false }).in('id', ids);
        else if (action === 'delete') await sb.from('news').update({ deleted_at: new Date().toISOString() }).in('id', ids);
        else if (action === 'restore') await sb.from('news').update({ deleted_at: null }).in('id', ids);
        await fetchNews();
      }
    },

    media: {
      async list(folder, limit) {
        let q = sb.from('media').select('*').order('uploaded_at', { ascending: false }).limit(limit || 100);
        if (folder) q = q.eq('folder', folder);
        const { data, error } = await q;
        if (error) { notifyStorageError('media', 'list', error); return []; }
        return data || [];
      },
      upload: uploadFile,
      async remove(id) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { data } = await sb.from('media').select('storage_path').eq('id', id).maybeSingle();
        if (data) await sb.storage.from('media').remove([data.storage_path]);
        await sb.from('media').delete().eq('id', id);
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
      _cache: [],
      async all() {
        const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false });
        if (error) { notifyStorageError('leads', 'fetch', error); return []; }
        VELIX.leads._cache = data || [];
        return data || [];
      },
      get(id) { return VELIX.leads._cache.find(l => l.id === id) || null; },
      async create(lead) {
        const record = Object.assign({
          name: lead.name || 'Unknown visitor',
          phone: lead.phone || '',
          email: lead.email || '',
          company: lead.company || '',
          project_details: lead.projectDetails || '',
          budget: lead.budget || '',
          timeline: lead.timeline || '',
          source: lead.source || 'Website Form',
          session_id: lead.sessionId || null,
          conversation_id: lead.conversationId || null
        });
        const { data, error } = await sb.from('leads').insert(record).select().single();
        if (error) { notifyStorageError('leads', 'create', error); throw error; }
        return data;
      },
      async update(id, patch) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { data, error } = await sb.from('leads').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      async remove(id) {
        if (!isStaff()) throw new Error('Sign in required.');
        await sb.from('leads').delete().eq('id', id);
      },
      async addNote(id, note) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { data } = await sb.from('leads').select('notes').eq('id', id).maybeSingle();
        const notes = (data && data.notes) || [];
        notes.push({ text: note, at: new Date().toISOString() });
        await sb.from('leads').update({ notes }).eq('id', id);
      }
    },

    conversations: {
      async all() {
        if (!isStaff()) return [];
        const { data, error } = await sb.from('conversations').select('*').order('updated_at', { ascending: false });
        if (error) { notifyStorageError('conversations', 'fetch', error); return []; }
        return data || [];
      },
      async save(conversation) {
        await sb.from('conversations').upsert({
          id: conversation.id,
          messages: conversation.messages || [],
          session_id: VELIX.session.getToken(),
          updated_at: new Date().toISOString()
        });
      }
    },

    activity: {
      async all() {
        if (!isStaff()) return [];
        const { data, error } = await sb.from('activity_log').select('*').order('at', { ascending: false }).limit(40);
        if (error) { notifyStorageError('activity', 'fetch', error); return []; }
        return data || [];
      }
    },

    settings: {
      _cache: null,
      async get() {
        const { data, error } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
        if (error) { notifyStorageError('settings', 'fetch', error); return VELIX.settings._cache || {}; }
        VELIX.settings._cache = data;
        return data;
      },
      async save(patch) {
        if (!isStaff()) throw new Error('Sign in required.');
        const { data, error } = await sb.from('settings').update(patch).eq('id', 1).select().single();
        if (error) throw error;
        VELIX.settings._cache = data;
        await logActivity('Website settings updated', 'settings');
        return data;
      }
    },

    auth: {
      isLoggedIn() { return isStaff(); },
      currentUser() { return currentProfile ? clone(currentProfile) : null; },
      async login(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, error: error.message };
        await refreshProfile();
        if (!isStaff()) { await sb.auth.signOut(); return { ok: false, error: 'This account does not have admin access.' }; }
        await Promise.all([fetchProjects(), fetchNews()]);
        return { ok: true };
      },
      async logout() {
        await sb.auth.signOut();
        currentProfile = null;
        await Promise.all([fetchProjects(), fetchNews()]);
      }
    }
  };

  global.VELIX = VELIX;
})(window);
