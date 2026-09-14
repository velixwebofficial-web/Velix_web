/* ==========================================================================
   VELIX — PROJECT GALLERY VIEWER
   Powers the large, in-page screenshot viewer at the top of project.html:
   prev/next buttons, ArrowLeft/ArrowRight keyboard navigation, left/right
   swipe on touch, an image counter, and an optional thumbnail strip.

   Navigation is spatially fixed (right = next, left = previous) regardless
   of page text direction, matching the site's existing lightbox
   (assets/js/lightbox.js) — see the comment above .pgv-nav in style.css.

   Usage:
     VELIXProjectGallery.init({ root: document.getElementById('pgv'), images: [{src, alt}, ...] })
   Returns null if there are no images to show (caller should hide the
   viewer chrome itself in that case), otherwise a small handle with
   goTo(i) and destroy().
   ========================================================================== */
(function (global) {
  function escAttr(str) {
    return (str || '').toString().replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function init(opts) {
    const root = opts && opts.root;
    const images = (opts && opts.images || []).filter(x => x && x.src);
    if (!root || !images.length) return null;

    const els = {
      cur: root.querySelector('[data-pgv="cur"]'),
      total: root.querySelector('[data-pgv="total"]'),
      stage: root.querySelector('[data-pgv="stage"]'),
      frame: root.querySelector('[data-pgv="frame"]'),
      img: root.querySelector('[data-pgv="img"]'),
      prev: root.querySelector('[data-pgv="prev"]'),
      next: root.querySelector('[data-pgv="next"]'),
      thumbs: root.querySelector('[data-pgv="thumbs"]'),
    };

    let index = 0;

    function preload(i) {
      i = ((i % images.length) + images.length) % images.length;
      const im = new Image();
      im.src = images[i].src;
    }

    function render() {
      const item = images[index];
      if (els.img) {
        // Let image-loader.js re-wire this reused <img> from scratch so the
        // shimmer/fallback states reset correctly on every image change —
        // same pattern the existing lightbox uses for the same reason.
        delete els.img.dataset.velixImgWired;
        const wrap = els.img.closest('.velix-img');
        if (wrap) { wrap.classList.remove('is-error'); wrap.classList.add('is-loading'); }
        els.img.src = item.src;
        els.img.alt = item.alt || '';
        if (global.VELIX_IMG) global.VELIX_IMG.wireImage(els.img);
      }
      if (els.cur) els.cur.textContent = pad(index + 1);
      if (els.thumbs) {
        els.thumbs.querySelectorAll('.pgv-thumb').forEach((t, i) => t.classList.toggle('is-active', i === index));
      }
      preload(index + 1);
      preload(index - 1);
    }

    function go(delta) {
      if (images.length < 2) return;
      index = (index + delta + images.length) % images.length;
      render();
    }

    const hasMulti = images.length > 1;
    if (els.prev) { els.prev.addEventListener('click', () => go(-1)); els.prev.style.display = hasMulti ? '' : 'none'; }
    if (els.next) { els.next.addEventListener('click', () => go(1)); els.next.style.display = hasMulti ? '' : 'none'; }

    if (els.thumbs) {
      if (hasMulti) {
        els.thumbs.innerHTML = images.map((im, i) => `
          <button type="button" class="pgv-thumb${i === 0 ? ' is-active' : ''}" data-i="${i}" aria-label="Go to screenshot ${i + 1}">
            <img src="${escAttr(im.src)}" alt="" loading="lazy" decoding="async">
          </button>`).join('');
        els.thumbs.addEventListener('click', (e) => {
          const btn = e.target.closest('.pgv-thumb');
          if (!btn) return;
          index = Number(btn.dataset.i);
          render();
        });
      } else {
        els.thumbs.style.display = 'none';
      }
    }

    // Keyboard — ignored while the visitor is typing anywhere on the page.
    function onKey(e) {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    document.addEventListener('keydown', onKey);

    // Swipe — horizontal drag only; a mostly-vertical gesture is left alone
    // so the page can still scroll normally.
    let touchX = null, touchY = null;
    function onTouchStart(e) {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }
    function onTouchEnd(e) {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }
    if (els.stage) {
      els.stage.addEventListener('touchstart', onTouchStart, { passive: true });
      els.stage.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    // Clicking the main screenshot opens the site's existing lightbox for a
    // closer, fullscreen zoomed look — reuses tested code instead of
    // building a second image viewer.
    function onFrameClick() {
      if (global.VELIXLightbox) global.VELIXLightbox.open(images, index);
    }
    if (els.frame) els.frame.addEventListener('click', onFrameClick);

    if (els.total) els.total.textContent = pad(images.length);
    render();

    return {
      goTo(i) {
        if (!images.length) return;
        index = ((i % images.length) + images.length) % images.length;
        render();
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
        if (els.stage) {
          els.stage.removeEventListener('touchstart', onTouchStart);
          els.stage.removeEventListener('touchend', onTouchEnd);
        }
        if (els.frame) els.frame.removeEventListener('click', onFrameClick);
      },
    };
  }

  global.VELIXProjectGallery = { init };
})(window);
