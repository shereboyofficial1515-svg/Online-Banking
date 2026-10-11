// Phone numbers are validated with libphonenumber-js (per-country rules, not a fixed digit count) and stored in E.164.
import { parsePhoneNumberFromString, getCountryCallingCode } from 'libphonenumber-js';

/** Returns { e164, country, national } for a valid international number, otherwise null. A leading "+" (or 00) is required. */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 32) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) return null; // no guessing a country for a bare national number
  const p = parsePhoneNumberFromString(s);
  if (!p || !p.isValid()) return null;
  return { e164: p.number, country: p.country || null, callingCode: p.countryCallingCode, national: p.formatNational() };
}

/** The dial code of the country the customer selected must be the one in the number (US/CA, GB/JE etc. legitimately share codes). */
export function matchesCountry(parsed, iso) {
  try { return String(getCountryCallingCode(iso)) === String(parsed.callingCode); } catch { return false; }
}
