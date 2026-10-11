import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const store = { user: null, put: vi.fn(), get: vi.fn() };
vi.mock('../lib/api.js', async (orig) => ({
  ...(await orig()),
  api: {
    get: (...a) => store.get(...a), put: (...a) => store.put(...a), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
  },
}));
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => ({ user: store.user }) }));

const { PreferencesProvider, usePrefs } = await import('../lib/PreferencesProvider.jsx');
const { ToastProvider } = await import('../components/ui/Toast.jsx');
const { default: ThemeSwitcher } = await import('../components/ThemeSwitcher.jsx');
const prefsLib = await import('../lib/prefs.js');
const { configureFormat, money, dateTime, date, time, number } = await import('../lib/format.js');
const i18n = await import('../lib/i18n.js');
const en = (await import('../locales/en.js')).default;

const html = () => document.documentElement;
const Probe = () => { const { prefs, version, save } = usePrefs(); return (<><span data-testid="theme">{prefs.theme}</span><span data-testid="ver">{version}</span><button onClick={() => save({ textSize: 'large', contrast: 'high', motion: 'reduce' }).catch(() => {})}>save-a11y</button><button onClick={() => save({ timeFormat: '24h' }).catch(() => {})}>save-time</button></>); };
const mount = (ui = <><ThemeSwitcher /><Probe /></>) => render(<MemoryRouter><ToastProvider><PreferencesProvider>{ui}</PreferencesProvider></ToastProvider></MemoryRouter>);

describe('theme + preferences', () => {
  beforeEach(() => {
    localStorage.clear(); store.user = null; store.put.mockReset(); store.get.mockReset();
    ['data-theme', 'data-theme-pref', 'data-text-size', 'data-contrast', 'data-motion'].forEach((a) => html().removeAttribute(a));
    window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });

  it('defaults to the system theme (light here) and shows a visible three-way selector', () => {
    mount();
    expect(html()).toHaveAttribute('data-theme', 'light');
    const group = screen.getByRole('radiogroup', { name: 'Colour theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Match my device' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switching to dark updates every themed surface via data-theme and persists for signed-out visitors', async () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));
    await waitFor(() => expect(html()).toHaveAttribute('data-theme', 'dark'));
    expect(JSON.parse(localStorage.getItem('ewb.prefs')).theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'true');
  });

  it('restores the saved preference when the customer returns (a fresh mount reads storage)', () => {
    localStorage.setItem('ewb.prefs', JSON.stringify({ theme: 'dark', textSize: 'xlarge', contrast: 'high', motion: 'reduce' }));
    mount();
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(html()).toHaveAttribute('data-text-size', 'xlarge');
    expect(html()).toHaveAttribute('data-contrast', 'high');
    expect(html()).toHaveAttribute('data-motion', 'reduce');
  });

  it('"system" follows the operating system', () => {
    window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: q.includes('dark'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    mount();
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(html()).toHaveAttribute('data-theme-pref', 'system');
  });

  it('signed-in customers: the server copy is loaded on sign-in and saves are only applied after the backend confirms', async () => {
    store.user = { id: 'u1' };
    store.get.mockResolvedValue({ preferences: { ...prefsLib.DEFAULT_PREFS, theme: 'dark', textSize: 'large' } });
    store.put.mockResolvedValue({ preferences: { ...prefsLib.DEFAULT_PREFS, theme: 'dark', textSize: 'large', contrast: 'high', motion: 'reduce' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('dark'));
    expect(html()).toHaveAttribute('data-text-size', 'large');
    fireEvent.click(screen.getByText('save-a11y'));
    await waitFor(() => expect(store.put).toHaveBeenCalledWith('/api/users/me/preferences', { textSize: 'large', contrast: 'high', motion: 'reduce' }));
    await waitFor(() => expect(html()).toHaveAttribute('data-contrast', 'high'));
  });

  it('a rejected save is NOT applied (never shows an unsaved setting as saved)', async () => {
    store.user = { id: 'u1' };
    store.get.mockResolvedValue({ preferences: prefsLib.DEFAULT_PREFS });
    store.put.mockRejectedValue(Object.assign(new Error('Server says no'), { status: 500 }));
    mount();
    await waitFor(() => expect(store.get).toHaveBeenCalled());
    fireEvent.click(screen.getByText('save-a11y'));
    await waitFor(() => expect(store.put).toHaveBeenCalled());
    expect(html()).not.toHaveAttribute('data-contrast');
    expect(html()).not.toHaveAttribute('data-text-size');
  });

  it('formatting-related changes bump a version so pages re-render with the new formats', async () => {
    store.user = { id: 'u1' };
    store.get.mockResolvedValue({ preferences: prefsLib.DEFAULT_PREFS });
    store.put.mockResolvedValue({ preferences: { ...prefsLib.DEFAULT_PREFS, timeFormat: '24h' } });
    mount();
    await waitFor(() => expect(store.get).toHaveBeenCalled());
    const before = Number(screen.getByTestId('ver').textContent);
    fireEvent.click(screen.getByText('save-time'));
    await waitFor(() => expect(Number(screen.getByTestId('ver').textContent)).toBe(before + 1));
  });

  it('the header theme change reaches the profile for signed-in customers', async () => {
    store.user = { id: 'u1' };
    store.get.mockResolvedValue({ preferences: prefsLib.DEFAULT_PREFS });
    store.put.mockResolvedValue({ preferences: { ...prefsLib.DEFAULT_PREFS, theme: 'dark' } });
    mount();
    await waitFor(() => expect(store.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));
    await waitFor(() => expect(store.put).toHaveBeenCalledWith('/api/users/me/preferences', { theme: 'dark' }));
  });

  it('theme-init.js applies the saved theme before React renders and ignores hostile colour values', async () => {
    const { readFileSync } = await import('node:fs');
    const script = readFileSync(`${process.cwd()}/public/theme-init.js`, 'utf8');
    localStorage.setItem('ewb.prefs', JSON.stringify({ theme: 'dark', textSize: 'large' }));
    localStorage.setItem('ewb.brand', JSON.stringify({ primary: '#112233', accent: 'red;background:url(javascript:alert(1))' }));
    new Function(script)(); // eslint-disable-line no-new-func
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(html()).toHaveAttribute('data-text-size', 'large');
    expect(html().style.getPropertyValue('--brand-primary')).toBe('#112233');
    expect(html().style.getPropertyValue('--brand-accent')).not.toContain('javascript');
    html().style.removeProperty('--brand-primary');
  });
});

describe('regional formatting (display only; stored values are never changed)', () => {
  const instant = '2026-10-02T23:30:00Z';
  beforeEach(() => configureFormat({}));

  it('timezone changes the displayed date and time but not the instant', () => {
    configureFormat({ timezone: 'UTC' });
    expect(dateTime(instant)).toContain('11:30');
    configureFormat({ timezone: 'Asia/Tokyo' }); // +9h => next day 08:30
    expect(dateTime(instant)).toContain('8:30');
    expect(date(instant)).toContain('3'); // Oct 3 in Tokyo
    expect(new Date(instant).toISOString()).toBe('2026-10-02T23:30:00.000Z');
  });

  it('date and time format preferences', () => {
    configureFormat({ timezone: 'UTC', dateFormat: 'ymd', timeFormat: '24h' });
    expect(date(instant)).toBe('2026-10-02');
    expect(time(instant)).toMatch(/23:30/);
    configureFormat({ timezone: 'UTC', dateFormat: 'dmy', timeFormat: '12h' });
    expect(date(instant)).toMatch(/^2 Oct 2026$/);
    expect(time(instant)).toMatch(/11:30\s?PM/i);
    configureFormat({ timezone: 'UTC', dateFormat: 'mdy' });
    expect(date(instant)).toMatch(/Oct 2, 2026/);
  });

  it('number format and currency display change presentation only', () => {
    configureFormat({ numberFormat: 'en-US' });
    expect(money(123456, 'USD')).toBe('$1,234.56');
    configureFormat({ numberFormat: 'de-DE' });
    expect(money(123456, 'USD').replace(/ /g, ' ')).toBe('1.234,56 $');
    expect(number(1234567.5)).toBe('1.234.567,5');
    configureFormat({ numberFormat: 'en-US', currencyDisplay: 'code' });
    expect(money(123456, 'USD').replace(/ /g, ' ')).toBe('USD 1,234.56');
    expect(money(123456, 'EUR').replace(/ /g, ' ')).toBe('EUR 1,234.56'); // the account's currency is never converted
  });
});

describe('localization framework', () => {
  it('only offers languages whose catalog is complete (same keys as English)', () => {
    for (const { code } of i18n.LANGUAGES) {
      const cat = i18n.CATALOGS[code];
      expect(cat, `catalog for ${code}`).toBeTruthy();
      expect(Object.keys(cat).sort(), `${code} must define exactly the English keys`).toEqual(Object.keys(en).sort());
      expect(Object.values(cat).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    }
    expect(i18n.LANGUAGES.map((l) => l.code)).toContain('en');
  });

  it('translates with variables, falls back to English and then to the key', () => {
    i18n.setLanguage('en');
    expect(i18n.t('nav.overview')).toBe('Overview');
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
    i18n.CATALOGS.xx = { 'nav.overview': 'Resumen' };
    i18n.setLanguage('xx');
    expect(i18n.t('nav.overview')).toBe('Resumen');
    expect(i18n.t('nav.accounts')).toBe('Accounts'); // missing in xx => English
    i18n.setLanguage('zz'); // unknown language => English
    expect(i18n.getLanguage()).toBe('en');
    delete i18n.CATALOGS.xx;
  });

  it('every t("…") key used in the source exists in the English catalog', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const src = path.resolve(process.cwd(), 'src');
    const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === 'test' ? [] : walk(p)) : /\.jsx?$/.test(n) ? [p] : []; });
    const missing = [];
    for (const f of walk(src)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) if (!(m[1] in en)) missing.push(`${path.relative(src, f)}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
