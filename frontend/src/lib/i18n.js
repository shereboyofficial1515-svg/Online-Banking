// Localization framework. Strings live in catalogs (src/locales/<code>.js) and are looked up by key. English is the source;
// any key missing from another catalog falls back to English (and is recorded in `missing`, never shown as a raw key), so a
// partially translated language degrades predictably instead of breaking the page.
//
// To add a language: create src/locales/<code>.js with the same keys as en.js, import it below and add one entry to LANGUAGES
// (code, English name, native name, direction, regional locale for number/date formatting), then add the code to LANGUAGES in
// backend/src/services/preferencesService.js. A test checks that every registered catalog has no unknown keys and reports its coverage.
// All non-English catalogs are marked `review: 'pending'` until a professional translator has checked them (docs/I18N.md).
import en from '../locales/en.js';
import fr from '../locales/fr.js';
import es from '../locales/es.js';
import pt from '../locales/pt.js';
import de from '../locales/de.js';
import ar from '../locales/ar.js';
import hi from '../locales/hi.js';

export const CATALOGS = { en, fr, es, pt, de, ar, hi };
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr', locale: 'en-US', region: 'US', review: 'source' },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr', locale: 'fr-FR', region: 'FR', review: 'pending' },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr', locale: 'es-ES', region: 'ES', review: 'pending' },
  { code: 'pt', name: 'Portuguese', native: 'Português', dir: 'ltr', locale: 'pt-PT', region: 'PT', review: 'pending' },
  { code: 'de', name: 'German', native: 'Deutsch', dir: 'ltr', locale: 'de-DE', region: 'DE', review: 'pending' },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl', locale: 'ar-AE', region: 'AE', review: 'pending' }, // ar-AE keeps Western digits, which suits financial figures
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr', locale: 'hi-IN', region: 'IN', review: 'pending' },
];

const byCode = (code) => LANGUAGES.find((l) => l.code === code);
export const languageInfo = (code) => byCode(code) || byCode('en');
export const isRtl = (code) => languageInfo(code).dir === 'rtl';
export const localeFor = (code) => languageInfo(code).locale;

let current = 'en';
export const getLanguage = () => current;
export const setLanguage = (code) => { current = CATALOGS[code] ? code : 'en'; };

/** Keys that were requested in a non-English language but are not translated yet (for tests and diagnostics). */
export const missing = new Set();

/** Share of the English keys that a catalog translates, 0..1. */
export const coverage = (code) => {
  const base = Object.keys(CATALOGS.en);
  const cat = CATALOGS[code] || {};
  return base.filter((k) => typeof cat[k] === 'string' && cat[k] !== '').length / base.length;
};

const interpolate = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s);

/**
 * t(key, { name }) -> translated string with {placeholders} filled in.
 * With a numeric `count`, `key_one`, `key_few`, `key_other`… are chosen with the language's own plural rules when they exist.
 */
export function t(key, vars) {
  const cat = CATALOGS[current];
  let k = key;
  if (vars && typeof vars.count === 'number') {
    const rule = new Intl.PluralRules(localeFor(current)).select(vars.count);
    for (const cand of [`${key}_${rule}`, `${key}_other`]) if (cat?.[cand] !== undefined || CATALOGS.en[cand] !== undefined) { k = cand; break; }
  }
  let s = cat?.[k];
  if (s === undefined) {
    if (current !== 'en') missing.add(`${current}:${k}`);
    s = CATALOGS.en[k];
  }
  return interpolate(s ?? key, vars);
}
