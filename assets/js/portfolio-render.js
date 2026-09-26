/* ==========================================================================
   VELIX — PORTFOLIO RENDERING
   Equal 3-up showcase grid for the Homepage "Featured" preview and the full
   Portfolio grid. Both read straight from VELIX.projects (local API-backed
   single source of truth in store.js) — nothing here is hardcoded, and
   nothing is capped: renderFullPortfolio() renders every project
   VELIX.projects.all() returns, whether that's 4, 20, 100 or 1000, wrapping
   into further rows of the same equal cards (never an asymmetric layout,
   never a vertical carousel).

   Every card is identical in structure and importance: a real screenshot
   at its own natural aspect ratio (no forced box, no cropping) on top, and
   a slim dark information footer underneath. Clicking a project is a
   normal link to its own page — no modal, no popup viewer. See
   projectHref() for how that URL is built.
   ========================================================================== */
(function () {
  function escapeAttr(str) {
    return (str || '').toString().replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  function t(key, fallback) {
    if (window.VELIX_I18N) {
      const v = window.VELIX_I18N.t(key);
      if (v !== null && v !== undefined) return v;
    }
    return fallback;
  }

  // Prefer the clean /projects/slug-name URL (works once a rewrite rule is
  // in place — see redirects/_redirects, redirects/vercel.json and
  // redirects/.htaccess shipped alongside this build). Falls back to the
  // always-working project.html?slug=... form when no slug exists yet.
  function projectHref(p) {
    return p.slug ? `project.html?slug=${encodeURIComponent(p.slug)}` : `project.html?id=${encodeURIComponent(p.id)}`;
  }

  const ARROW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';

  // Real screenshot when there is one — displayed at ITS OWN natural
  // aspect ratio (width:100%, height:auto, no object-fit) so nothing is
  // ever cropped, stretched or letterboxed. Falls back to the same
  // on-brand gradient "scene" used elsewhere on the site when a project
  // has no cover yet — never a generic placeholder.
  function mediaHTML(p) {
    if (p.cover) {
      return window.VELIX_IMG.wrapImgHTML(`<img src="${escapeAttr(p.cover)}" alt="${escapeAttr(p.title)}" loading="lazy">`);
    }
    const catClass = escapeAttr(p.category || '').toLowerCase().replace(/[^a-z]/g, '');
    return `<div class="project-scene ${catClass}"><div class="project-scene-text"><span class="tag">${escapeAttr(p.category || t('t_pf_project', 'Project'))}</span><h4>${escapeAttr(p.title)}</h4></div></div>`;
  }

  // 01, 02, 03 … always at least two digits, however many projects exist.
  function numberLabel(i) {
    return String(i + 1).padStart(2, '0');
  }

  // One equal card: screenshot on top, slim dark footer (category + number,
  // title + arrow) underneath. Every project in every list gets exactly
  // this treatment — no hero, no wide/narrow variants.
  function projectCard(p, i) {
    return `
      <a href="${projectHref(p)}" class="portfolio-card" data-reveal="" data-reveal-delay="${(i % 3) + 1}">
        <div class="portfolio-card-media">${mediaHTML(p)}</div>
        <div class="portfolio-card-footer">
          <div class="pcf-top">
            <span class="pcf-cat">${escapeAttr(p.category || t('t_pf_project', 'Project'))}</span>
            <span class="pcf-num">${numberLabel(i)}</span>
          </div>
          <div class="pcf-bottom">
            <span class="pcf-title">${escapeAttr(p.title)}</span>
            <span class="pcf-arrow">${ARROW_ICON}</span>
          </div>
        </div>
      </a>`;
  }

  function renderGrid(mount, list, emptyMessage) {
    if (!list.length) {
      mount.innerHTML = `<p class="portfolio-empty">${escapeAttr(emptyMessage)}</p>`;
      return;
    }
    mount.innerHTML = list.map(projectCard).join('');
    if (window.VELIX_IMG) window.VELIX_IMG.wireAll(mount);
    if (window.VELIX_UI) window.VELIX_UI.observeReveal(mount);
  }

  function renderFeaturedPreview() {
    const mount = document.querySelector('#portfolio .portfolio-grid');
    if (!mount || !window.VELIX) return;
    const projects = VELIX.projects.featured().length ? VELIX.projects.featured() : VELIX.projects.all();
    renderGrid(mount, projects.slice(0, 3), t('t_pf_empty_all', 'No projects yet — add your first one in the Admin Dashboard.'));
  }

  function renderFullPortfolio() {
    const grid = document.getElementById('portfolioGrid');
    const filtersMount = document.getElementById('portfolioFilters');
    if (!grid || !window.VELIX) return;

    // No limit, no slice, no pagination: every project the store has is
    // rendered, regardless of whether that's 4 or 1000 — they simply wrap
    // into further rows of the same equal-size cards.
    const all = VELIX.projects.all();
    const categories = VELIX.projects.categories();

    filtersMount.innerHTML = ['All'].concat(categories).map((c, i) =>
      `<button data-cat="${c === 'All' ? '' : escapeAttr(c)}" class="${i === 0 ? 'active' : ''}">${c}</button>`
    ).join('');

    function paint(list) {
      renderGrid(grid, list, t('t_pf_empty_cat', 'No projects in this category yet.'));
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

  function renderAll() {
    renderFeaturedPreview();
    renderFullPortfolio();
  }

  function init() {
    if (!window.VELIX) return;
    // Wait for the store's initial fetch to finish before the first paint,
    // otherwise we'd render against an empty cache.
    window.VELIX.ready.then(renderAll);
    // store.js polls the local API periodically and fires this event when
    // anything actually changed — repaint so this stays a live page rather
    // than only being correct on first load.
    window.addEventListener('velix:updated', (e) => {
      if (e.detail && e.detail.table !== 'projects') return;
      renderAll();
    });
    // Card copy ("Project" fallback, empty states) is language-dependent —
    // repaint on language switch so it never shows stale English inside an
    // Arabic page or vice-versa.
    document.addEventListener('velix:langchange', renderAll);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
