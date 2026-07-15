/* Premium micro-motion layer using GSAP + ScrollTrigger.
   Kept intentionally light — a couple of orchestrated moments rather than
   animation on every element, per the "less is more" direction. */
(function () {
  function init() {
    if (typeof gsap === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);

    // Avoids layout-jank re-triggers on mobile browsers where the address bar
    // hides/shows and momentarily changes the viewport height.
    ScrollTrigger.config({ ignoreMobileResize: true });

    // Hero: gentle parallax on the visual/video so the page-load moment feels directed.
    // Pick whichever element is actually being shown: the video background when
    // the admin has configured one, otherwise the static hero visual. Querying
    // both separately (instead of one combined selector) avoids always grabbing
    // the hidden video element just because it happens to sit earlier in the DOM.
    const heroVideoBg = document.querySelector('.hero-video-bg');
    const heroStaticVisual = document.querySelector('.hero-visual');
    const heroVisual = (heroVideoBg && heroVideoBg.style.display !== 'none') ? heroVideoBg : heroStaticVisual;
    if (heroVisual) {
      gsap.to(heroVisual, {
        yPercent: 8,
        ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 }
      });
    }

    // Founder cards: subtle staggered lift as they enter.
    // clearProps removes GSAP's inline styles once the animation finishes, so
    // they don't linger and block the CSS :hover lift effect defined in style.css.
    gsap.utils.toArray('.founder-card').forEach((card, i) => {
      gsap.from(card, {
        y: 36, opacity: 0, scale: 0.97, duration: 0.8, ease: 'power3.out',
        delay: i * 0.1, clearProps: 'transform,opacity',
        scrollTrigger: { trigger: card, start: 'top 85%' }
      });
    });

    // Founder cards: gentle 3D tilt that follows the cursor, plus a soft
    // parallax push on the portrait photo — a common premium-agency touch.
    // Skipped entirely on touch devices (no mousemove) and respects the
    // prefers-reduced-motion check already performed above.
    gsap.utils.toArray('[data-tilt]').forEach((card) => {
      const img = card.querySelector('.founder-media img');
      const quickX = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' });
      const quickY = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      const quickImgX = img ? gsap.quickTo(img, 'x', { duration: 0.6, ease: 'power3.out' }) : null;
      const quickImgY = img ? gsap.quickTo(img, 'y', { duration: 0.6, ease: 'power3.out' }) : null;

      card.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        quickX(px * 6);
        quickY(py * -6);
        if (quickImgX && quickImgY) { quickImgX(px * -10); quickImgY(py * -10); }
      });
      card.addEventListener('pointerleave', () => {
        quickX(0); quickY(0);
        if (quickImgX && quickImgY) { quickImgX(0); quickImgY(0); }
      });
    });

    // About timeline items: draw in sequentially, echoing the idea of a journey.
    gsap.utils.toArray('.about-timeline-item').forEach((item, i) => {
      gsap.from(item, {
        x: -16, opacity: 0, duration: 0.6, ease: 'power2.out',
        delay: i * 0.12, clearProps: 'transform,opacity',
        scrollTrigger: { trigger: item, start: 'top 90%' }
      });
    });

    // Project cards: soft scale-in.
    gsap.utils.toArray('.project-card').forEach((card) => {
      gsap.from(card, {
        scale: 0.96, opacity: 0, duration: 0.6, ease: 'power2.out',
        clearProps: 'transform,opacity',
        scrollTrigger: { trigger: card, start: 'top 90%' }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
