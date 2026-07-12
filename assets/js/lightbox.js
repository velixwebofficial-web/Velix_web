/* ==========================================================================
   VELIX — LIGHTBOX
   Modern, minimal image viewer used by the Project page's vertical gallery.
   White background + backdrop blur (not the old dark fullscreen modal),
   previous/next controls, keyboard arrows, swipe on touch, Esc to close,
   an image counter, and smooth fade/scale transitions.

   Usage:
     VELIXLightbox.open([{src, alt}, ...], startIndex)
     VELIXLightbox.close()
   ========================================================================== */
(function (global) {
  let el = null;
  let images = [];
  let index = 0;
  let touchStartX = null, touchStartY = null;
  let lastFocused = null;

  function esc(str) {
    return (str || '').toString().replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }

  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'velix-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="velix-lightbox-backdrop"></div>
      <div class="velix-lightbox-shell">
        <div class="velix-lightbox-stage">
          <button type="button" class="velix-lightbox-nav prev" aria-label="Previous image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div class="velix-lightbox-media">
            <span class="velix-img"><img alt=""><span class="velix-img-fallback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>Image unavailable</span></span></span>
            <button type="button" class="velix-lightbox-close" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <button type="button" class="velix-lightbox-nav next" aria-label="Next image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
        <div class="velix-lightbox-footer">
          <span class="velix-lightbox-counter"></span>
          <span class="velix-lightbox-caption"></span>
        </div>
      </div>`;
    document.body.appendChild(el);

    el.querySelector('.velix-lightbox-backdrop').addEventListener('click', close);
    el.querySelector('.velix-lightbox-close').addEventListener('click', close);
    el.querySelector('.velix-lightbox-nav.prev').addEventListener('click', () => go(-1));
    el.querySelector('.velix-lightbox-nav.next').addEventListener('click', () => go(1));

    const media = el.querySelector('.velix-lightbox-media');
    media.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    media.addEventListener('touchend', (e) => {
      if (touchStartX == null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      touchStartX = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (!el.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });

    return el;
  }

  function preload(i) {
    if (i < 0 || i >= images.length) return;
    const img = new Image();
    img.src = images[i].src;
  }

  function render() {
    const imgEl = el.querySelector('.velix-lightbox-media img');
    const wrap = imgEl.closest('.velix-img');
    wrap.classList.remove('is-error');
    wrap.classList.add('is-loading');
    delete imgEl.dataset.velixImgWired; // let image-loader.js re-wire this reused <img>
    imgEl.src = images[index].src;
    imgEl.alt = images[index].alt || '';
    if (global.VELIX_IMG) global.VELIX_IMG.wireImage(imgEl);

    const hasMulti = images.length > 1;
    el.querySelector('.velix-lightbox-nav.prev').style.display = hasMulti ? '' : 'none';
    el.querySelector('.velix-lightbox-nav.next').style.display = hasMulti ? '' : 'none';
    el.querySelector('.velix-lightbox-counter').textContent = hasMulti ? `${index + 1} / ${images.length}` : '';
    el.querySelector('.velix-lightbox-caption').textContent = images[index].caption || '';

    // Preload neighbours so Next/Prev feels instant instead of re-fetching.
    preload(index + 1);
    preload(index - 1);
  }

  function go(delta) {
    if (!images.length) return;
    index = (index + delta + images.length) % images.length;
    render();
  }

  function open(list, startIndex) {
    images = (list || []).filter(x => x && x.src);
    if (!images.length) return;
    index = Math.min(Math.max(startIndex || 0, 0), images.length - 1);
    build();
    render();
    lastFocused = document.activeElement;
    el.classList.add('is-open');
    document.body.classList.add('velix-lightbox-lock');
    el.querySelector('.velix-lightbox-close').focus();
  }

  function close() {
    if (!el) return;
    el.classList.remove('is-open');
    document.body.classList.remove('velix-lightbox-lock');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  global.VELIXLightbox = { open, close };
})(window);
