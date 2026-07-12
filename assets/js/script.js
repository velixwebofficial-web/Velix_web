/* ==========================================================================
   VELIX WEB SOLUTIONS — MAIN SCRIPT
   Vanilla JS — no dependencies
   ========================================================================== */

/* --------------------------------------------------------------------------
   FORM CONFIG — connect the contact form to a real inbox
   --------------------------------------------------------------------------
   1. Go to https://formspree.io and create a free account.
   2. Create a new form, point it at velixweb.official@gmail.com (or whatever
      inbox should receive leads).
   3. Formspree gives you an endpoint that looks like:
      https://formspree.io/f/abcdEFGH
   4. Paste that endpoint below, replacing the placeholder.
   Until this is set to a real endpoint, submissions are only saved locally
   in the visitor's own browser and will NEVER reach you — so this step is
   not optional before the site goes live.
   -------------------------------------------------------------------------- */
const VELIX_CONFIG = {
  formspreeEndpoint: 'https://formspree.io/f/REPLACE_ME'
};

document.addEventListener('DOMContentLoaded', () => {
  initLoader();
  initNavbar();
  initMobileNav();
  initCursor();
  initScrollReveal();
  initCounters();
  initContactForm();
  initYear();
  initActiveNavLink();
});

/* --------------------------------------------------------------------------
   Page loader — hides once window resources are ready
   -------------------------------------------------------------------------- */
function initLoader() {
  const loader = document.querySelector('.page-loader');
  if (!loader) return;

  const hide = () => loader.classList.add('is-hidden');

  // Hide as soon as everything is loaded, with a small minimum-display time
  // so the animation doesn't just flash on fast connections.
  const minTime = new Promise((resolve) => setTimeout(resolve, 450));
  const loaded = new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  });

  Promise.all([minTime, loaded]).then(hide);

  // Safety net in case load event never fires cleanly
  setTimeout(hide, 2500);
}

/* --------------------------------------------------------------------------
   Navbar — background/shrink on scroll
   -------------------------------------------------------------------------- */
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const onScroll = () => {
    navbar.classList.toggle('is-scrolled', window.scrollY > 24);
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* --------------------------------------------------------------------------
   Mobile navigation drawer
   -------------------------------------------------------------------------- */
function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');
  const backdrop = document.querySelector('.mobile-nav-backdrop');
  if (!toggle || !mobileNav) return;

  const closeNav = () => {
    toggle.classList.remove('is-active');
    mobileNav.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  toggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('is-open');
    toggle.classList.toggle('is-active', isOpen);
    if (backdrop) backdrop.classList.toggle('is-open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  if (backdrop) backdrop.addEventListener('click', closeNav);

  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeNav);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
  });
}

/* --------------------------------------------------------------------------
   Custom cursor — subtle dot + ring that follows the pointer,
   expands over interactive elements. Disabled on touch devices via CSS.
   -------------------------------------------------------------------------- */
function initCursor() {
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  const dot = document.createElement('div');
  const ring = document.createElement('div');
  dot.className = 'cursor-dot';
  ring.className = 'cursor-ring';
  document.body.append(dot, ring);

  let mouseX = 0, mouseY = 0;
  let ringX = 0, ringY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
  });

  // Smoothly trail the ring behind the dot
  const animateRing = () => {
    ringX += (mouseX - ringX) * 0.18;
    ringY += (mouseY - ringY) * 0.18;
    ring.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
    requestAnimationFrame(animateRing);
  };
  requestAnimationFrame(animateRing);

  const interactiveSelector = 'a, button, input, textarea, select, [data-cursor-hover]';
  document.addEventListener('mouseover', (e) => {
    if (e.target.closest(interactiveSelector)) ring.classList.add('is-active');
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest(interactiveSelector)) ring.classList.remove('is-active');
  });

  document.addEventListener('mouseleave', () => {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });
  document.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    ring.style.opacity = '1';
  });
}

/* --------------------------------------------------------------------------
   Scroll reveal — fade/slide elements up as they enter the viewport

   ROOT-CAUSE FIX: [data-reveal] elements start at opacity:0 in CSS and only
   become visible once this observer adds `.is-visible`. The old version only
   ever queried the DOM once, at DOMContentLoaded. Any page that injects
   [data-reveal] markup LATER — e.g. portfolio-render.js repainting the
   Portfolio grid after an async IndexedDB read — created elements the
   observer never knew existed, so they stayed invisible forever. That race
   (DOMContentLoaded firing before vs. after VELIX.ready resolves) is what
   made Portfolio cards "sometimes appear, sometimes don't, sometimes none at
   all": it was never a data problem, it was a reveal-animation timing bug.

   Fix: one shared observer + a MutationObserver that watches the whole
   document for newly added [data-reveal] nodes (or containers holding them)
   and observes them automatically. Any current or future dynamic render
   (Portfolio, News, the project modal, etc.) is covered with zero extra
   wiring required in the calling code.
   -------------------------------------------------------------------------- */
let _revealObserver = null;
function _getRevealObserver() {
  if (_revealObserver || !('IntersectionObserver' in window)) return _revealObserver;
  _revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          _revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  return _revealObserver;
}

function observeReveal(root) {
  root = root || document;
  const els = [];
  if (root.nodeType === 1 && root.matches && root.matches('[data-reveal]')) els.push(root);
  if (root.querySelectorAll) els.push(...root.querySelectorAll('[data-reveal]'));
  if (!els.length) return;

  const observer = _getRevealObserver();
  els.forEach((el) => {
    if (el.dataset.revealBound) return; // avoid double-observing the same node
    el.dataset.revealBound = '1';
    if (observer) observer.observe(el);
    else el.classList.add('is-visible'); // no IntersectionObserver support: show immediately
  });
}

function initScrollReveal() {
  observeReveal(document);

  if (!('MutationObserver' in window)) return;
  const mo = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        observeReveal(node);
      });
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// Exposed so any script can force-check a subtree immediately after an
// innerHTML swap, instead of waiting on the MutationObserver microtask.
window.VELIX_UI = window.VELIX_UI || {};
window.VELIX_UI.observeReveal = observeReveal;

/* --------------------------------------------------------------------------
   Animated stat counters
   -------------------------------------------------------------------------- */
function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const animate = (el) => {
    const target = parseFloat(el.dataset.count);
    const duration = 1600;
    const start = performance.now();
    const isFloat = !Number.isInteger(target);

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      el.textContent = isFloat ? value.toFixed(1) : Math.round(value);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = isFloat ? target.toFixed(1) : target;
    };
    requestAnimationFrame(step);
  };

  if (!('IntersectionObserver' in window)) {
    counters.forEach(animate);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  counters.forEach((el) => observer.observe(el));
}

/* --------------------------------------------------------------------------
   Contact form — lightweight client-side validation + friendly success state
   (No backend wired up: swap the submit handler for a real endpoint.)
   -------------------------------------------------------------------------- */
function initContactForm() {
  const form = document.querySelector('#contact-form');
  if (!form) return;

  const success = document.querySelector('.form-success');

  const i18nText = (key, fallback) => {
    if (window.VELIX_I18N && typeof window.VELIX_I18N.t === 'function') {
      const val = window.VELIX_I18N.t(key);
      if (val) return val;
    }
    return fallback;
  };

  const getMessage = (field) => {
    const validity = field.validity;
    if (validity.valueMissing) return i18nText('t_val_required', 'This field is required.');
    if (validity.typeMismatch) return i18nText('t_val_email', 'Please enter a valid email address.');
    if (validity.patternMismatch) return i18nText('t_val_phone', 'Please enter a valid phone number.');
    if (validity.tooShort) return i18nText('t_val_tooshort', `Please enter at least ${field.minLength} characters.`).replace('{n}', field.minLength);
    return i18nText('t_val_generic', 'Please check this field.');
  };

  const validateField = (field) => {
    const wrapper = field.closest('.field');
    if (!wrapper) return true;
    const errorEl = wrapper.querySelector('.field-error');

    if (field.checkValidity()) {
      wrapper.classList.remove('is-invalid');
      if (field.value.trim()) wrapper.classList.add('is-valid');
      else wrapper.classList.remove('is-valid');
      if (errorEl) errorEl.textContent = '';
      field.removeAttribute('aria-invalid');
      return true;
    }

    wrapper.classList.add('is-invalid');
    wrapper.classList.remove('is-valid');
    field.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.textContent = getMessage(field);
    return false;
  };

  // Live feedback as the person types/leaves a field
  form.querySelectorAll('input[required], textarea[required], input[type="email"]').forEach((field) => {
    field.addEventListener('blur', () => validateField(field));
    field.addEventListener('input', () => {
      if (field.closest('.field').classList.contains('is-invalid')) validateField(field);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const fields = Array.from(form.querySelectorAll('input, textarea')).filter((f) => f.required || f.type === 'email');
    const allValid = fields.map(validateField).every(Boolean);

    if (!allValid) {
      const firstInvalid = form.querySelector('.field.is-invalid input, .field.is-invalid textarea');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = i18nText('t_sending', 'Sending…');

    const data = {};
    fields.forEach((f) => { data[f.name || f.id] = f.value.trim(); });

    try {
      if (window.VELIX && VELIX.leads) {
        VELIX.leads.create(Object.assign({}, data, {
          name: data.name || data.fullName || data.email,
          source: 'Contact Form'
        }));
      }
    } catch (err) { /* local storage may be unavailable; not fatal */ }

    const finish = (ok) => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      if (ok) {
        form.reset();
        form.querySelectorAll('.field').forEach((w) => w.classList.remove('is-valid', 'is-invalid'));
        if (success) success.classList.add('is-visible');
      } else if (errorBanner) {
        errorBanner.classList.add('is-visible');
      }
    };

    const errorBanner = form.querySelector('.form-error-banner');
    const endpoint = VELIX_CONFIG.formspreeEndpoint;

    if (!endpoint || endpoint.indexOf('REPLACE_ME') !== -1) {
      const subject = encodeURIComponent('New inquiry from ' + (data.name || 'website visitor'));
      const body = encodeURIComponent(Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n'));
      window.location.href = `mailto:velixweb.official@gmail.com?subject=${subject}&body=${body}`;
      finish(true);
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    })
      .then((res) => finish(res.ok))
      .catch(() => finish(false));
  });
}

/* --------------------------------------------------------------------------
   Footer year
   -------------------------------------------------------------------------- */
function initYear() {
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
}

/* --------------------------------------------------------------------------
   Highlight the current page in the nav based on the file name
   -------------------------------------------------------------------------- */
function initActiveNavLink() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-nav a').forEach((link) => {
    const href = link.getAttribute('href').split('/').pop();
    if (href === path) link.classList.add('active');
  });
}
