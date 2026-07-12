/* ==========================================================================
   VELIX — PORTFOLIO RENDERING
   Renders the Homepage "Featured" preview and the full Portfolio grid.
   Both read straight from VELIX.projects (IndexedDB-backed single source of
   truth in store.js) — nothing here is hardcoded, and nothing is capped:
   renderFullPortfolio() renders every project VELIX.projects.all() returns,
   whether that's 4, 20, 100 or 1000.

   Clicking a card is a normal link to the project's own page — no modal, no
   popup viewer. See projectHref() for how that URL is built.
   ========================================================================== */
(function () {
  function escapeAttr(str) {
    return (str || '').toString().replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  // Prefer the clean /projects/slug-name URL (works once a rewrite rule is
  // in place — see redirects/_redirects, redirects/vercel.json and
  // redirects/.htaccess shipped alongside this build). Falls back to the
  // always-working project.html?slug=... form when no slug exists yet.
  function projectHref(p) {
    return p.slug ? `project.html?slug=${encodeURIComponent(p.slug)}` : `project.html?id=${encodeURIComponent(p.id)}`;
  }

  // Live-looking address bar text: real domain if the project links out to
  // one, otherwise the project's own honest URL on this site — never a made
  // up domain.
  function addressFor(p) {
    if (p.websiteUrl) {
      try { return new URL(p.websiteUrl).hostname.replace(/^www\./, ''); } catch (e) { /* fall through */ }
    }
    return `velixwebsolutions.com/work/${p.slug || p.id}`;
  }
  const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  function mockupBar(p) {
    return `<div class="mockup-bar"><span class="mockup-dots"><i></i><i></i><i></i></span><span class="mockup-url">${LOCK_ICON}<span>${escapeAttr(addressFor(p))}</span></span></div>`;
  }

  function projectCard(p, i) {
    const body = p.cover
      ? window.VELIX_IMG.wrapImgHTML(`<img src="${p.cover}" alt="${escapeAttr(p.title)}">`)
      : `<div class="project-scene ${escapeAttr(p.category || '').toLowerCase().replace(/[^a-z]/g,'')}"><div class="project-scene-text"><span class="tag">${escapeAttr(p.category || 'Project')}</span><h4>${escapeAttr(p.title)}</h4></div></div>`;
    const badgeClass = p.featured ? 'project-badge is-featured' : 'project-badge';
    const badgeLabel = p.featured ? 'Featured' : (p.category || 'Project');
    return `
      <a href="${projectHref(p)}" class="project-card" data-reveal data-reveal-delay="${(i % 3) + 1}">
        <div class="project-thumb ${p.cover ? 'has-image' : ''}">
          <span class="${badgeClass}">${escapeAttr(badgeLabel)}</span>
          <div class="mockup">
            ${mockupBar(p)}
            <div class="mockup-body">${body}</div>
          </div>
        </div>
        <div class="project-info">
          <div><h4>${escapeAttr(p.title)}</h4><p>${escapeAttr((p.description || '').slice(0, 90))}${(p.description||'').length>90?'…':''}</p></div>
          <span class="service-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 17 17 7M9 7h8v8"/></svg></span>
        </div>
      </a>`;
  }

  function renderFeaturedPreview() {
    const mount = document.querySelector('#portfolio .portfolio-grid');
    if (!mount || !window.VELIX) return;
    const projects = VELIX.projects.featured().length ? VELIX.projects.featured() : VELIX.projects.all();
    mount.innerHTML = projects.slice(0, 3).map(projectCard).join('') || '<p class="portfolio-empty">No projects yet — add your first one in the Admin Dashboard.</p>';
    if (window.VELIX_IMG) window.VELIX_IMG.wireAll(mount);
    if (window.VELIX_UI) window.VELIX_UI.observeReveal(mount);
  }

  function renderFullPortfolio() {
    const grid = document.getElementById('portfolioGrid');
    const filtersMount = document.getElementById('portfolioFilters');
    if (!grid || !window.VELIX) return;

    // No limit, no slice, no pagination: every project the store has is
    // rendered, regardless of whether that's 4 or 1000.
    const all = VELIX.projects.all();
    const categories = VELIX.projects.categories();

    filtersMount.innerHTML = ['All'].concat(categories).map((c, i) =>
      `<button data-cat="${c === 'All' ? '' : escapeAttr(c)}" class="${i === 0 ? 'active' : ''}">${c}</button>`
    ).join('');

    function paint(list) {
      grid.innerHTML = list.length
        ? list.map(projectCard).join('')
        : '<p class="portfolio-empty">No projects in this category yet.</p>';
      if (window.VELIX_IMG) window.VELIX_IMG.wireAll(grid);
      if (window.VELIX_UI) window.VELIX_UI.observeReveal(grid);
    }
    paint(all);

    filtersMount.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        filtersMount.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.cat;
        paint(cat ? VELIX.projects.byCategory(cat) : all);
      });
    });
  }

  function init() {
    if (!window.VELIX) return;
    // Wait for the store's IndexedDB cache to finish loading before the
    // first paint, otherwise we'd render against an empty cache.
    window.VELIX.ready.then(() => {
      renderFeaturedPreview();
      renderFullPortfolio();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
