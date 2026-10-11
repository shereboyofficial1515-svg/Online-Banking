import { localeFor } from './i18n.js';
// Presentation formatting. Stored values never change: timestamps are UTC instants and money is integer minor units
// in the account's own currency. These helpers only decide how they are displayed, following the customer's regional
// preferences (timezone, date/time/number format, currency display) configured via configureFormat().
const state = { timeZone: undefined, dateFormat: 'system', timeFormat: 'system', numberLocale: undefined, currencyDisplay: 'symbol', languageLocale: undefined };

export function configureFormat(p = {}) {
  state.timeZone = p.timezone || undefined; // undefined = the browser's timezone
  state.dateFormat = p.dateFormat || 'system';
  state.timeFormat = p.timeFormat || 'system';
  // "Match my device" now means "follow the chosen language": French shows 1 234,56 and 31/10/2026, Hindi uses lakh grouping, etc.
  // Only the display changes; stored amounts (integer minor units) and each account's currency are never touched.
  state.languageLocale = p.language && p.language !== 'en' ? localeFor(p.language) : undefined;
  state.numberLocale = p.numberFormat && p.numberFormat !== 'system' ? p.numberFormat : state.languageLocale;
  state.currencyDisplay = p.currencyDisplay === 'code' ? 'code' : 'symbol';
}
export const getFormat = () => ({ ...state });

const dateLocale = () => ({ mdy: 'en-US', dmy: 'en-GB', ymd: 'en-CA' }[state.dateFormat]) ?? state.languageLocale; // undefined => browser default
const hour12 = () => (state.timeFormat === '12h' ? true : state.timeFormat === '24h' ? false : undefined);

export const money = (minor, currency = 'USD') =>
  new Intl.NumberFormat(state.numberLocale, { style: 'currency', currency, currencyDisplay: state.currencyDisplay }).format(Number(minor ?? 0) / 100);
export const number = (n, opts) => new Intl.NumberFormat(state.numberLocale, opts).format(n);

const dateOpts = () => (state.dateFormat === 'ymd' ? { year: 'numeric', month: '2-digit', day: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' });
const timeOpts = () => ({ hour: 'numeric', minute: '2-digit', hour12: hour12() });

export const date = (iso) => (iso ? new Intl.DateTimeFormat(dateLocale(), { ...dateOpts(), timeZone: state.timeZone }).format(new Date(iso)) : '—');
export const time = (iso) => (iso ? new Intl.DateTimeFormat(dateLocale(), { ...timeOpts(), timeZone: state.timeZone }).format(new Date(iso)) : '—');
export const dateTime = (iso) => (iso ? new Intl.DateTimeFormat(dateLocale(), { ...dateOpts(), ...timeOpts(), timeZone: state.timeZone }).format(new Date(iso)) : '—');

export function relativeTime(iso, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400]];
  let out = 'just now';
  for (const [name, size] of units) if (s >= size) { const n = Math.floor(s / size); out = `${n} ${name}${n > 1 ? 's' : ''} ago`; }
  return s >= 86400 * 30 ? date(iso) : out;
}

export const mask = (n) => (n ? `••••${String(n).slice(-4)}` : '');
export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const initials = (u) => `${u?.firstName?.[0] ?? ''}${u?.lastName?.[0] ?? ''}`.toUpperCase() || 'EW';

// Mirrors the server password policy so users get instant feedback; the server remains the authority.
export function passwordChecks(pw, email = '') {
  const local = email.split('@')[0]?.toLowerCase();
  return [
    { id: 'len', label: 'At least 12 characters', ok: pw.length >= 12 },
    { id: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(pw) },
    { id: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(pw) },
    { id: 'num', label: 'A number', ok: /\d/.test(pw) },
    { id: 'sym', label: 'A symbol', ok: /[^A-Za-z0-9]/.test(pw) },
    { id: 'common', label: 'No common words or your email name', ok: pw.length > 0 && !/password|qwerty|123456|letmein|welcome|iloveyou/i.test(pw) && !(local && local.length >= 4 && pw.toLowerCase().includes(local)) },
  ];
}
export const passwordScore = (pw, email) => passwordChecks(pw, email).filter((c) => c.ok).length;

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
