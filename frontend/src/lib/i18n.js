// Localization framework. Strings live in catalogs (src/locales/<code>.js) and are looked up by key; missing keys fall back
// to English. A language is offered to customers ONLY when its catalog exists AND is complete (a test enforces that every
// offered catalog has exactly the same keys as English), so choosing a language can never leave half the interface untranslated.
// To add a language: create src/locales/<code>.js with every key, register it in CATALOGS/LANGUAGES, and add the code to
// LANGUAGES in backend/src/services/preferencesService.js.
import en from '../locales/en.js';

export const CATALOGS = { en };
export const LANGUAGES = [{ code: 'en', label: 'English' }];

let current = 'en';
export const getLanguage = () => current;
export const setLanguage = (code) => { current = CATALOGS[code] ? code : 'en'; };

export function t(key, vars) {
  const s = CATALOGS[current]?.[key] ?? CATALOGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}
