/* Activates the hero background video if the admin has set one in
   Admin → Settings → Hero Video. Falls back gracefully to the static
   hero visual when no video is configured. */
(function () {
  function init() {
    if (!window.VELIX) return;
    const hero = document.getElementById('heroSection');
    const video = document.getElementById('heroVideoBg');
    const overlay = document.getElementById('heroVideoOverlay');
    if (!hero || !video) return;

    const settings = VELIX.settings.get();
    if (settings.heroVideoUrl) {
      video.src = settings.heroVideoUrl;
      if (settings.heroPoster) video.poster = settings.heroPoster;
      video.style.display = 'block';
      overlay.style.display = 'block';
      hero.classList.add('has-video');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
