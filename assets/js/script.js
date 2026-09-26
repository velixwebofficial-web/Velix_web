/* ==========================================================================
   VELIX WEB SOLUTIONS — MAIN SCRIPT
   Vanilla JS — no dependencies
   ========================================================================== */

/* --------------------------------------------------------------------------
   FORM CONFIG — connect the quote + contact forms to a real inbox
   --------------------------------------------------------------------------
   THE SITE IS STATIC. There is no server on the public host that can send an
   email (server.js runs locally and only serves /admin), so form delivery has
   to go through a third-party submission service. This site uses Web3Forms.

   TO TURN THE FORMS ON — one step, about two minutes:
     1. Go to https://web3forms.com
     2. Enter  hello@velixweb.xyz  in the "Create Access Key" box.
     3. Web3Forms emails an access key (a UUID) to that address.
     4. Paste it below, replacing REPLACE_WITH_WEB3FORMS_ACCESS_KEY.

   Every submission then arrives as an email at hello@velixweb.xyz. Nothing
   else needs configuring and no account/dashboard is required.

   UNTIL THE KEY IS SET, the forms do NOT pretend to work. Submitting shows a
   clearly-worded failure notice with the direct email and phone number, and
   the visitor's typed answers are left in the form so nothing is lost. That
   is deliberate: a fake "thanks, we got it!" loses real leads silently.
   -------------------------------------------------------------------------- */
const VELIX_CONFIG = {
  web3formsKey: 'REPLACE_WITH_WEB3FORMS_ACCESS_KEY',
  web3formsEndpoint: 'https://api.web3forms.com/submit',
  inboxEmail: 'hello@velixweb.xyz',
  inboxPhone: '+962799691748'
};

function velixFormsAreLive() {
  const k = VELIX_CONFIG.web3formsKey;
  return !!k && k.indexOf('REPLACE_WITH') === -1;
}

document.addEventListener('DOMContentLoaded', () => {
  initLoader();
  initNavbar();
  initMobileNav();
  initCursor();
  initScrollReveal();
  initCounters();
  initLeadForms();
  initNewsletterForms();
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
  const closeBtn = document.querySelector('.mobile-nav-close');
  if (!toggle || !mobileNav) return;

  let lastFocused = null;

  const focusables = () =>
    Array.from(
      mobileNav.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);

  const i18nAria = (key, fallback) => {
    if (window.VELIX_I18N && typeof window.VELIX_I18N.t === 'function') {
      const val = window.VELIX_I18N.t(key);
      if (val) return val;
    }
    return fallback;
  };

  const openNav = () => {
    lastFocused = document.activeElement;
    mobileNav.classList.add('is-open');
    mobileNav.setAttribute('aria-hidden', 'false');
    toggle.classList.add('is-active');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', i18nAria('t_nav_close', 'Close menu'));
    if (backdrop) backdrop.classList.add('is-open');
    document.body.classList.add('nav-open');
    // Focus the close button so a keyboard/screen-reader user lands inside
    // the drawer rather than continuing through the page behind it.
    if (closeBtn) closeBtn.focus();
  };

  const closeNav = ({ restoreFocus = true } = {}) => {
    if (!mobileNav.classList.contains('is-open')) return;
    mobileNav.classList.remove('is-open');
    mobileNav.setAttribute('aria-hidden', 'true');
    toggle.classList.remove('is-active');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', i18nAria('t_nav_open', 'Open menu'));
    if (backdrop) backdrop.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };

  toggle.addEventListener('click', () => {
    if (mobileNav.classList.contains('is-open')) closeNav();
    else openNav();
  });

  if (closeBtn) closeBtn.addEventListener('click', () => closeNav());
  if (backdrop) backdrop.addEventListener('click', () => closeNav());

  // Navigating away closes the drawer. The language buttons must NOT close it:
  // switching language is a change you want to see applied to the open menu.
  mobileNav.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', () => closeNav({ restoreFocus: false }));
  });

  document.addEventListener('keydown', (e) => {
    if (!mobileNav.classList.contains('is-open')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeNav();
      return;
    }

    // Keep Tab inside the drawer while it is open.
    if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Rotating to landscape or resizing up to desktop must not leave the page
  // scroll-locked behind a drawer that is no longer displayed.
  window.addEventListener('resize', () => {
    if (window.innerWidth > 940) closeNav({ restoreFocus: false });
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
   Portfolio grid after an async API read — created elements the
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
   Lead forms — the contact form and the quote form share one handler.

   HONESTY RULE: the success panel is shown only after the submission service
   confirms delivery. If the service is not configured, or the request fails,
   the visitor sees a failure notice with a direct email and phone link and
   their answers stay in the form. No submission is ever reported as
   delivered unless it was.
   -------------------------------------------------------------------------- */
function initLeadForms() {
  document.querySelectorAll('form[data-lead-form]').forEach(initLeadForm);
}

function initLeadForm(form) {
  const card = form.closest('.contact-form-card, .quote-card') || form.parentElement;
  const success = card.querySelector('.form-success');
  const errorBanner = card.querySelector('.form-error-banner');
  const offlineBanner = card.querySelector('.form-offline-banner');

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
  form
    .querySelectorAll('input[required], select[required], textarea[required], input[type="email"]')
    .forEach((field) => {
      const evt = field.tagName === 'SELECT' ? 'change' : 'blur';
      field.addEventListener(evt, () => validateField(field));
      field.addEventListener('input', () => {
        const wrapper = field.closest('.field');
        if (wrapper && wrapper.classList.contains('is-invalid')) validateField(field);
      });
    });

  const hideBanners = () => {
    [success, errorBanner, offlineBanner].forEach((el) => {
      if (el) el.classList.remove('is-visible');
    });
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    hideBanners();

    // Honeypot: a real visitor never fills a field they cannot see. Silently
    // accept and discard, so a bot gets no signal that it was detected.
    const honeypot = form.querySelector('input[name="botcheck"]');
    if (honeypot && honeypot.checked) return;

    const controls = Array.from(form.querySelectorAll('input, select, textarea')).filter(
      (f) => f.type !== 'checkbox' && f.type !== 'hidden'
    );
    const mustValidate = controls.filter((f) => f.required || f.type === 'email');
    const allValid = mustValidate.map(validateField).every(Boolean);

    if (!allValid) {
      const firstInvalid = form.querySelector(
        '.field.is-invalid input, .field.is-invalid select, .field.is-invalid textarea'
      );
      if (firstInvalid) {
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.innerHTML;

    const data = {};
    controls.forEach((f) => {
      const key = f.name || f.id;
      if (key && f.value.trim()) data[key] = f.value.trim();
    });

    const formLabel = form.dataset.leadForm || 'Website Form';

    const restoreButton = () => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
    };

    const showPanel = (panel) => {
      if (!panel) return;
      panel.classList.add('is-visible');
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    /* ----- Not configured yet: say so plainly, keep the visitor's answers ---
       Previously this branch opened a mailto: link and then displayed the
       success panel unconditionally — on a phone that usually does nothing
       at all, so the visitor was told their message had been received when
       nothing had been sent and nothing had been stored. */
    if (!velixFormsAreLive()) {
      console.error(
        'VELIX: form not sent — no Web3Forms access key is configured. ' +
          'See the FORM CONFIG block at the top of assets/js/script.js.'
      );
      showPanel(offlineBanner || errorBanner);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = i18nText('t_sending', 'Sending…');

    // Best-effort mirror into the local admin CRM (server.js /api/leads).
    // On the public static host this endpoint does not exist and the call
    // simply fails — which is fine, it is a convenience, never the delivery
    // mechanism, and it must not influence what the visitor is told.
    if (window.VELIX && VELIX.leads) {
      VELIX.leads
        .create(
          Object.assign({}, data, {
            name: data.name || data.fullName || data.email,
            source: formLabel
          })
        )
        .catch(() => {
          /* expected on the static host — the email below is the real path */
        });
    }

    const payload = Object.assign({}, data, {
      access_key: VELIX_CONFIG.web3formsKey,
      subject: `${formLabel} — ${data.name || 'website visitor'}`,
      from_name: 'VELIX Website'
    });

    fetch(VELIX_CONFIG.web3formsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        restoreButton();
        if (ok && json && json.success) {
          form.reset();
          form
            .querySelectorAll('.field')
            .forEach((w) => w.classList.remove('is-valid', 'is-invalid'));
          showPanel(success);
        } else {
          console.error('VELIX: submission rejected by Web3Forms.', json);
          showPanel(errorBanner);
        }
      })
      .catch((err) => {
        restoreButton();
        console.error('VELIX: submission failed to reach Web3Forms.', err);
        showPanel(errorBanner);
      });
  });
}

/* --------------------------------------------------------------------------
   Footer newsletter form
   ROOT-CAUSE FIX: this used to be an inline onsubmit="" that only reset the
   field and swapped the placeholder text — it never sent the email address
   anywhere, so every "subscription" was fake and lost on refresh. There is
   no dedicated subscribers table yet (see lib/db.js), so this reuses the
   same `leads` table the contact form and chat widget already write to
   through the server (VELIX.leads.create -> POST /api/leads), tagged with
   source "Newsletter" so it's easy to spot in Admin > Leads. A dedicated
   `subscribers` table can replace this later without changing this
   function's public behavior.
   -------------------------------------------------------------------------- */
function initNewsletterForms() {
  document.querySelectorAll('form[data-newsletter-form]').forEach((form) => {
    const input = form.querySelector('input[type="email"]');
    const button = form.querySelector('button[type="submit"]');
    if (!input || !button) return;
    const originalPlaceholder = input.placeholder;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email || !input.checkValidity()) { input.focus(); return; }

      button.disabled = true;
      input.disabled = true;

      const settle = (ok) => {
        form.reset();
        input.disabled = false;
        button.disabled = false;
        input.placeholder = ok
          ? "Thanks — you're subscribed!"
          : 'Something went wrong — please try again.';
        setTimeout(() => { input.placeholder = originalPlaceholder; }, 4000);
      };

      if (window.VELIX && VELIX.leads) {
        VELIX.leads.create({ name: email, email, source: 'Newsletter' })
          .then(() => settle(true))
          .catch((err) => {
            console.warn('VELIX: newsletter signup failed to save.', err);
            settle(false);
          });
      } else {
        settle(false);
      }
    });
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
  document.querySelectorAll('.nav-links a, .mobile-nav .mnav-link').forEach((link) => {
    const href = (link.getAttribute('href') || '').split('/').pop();
    if (href === path) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}
