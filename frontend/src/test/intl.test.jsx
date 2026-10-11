import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const store = { language: 'en', onChange: vi.fn() };
vi.mock('../lib/PreferencesProvider.jsx', async () => {
  const i = await import('../lib/i18n.js');
  return { usePrefs: () => ({ t: i.t, prefs: { language: store.language, theme: 'system' }, save: async () => {}, setTheme: () => {} }) };
});

const i18n = await import('../lib/i18n.js');
const { default: PhoneInput, phoneProblem, flagOf } = await import('../components/PhoneInput.jsx');
const { default: Combobox } = await import('../components/ui/Combobox.jsx');
const fmt = await import('../lib/format.js');
const { applyPrefsToDocument, DEFAULT_PREFS } = await import('../lib/prefs.js');

import { useState } from 'react';
const Harness = ({ initial = '', initialCountry = '' }) => {
  const [v, setV] = useState(initial); const [c, setC] = useState(initialCountry);
  return <><PhoneInput id="ph" value={v} country={c} onChange={(val, iso) => { setV(val); setC(iso); }} /><output data-testid="out">{v}|{c}</output></>;
};
const out = () => screen.getByTestId('out').textContent;

beforeEach(() => { store.language = 'en'; i18n.setLanguage('en'); i18n.missing.clear(); fmt.configureFormat({}); });

describe('phone input', () => {
  it('shows flag, ISO code and dial code, and builds an international number from the chosen country', async () => {
    render(<Harness initialCountry="NG" />);
    expect(screen.getByRole('button', { name: 'Country' })).toHaveTextContent('+234');
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '803 123 4567' } });
    expect(out()).toBe('+2348031234567|NG');
    expect(phoneProblem(out().split('|')[0], 'NG')).toBeNull();
  });

  it('is searchable by country name and by dial code, and lists every selected country with its code', async () => {
    render(<Harness initialCountry="NG" />);
    fireEvent.click(screen.getByRole('button', { name: 'Country' }));
    const search = await screen.findByRole('combobox');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(200); // full international list, but searchable
    fireEvent.change(search, { target: { value: 'ghana' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('+233');
    fireEvent.change(search, { target: { value: '+91' } });
    expect(screen.getAllByRole('option').some((o) => /India/.test(o.textContent))).toBe(true);
    fireEvent.change(search, { target: { value: 'zzzzzz' } });
    expect(screen.getByText('No matching country')).toBeInTheDocument();
  });

  it('works from the keyboard: arrows move, Enter selects, Escape closes and returns focus', async () => {
    render(<Harness initialCountry="NG" />);
    const trigger = screen.getByRole('button', { name: 'Country' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const search = await screen.findByRole('combobox');
    expect(search).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(search, { target: { value: 'united kingdom' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('button', { name: 'Country' })).toHaveTextContent('+44');
    fireEvent.click(screen.getByRole('button', { name: 'Country' }));
    fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('pasting a full international number switches the country so the code and number cannot disagree', () => {
    render(<Harness initialCountry="NG" />);
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '+44 20 7123 4567' } });
    expect(out()).toBe('+442071234567|GB');
    expect(screen.getByRole('button', { name: 'Country' })).toHaveTextContent('+44');
  });

  it('validation is per country, not a digit count', () => {
    expect(phoneProblem('', 'NG')).toBe('phone.required');
    expect(phoneProblem('+23480', 'NG')).toBe('phone.invalid');
    expect(phoneProblem('+15550100199', 'US')).toBe('phone.invalid');
    expect(phoneProblem('+12125550123', 'US')).toBeNull();
    expect(phoneProblem('+919876543210', 'IN')).toBeNull();
    expect(flagOf('NG')).toBe('🇳🇬');
  });
});

describe('searchable combobox accessibility', () => {
  it('exposes listbox/option roles with selection state', async () => {
    render(<Combobox label="Pick" searchLabel="Find" emptyText="none" value="b" onChange={() => {}} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));
    const opts = await screen.findAllByRole('option');
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('internationalisation framework', () => {
  it('registers a broad, extensible list and reports honest coverage; every catalog only uses known keys', () => {
    expect(i18n.LANGUAGES.map((l) => l.code)).toEqual(expect.arrayContaining(['en', 'fr', 'es', 'pt', 'de', 'ar', 'hi']));
    for (const l of i18n.LANGUAGES) {
      expect(Object.keys(i18n.CATALOGS[l.code]).filter((k) => !(k in i18n.CATALOGS.en)), `${l.code} has unknown keys`).toEqual([]);
      expect(i18n.coverage(l.code)).toBeGreaterThan(0.99);
      if (l.code !== 'en') expect(l.review, `${l.code} must not be advertised as professionally reviewed`).toBe('pending');
    }
  });

  it('switching the language changes the visible text; placeholders are preserved', () => {
    i18n.setLanguage('fr');
    expect(i18n.t('nav.overview')).toBe('Aperçu');
    expect(i18n.t('overview.hello', { name: 'Ada' })).toBe('Bonjour, Ada');
    i18n.setLanguage('es');
    expect(i18n.t('lock.welcome', { name: 'Ada' })).toContain('Ada');
    i18n.setLanguage('ar');
    expect(i18n.t('transfer.ewb')).toBe('إلى EWB');
    for (const l of i18n.LANGUAGES) { i18n.setLanguage(l.code); expect(i18n.t('lock.welcome', { name: 'ZZ' })).toContain('ZZ'); expect(i18n.t('lock.welcome', { name: 'ZZ' })).not.toMatch(/\{name\}/); }
  });

  it('a missing translation falls back to English, is recorded, and never shows a raw key', () => {
    i18n.CATALOGS.xx = { 'nav.overview': 'XX-overview' };
    i18n.setLanguage('xx');
    expect(i18n.t('nav.accounts')).toBe('Accounts');
    expect(i18n.missing.has('xx:nav.accounts')).toBe(true);
    delete i18n.CATALOGS.xx;
    i18n.setLanguage('en');
  });

  it('plural keys follow the language plural rules', () => {
    i18n.CATALOGS.en['t.items_one'] = '{count} item'; i18n.CATALOGS.en['t.items_other'] = '{count} items';
    expect(i18n.t('t.items', { count: 1 })).toBe('1 item');
    expect(i18n.t('t.items', { count: 5 })).toBe('5 items');
    delete i18n.CATALOGS.en['t.items_one']; delete i18n.CATALOGS.en['t.items_other'];
  });

  it('right-to-left languages set dir="rtl" on the document; others reset it', () => {
    applyPrefsToDocument({ ...DEFAULT_PREFS, language: 'ar' });
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    applyPrefsToDocument({ ...DEFAULT_PREFS, language: 'fr' });
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    applyPrefsToDocument({ ...DEFAULT_PREFS, language: 'en' });
  });

  it('numbers and dates follow the language locale, while the stored amount and the account currency never change', () => {
    const minor = 123456789; // 1,234,567.89 in the account\'s own currency
    fmt.configureFormat({ language: 'en' });
    const en = fmt.money(minor, 'NGN');
    fmt.configureFormat({ language: 'de' });
    const de = fmt.money(minor, 'NGN');
    fmt.configureFormat({ language: 'fr' });
    const fr = fmt.money(minor, 'NGN');
    expect(en).toMatch(/1,234,567\.89/);
    expect(de).toMatch(/1\.234\.567,89/);
    expect(fr.replace(/\s/g, ' ')).toMatch(/1 234 567,89/);
    for (const s of [en, de, fr]) expect(s).toMatch(/NGN|₦/); // the currency is always the account's, never the language's
    fmt.configureFormat({ language: 'hi' });
    expect(fmt.number(1234567.89)).toMatch(/12,34,567\.89/); // lakh grouping
    fmt.configureFormat({ language: 'de' });
    expect(fmt.date('2026-10-31T12:00:00Z')).toMatch(/31\./);
    fmt.configureFormat({ language: 'en', numberFormat: 'fr-FR' }); // an explicit regional choice still wins over the language default
    expect(fmt.number(1234.5).replace(/\s/g, ' ')).toBe('1 234,5');
    expect(minor).toBe(123456789);
  });
});
