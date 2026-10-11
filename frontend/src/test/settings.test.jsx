import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const store = { put: vi.fn(), get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() };
vi.mock('../lib/api.js', async (orig) => ({
  ...(await orig()),
  api: { get: (...a) => store.get(...a), put: (...a) => store.put(...a), post: (...a) => store.post(...a), patch: (...a) => store.patch(...a), delete: (...a) => store.del(...a), upload: vi.fn() },
}));
const reload = vi.fn();
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@example.test', emailVerified: true, firstName: 'A', lastName: 'B', address: {} }, reload, logout: vi.fn(), mfaEnrollmentRequired: false }) }));

const { PreferencesProvider } = await import('../lib/PreferencesProvider.jsx');
const { ToastProvider } = await import('../components/ui/Toast.jsx');
const S = await import('../pages/app/Settings.jsx');

const mount = (path) => render(
  <MemoryRouter initialEntries={[path]}><ToastProvider><PreferencesProvider>
    <Routes><Route path="/app/settings" element={<S.SettingsLayout />}>
      <Route path="display" element={<S.DisplaySettings />} /><Route path="accessibility" element={<S.AccessibilitySettings />} />
      <Route path="regional" element={<S.RegionalSettings />} /><Route path="email" element={<S.EmailSettings />} /><Route path="accounts" element={<S.AccountSettings />} />
      <Route path="dashboard" element={<S.DashboardSettings />} /><Route path="feedback" element={<S.FeedbackSettings />} />
    </Route></Routes>
  </PreferencesProvider></ToastProvider></MemoryRouter>);

const PREFS = { theme: 'system', language: 'en', textSize: 'default', motion: 'system', contrast: 'standard', timezone: null, dateFormat: 'system', timeFormat: 'system', numberFormat: 'system', currencyDisplay: 'symbol', dashboard: { showChart: true, showMoneyInOut: true, showRecent: true, showSecurity: true, defaultAccountId: null } };

beforeEach(() => {
  localStorage.clear(); Object.values(store).forEach((m) => m.mockReset());
  ['data-theme', 'data-text-size', 'data-contrast', 'data-motion'].forEach((a) => document.documentElement.removeAttribute(a));
  store.get.mockImplementation((p) => {
    if (p === '/api/users/me/preferences') return Promise.resolve({ preferences: PREFS });
    if (p === '/api/accounts') return Promise.resolve({ accounts: [{ id: 'a1', name: 'EWB Checking', accountNumber: '605123456789', type: 'checking', currency: 'USD', status: 'active', createdAt: '2026-01-01T00:00:00Z' }] });
    if (p.endsWith('/closure')) return Promise.resolve({ closure: null });
    return Promise.resolve({});
  });
});

describe('settings hub', () => {
  it('lists every real settings area and links onward', () => {
    mount('/app/settings/display');
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    for (const n of ['My profile', 'Account settings', 'Password & authentication', 'Active sessions & devices', 'Email settings', 'Notification settings', 'Display & language', 'Accessibility', 'Timezone & regional formats', 'Home screen', 'Feedback & suggestions', 'About & legal']) {
      expect(nav.textContent).toContain(n);
    }
  });

  it('offers only languages that actually exist', async () => {
    mount('/app/settings/display');
    const select = await screen.findByLabelText('Language');
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['en']);
  });

  it('saves display settings through the backend and says so only after it confirms', async () => {
    store.put.mockResolvedValue({ preferences: { ...PREFS, theme: 'dark' } });
    mount('/app/settings/display');
    fireEvent.click(await screen.findByRole('radio', { name: /Dark/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.put).toHaveBeenCalledWith('/api/users/me/preferences', expect.objectContaining({ theme: 'dark' })));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('shows the server error and does NOT claim success when saving fails; the setting stays unchanged', async () => {
    store.put.mockRejectedValue(Object.assign(new Error('Choose a valid timezone.'), { status: 422 }));
    mount('/app/settings/accessibility');
    fireEvent.click(await screen.findByRole('radio', { name: 'Large' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findAllByText('Choose a valid timezone.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Settings saved.')).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-text-size', 'large');
  });

  it('email change is a two-step flow: password then code; nothing is applied before the code is confirmed', async () => {
    store.post.mockImplementation((p) => Promise.resolve(p.endsWith('/confirm') ? { user: {} } : { sent: true }));
    mount('/app/settings/email');
    fireEvent.change(await screen.findByLabelText(/New email address/), { target: { value: 'new@example.test' } });
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: 'secret-value-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation code' }));
    expect(await screen.findByText(/Check your new inbox/)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Confirmation code/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(store.post).toHaveBeenCalledWith('/api/users/me/email-change/confirm', { code: '123456' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('account settings: rename and closure request go to the backend; closure needs the password', async () => {
    store.patch.mockResolvedValue({ account: {} }); store.post.mockResolvedValue({ closure: { status: 'requested' } });
    mount('/app/settings/accounts');
    const name = await screen.findByLabelText('Account name');
    fireEvent.change(name, { target: { value: 'Holiday fund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(store.patch).toHaveBeenCalledWith('/api/accounts/a1', { name: 'Holiday fund' }));
    fireEvent.click(screen.getByRole('button', { name: /Close this account/ }));
    const submit = await screen.findByRole('button', { name: 'Request closure' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: 'secret-value-1' } });
    fireEvent.click(submit);
    await waitFor(() => expect(store.post).toHaveBeenCalledWith('/api/accounts/a1/closure', { password: 'secret-value-1' }));
  });

  it('regional page offers the timezones plus "use my device"', async () => {
    mount('/app/settings/regional');
    const tz = await screen.findByLabelText('Timezone');
    expect(tz.querySelectorAll('option').length).toBeGreaterThan(100);
    expect(tz.querySelector('option[value=""]').textContent).toMatch(/device/);
  });
});
