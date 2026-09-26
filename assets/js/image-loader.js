/* ==========================================================================
   VELIX — IMAGE LOADING HELPER
   Fixes the "gallery images sometimes go black / fail to load" class of
   bugs by giving every dynamically-inserted <img> the same three things:
     1. A light shimmer placeholder while it loads (no layout shift, no
        empty black rectangle in the meantime).
     2. A graceful, on-brand fallback (icon + label, light gray — never a
        black box) if the image 404s or a data-URL is corrupt.
     3. Lazy loading + async decode by default, so a 15-image gallery
        doesn't block the page.
   ========================================================================== */
(function (global) {
  function wireImage(img) {
    if (!img || img.dataset.velixImgWired) return;
    img.dataset.velixImgWired = '1';
    if (!img.hasAttribute('loading')) img.loading = 'lazy';
    img.decoding = 'async';
    const wrap = img.closest('.velix-img') || img.parentElement;
    if (wrap) wrap.classList.add('is-loading');

    function settle(ok) {
      if (wrap) { wrap.classList.remove('is-loading'); wrap.classList.toggle('is-error', !ok); }
    }

    if (img.complete && img.naturalWidth > 0) { settle(true); return; }
    img.addEventListener('load', () => settle(true), { once: true });
    img.addEventListener('error', () => {
      settle(false);
      if (!img.dataset.velixFallback) {
        img.dataset.velixFallback = '1';
        img.alt = img.alt || 'Image unavailable';
      }
    }, { once: true });
  }

  // Wrap a raw <img ...> HTML string fragment in the markup our CSS expects
  // (shimmer background + fallback icon shown via ::after when .is-error).
  function wrapImgHTML(imgHTML) {
    return `<span class="velix-img">${imgHTML}<span class="velix-img-fallback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>Image unavailable</span></span></span>`;
  }

  function wireAll(root) {
    root = root || document;
    (root.querySelectorAll ? root.querySelectorAll('.velix-img img') : []).forEach(wireImage);
  }

  if ('MutationObserver' in global) {
    const mo = new MutationObserver((muts) => {
      muts.forEach(m => m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('.velix-img img')) wireImage(node);
        wireAll(node);
      }));
    });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
  }
  if (document.readyState !== 'loading') wireAll(document);
  else document.addEventListener('DOMContentLoaded', () => wireAll(document));

  global.VELIX_IMG = { wireImage, wireAll, wrapImgHTML };
})(window);
