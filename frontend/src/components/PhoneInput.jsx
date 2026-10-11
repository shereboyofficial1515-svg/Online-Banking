import { useEffect, useMemo, useRef, useState } from 'react';
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import Combobox from './ui/Combobox.jsx';
import { Input } from './ui/Controls.jsx';
import { usePrefs } from '../lib/PreferencesProvider.jsx';
import { languageInfo } from '../lib/i18n.js';

/** Regional-indicator flag emoji. Some systems (e.g. Windows desktop browsers) draw the two letters instead; the ISO code and dial code are always shown too. */
export const flagOf = (iso) => String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Client-side check (the server repeats it): returns null when `value` ("+<code><number>") is valid for `country`, else a message key. */
export function phoneProblem(value, country) {
  if (!value) return 'phone.required';
  const p = parsePhoneNumberFromString(value, country);
  return p && p.isValid() ? null : 'phone.invalid';
}

const DEFAULT_COUNTRY = 'NG';
/** Starting country: the region of the browser's locale (e.g. en-NG -> Nigeria), else the language's usual region. The customer can change it. */
const guessCountry = (language) => {
  const all = getCountries();
  const fromBrowser = (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []).map((l) => String(l).split('-')[1]?.toUpperCase()).find((r) => r && all.includes(r));
  const region = languageInfo(language).region;
  return fromBrowser || (all.includes(region) ? region : DEFAULT_COUNTRY);
};

/**
 * International phone field: searchable country selector (flag, name, dial code) + number input with as-you-type formatting.
 *  value    : full international number such as "+2348031234567" (or "" when empty); onChange(value, country) receives the same.
 *  country  : ISO 3166 code currently selected (controlled by the parent so it can be sent with the form).
 * Pasting a number that starts with "+" switches the country to match, so the dial code and the number can never disagree.
 */
export default function PhoneInput({ id, value, country, onChange, invalid, describedBy, autoComplete = 'tel-national' }) {
  const { prefs, t } = usePrefs();
  const [national, setNational] = useState('');
  const selected = country || guessCountry(prefs.language);
  const names = useMemo(() => { try { return new Intl.DisplayNames([prefs.language, 'en'], { type: 'region' }); } catch { return null; } }, [prefs.language]);
  const options = useMemo(() => getCountries().map((iso) => {
    const name = names?.of(iso) || iso; const code = getCountryCallingCode(iso);
    return { value: iso, label: `${name} +${code}`, search: `${name} ${iso} +${code} ${code}`, name, code,
      render: () => <span className="phone-opt"><span className="flag" aria-hidden="true">{flagOf(iso)}</span><span className="cname">{name}</span><span className="iso">{iso}</span><span className="dial" dir="ltr">+{code}</span></span> };
  }).sort((a, b) => a.name.localeCompare(b.name, prefs.language)), [names, prefs.language]);
  const current = options.find((o) => o.value === selected);
  const first = useRef(true);

  // keep the visible number in step with a value set from outside (e.g. an existing phone on the profile page)
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    if (value) {
      const p = parsePhoneNumberFromString(value);
      if (p) { setNational(new AsYouType(p.country || selected).input(p.nationalNumber)); if (p.country && p.country !== selected) onChange(value, p.country); }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (iso, text) => {
    const digits = text.replace(/\D/g, '');
    onChange(digits ? `+${getCountryCallingCode(iso)}${digits}` : '', iso);
  };
  const typed = (e) => {
    const raw = e.target.value;
    if (raw.trim().startsWith('+') || raw.trim().startsWith('00')) { // an international number was pasted/typed: choose the matching country
      const p = parsePhoneNumberFromString(raw.trim().startsWith('00') ? `+${raw.trim().slice(2)}` : raw.trim());
      if (p?.country) { setNational(new AsYouType(p.country).input(p.nationalNumber)); onChange(p.number, p.country); return; }
      if (p) { setNational(p.nationalNumber); onChange(p.number, selected); return; }
    }
    const formatted = new AsYouType(selected).input(raw.replace(/[^\d\s()\-.]/g, ''));
    setNational(formatted); emit(selected, formatted);
  };
  const pick = (iso) => { emit(iso, national); onChange(national.replace(/\D/g, '') ? `+${getCountryCallingCode(iso)}${national.replace(/\D/g, '')}` : '', iso); setNational((n) => new AsYouType(iso).input(n.replace(/\D/g, ''))); };

  return (
    <div className={`phone-input ${invalid ? 'has-error' : ''}`}>
      <Combobox label={t('phone.country')} searchLabel={t('phone.search')} emptyText={t('phone.none')} value={selected} options={options} onChange={pick}
        className="phone-country" triggerClassName="phone-country-btn" invalid={invalid}
        renderSelected={() => <span className="phone-sel"><span className="flag" aria-hidden="true">{flagOf(selected)}</span><span className="iso">{selected}</span><span className="dial" dir="ltr">+{getCountryCallingCode(selected)}</span></span>}
        {...{ describedBy }} />
      <Input id={id} type="tel" inputMode="tel" dir="ltr" autoComplete={autoComplete} value={national} onChange={typed} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        aria-label={`${t('phone.label')} (${current?.name || selected} +${getCountryCallingCode(selected)})`} placeholder={t('phone.label')} />
    </div>
  );
}
