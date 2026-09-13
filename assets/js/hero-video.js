/* Activates the hero background video if the admin has set one in
   Admin → Settings → Hero Video. Falls back gracefully to the static
   hero visual when no video is configured. */
(function () {
  async function init() {
    if (!window.VELIX) return;
    const hero = document.getElementById('heroSection');
    const video = document.getElementById('heroVideoBg');
    const overlay = document.getElementById('heroVideoOverlay');
    if (!hero || !video) return;

    await VELIX.ready;
    const settings = await VELIX.settings.get();
    if (settings && settings.hero_video_url) {
      video.src = settings.hero_video_url;
      if (settings.hero_poster) video.poster = settings.hero_poster;
      video.style.display = 'block';
      overlay.style.display = 'block';
      hero.classList.add('has-video');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
