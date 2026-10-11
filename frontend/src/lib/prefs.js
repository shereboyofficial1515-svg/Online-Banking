// Display / accessibility / regional preferences: defaults, local storage and applying them to the document.
// Local storage is the preference store for signed-out visitors and a fast cache for signed-in customers (whose
// authoritative copy lives on the server and follows them across devices).
export const STORAGE_KEY = 'ewb.prefs';

export const DEFAULT_PREFS = {
  theme: 'system', language: 'en', textSize: 'default', motion: 'system', contrast: 'standard', timezone: null,
  dateFormat: 'system', timeFormat: 'system', numberFormat: 'system', currencyDisplay: 'symbol',
  dashboard: { showChart: true, showMoneyInOut: true, showRecent: true, showSecurity: true, defaultAccountId: null },
};

export function readLocalPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return mergePrefs(DEFAULT_PREFS, raw);
  } catch { return { ...DEFAULT_PREFS }; }
}
export function writeLocalPrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* private mode: the session still works */ }
}
export const mergePrefs = (base, patch) => ({ ...base, ...(patch || {}), dashboard: { ...base.dashboard, ...(patch?.dashboard || {}) } });

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
export const resolveTheme = (theme) => (theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme === 'dark' ? 'dark' : 'light');

/** Reflect preferences as data-attributes on <html>; tokens.css and base.css react to them. */
export function applyPrefsToDocument(prefs, root = document.documentElement) {
  root.setAttribute('data-theme', resolveTheme(prefs.theme));
  root.setAttribute('data-theme-pref', prefs.theme);
  const set = (name, on, value) => (on ? root.setAttribute(name, value) : root.removeAttribute(name));
  set('data-text-size', prefs.textSize !== 'default', prefs.textSize);
  set('data-contrast', prefs.contrast === 'high', 'high');
  set('data-motion', prefs.motion === 'reduce', 'reduce');
  root.setAttribute('lang', prefs.language || 'en');
}

export const FORMAT_KEYS = ['timezone', 'dateFormat', 'timeFormat', 'numberFormat', 'currencyDisplay', 'language'];
export const formatSignature = (p) => FORMAT_KEYS.map((k) => p[k] ?? '').join('|');

export function timezoneOptions() {
  try { return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')]; } catch { return ['UTC']; }
}
export const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
