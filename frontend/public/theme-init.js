/* Runs before the first paint (loaded as a blocking, same-origin script so it is allowed by the strict CSP) to apply the
   saved theme / text size / contrast / motion and cached brand colours, so there is no flash of the wrong theme.
   The React PreferencesProvider takes over afterwards and keeps these attributes in sync. */
(function () {
  try {
    var d = document.documentElement;
    var p = JSON.parse(localStorage.getItem('ewb.prefs') || '{}');
    var pref = p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.setAttribute('data-theme', dark ? 'dark' : 'light');
    d.setAttribute('data-theme-pref', pref);
    if (['small', 'large', 'xlarge'].indexOf(p.textSize) > -1) d.setAttribute('data-text-size', p.textSize);
    if (p.contrast === 'high') d.setAttribute('data-contrast', 'high');
    if (p.motion === 'reduce') d.setAttribute('data-motion', 'reduce');
    var b = JSON.parse(localStorage.getItem('ewb.brand') || 'null');
    if (b) {
      var hex = /^#[0-9a-fA-F]{6}$/;
      if (hex.test(b.primary)) d.style.setProperty('--brand-primary', b.primary);
      if (hex.test(b.secondary)) d.style.setProperty('--brand-secondary', b.secondary);
      if (hex.test(b.accent)) d.style.setProperty('--brand-accent', b.accent);
    }
  } catch (e) { /* storage unavailable: defaults apply */ }
})();
