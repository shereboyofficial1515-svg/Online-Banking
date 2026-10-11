import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const calls = [];
const state = { locked: false, unlockOk: true, session: null };
const USER = { id: 'u1', firstName: 'Avery', lastName: 'Morgan', email: 'a@example.test', hasProfilePhoto: true, profilePhotoVersion: 'abc123', mfaEnabled: false, isStaff: false };

vi.mock('../lib/api.js', async (orig) => {
  const real = await orig();
  const respond = (method, path, body) => {
    calls.push([method, path, body]);
    if (path === '/api/auth/config') return Promise.resolve({ awayLockSeconds: 60 });
    if (path === '/api/auth/session') return Promise.resolve(state.locked ? { authenticated: true, locked: true, lock: { firstName: 'Avery', mfaRequired: false, passkeyAvailable: false } } : { authenticated: true, locked: false, user: USER, permissions: [] });
    if (path === '/api/auth/lock') { state.locked = true; return Promise.resolve({ locked: true }); }
    if (path === '/api/auth/back') return Promise.resolve({ locked: state.locked });
    if (path === '/api/auth/unlock') { if (!state.unlockOk) return Promise.reject(Object.assign(new Error('That password is incorrect.'), { status: 422, details: { password: ['That password is incorrect.'] } })); state.locked = false; return Promise.resolve({ locked: false }); }
    if (path === '/api/auth/logout') return state.logoutError ? Promise.reject(Object.assign(new Error('We couldn’t reach EWB Bank.'), { code: 'NETWORK_ERROR' })) : Promise.resolve({ ok: true });
    return Promise.resolve({});
  };
  return { ...real, api: { get: (p) => respond('GET', p), post: (p, b) => respond('POST', p, b), beacon: (p) => { calls.push(['BEACON', p]); }, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() } };
});

const { AuthProvider, useAuth } = await import('../lib/auth.jsx');
const { default: SecurityLock } = await import('../lib/lock.jsx');
const { default: Avatar } = await import('../components/Avatar.jsx');
const { default: LogoutDialog } = await import('../components/LogoutDialog.jsx');
const { ToastProvider } = await import('../components/ui/Toast.jsx');

const setVisibility = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
const App = () => { const { user } = useAuth(); return <div><span data-testid="who">{user ? user.firstName : 'nobody'}</span><input aria-label="draft note" /></div>; };
const mount = () => render(<MemoryRouter><ToastProvider><AuthProvider><SecurityLock><App /></SecurityLock></AuthProvider></ToastProvider></MemoryRouter>);
const sent = (path) => calls.filter(([, p]) => p === path).length;

beforeEach(() => { calls.length = 0; state.locked = false; state.unlockOk = true; state.logoutError = false; sessionStorage.clear(); setVisibility('visible'); });
afterEach(() => { vi.useRealTimers(); });

describe('time away from the site', () => {
  it('leaving reports "away"; returning in under 60 seconds does not interrupt the user', async () => {
    mount();
    await screen.findByText('Avery');
    await waitFor(() => expect(sent('/api/auth/back')).toBeGreaterThan(0)); // page load counts as "back"
    const t0 = Date.now(); const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(t0);
    act(() => setVisibility('hidden'));
    expect(sent('/api/auth/away')).toBe(1);
    now.mockReturnValue(t0 + 30_000);
    act(() => setVisibility('visible'));
    await waitFor(() => expect(sent('/api/auth/back')).toBeGreaterThan(1));
    expect(sent('/api/auth/lock')).toBe(0);
    expect(screen.queryByRole('dialog', { name: /Session locked/ })).toBeNull();
    now.mockRestore();
  });

  it('returning after 60 seconds locks the session, hides the page content and asks for the password', async () => {
    mount();
    await screen.findByText('Avery');
    await waitFor(() => expect(sent('/api/auth/back')).toBeGreaterThan(0)); // listeners are registered
    const t0 = Date.now(); const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(t0);
    act(() => setVisibility('hidden'));
    now.mockReturnValue(t0 + 61_000); // timers may have been frozen: only the timestamps matter
    act(() => setVisibility('visible'));
    expect(await screen.findByRole('dialog', { name: /Session locked/ })).toBeInTheDocument();
    expect(sent('/api/auth/lock')).toBe(1);
    const wrap = document.querySelector('[data-locked="true"]');
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveAttribute('aria-hidden', 'true');
    expect(wrap.hasAttribute('inert')).toBe(true);
    now.mockRestore();
  });

  it('a wrong password keeps the lock, the right password releases it and keeps unsaved text', async () => {
    mount();
    await screen.findByText('Avery');
    fireEvent.change(screen.getByLabelText('draft note'), { target: { value: 'half-written message' } });
    act(() => { window.dispatchEvent(new Event('ewb:session-locked')); });
    const dlg = await screen.findByRole('dialog', { name: /Session locked/ });
    state.unlockOk = false;
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('That password is incorrect.')).toBeInTheDocument();
    expect(dlg).toBeInTheDocument();
    state.unlockOk = true;
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'right-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Session locked/ })).toBeNull());
    expect(screen.getByLabelText('draft note')).toHaveValue('half-written message');
    expect(calls.some(([m, p]) => p === '/api/auth/unlock' && m === 'POST')).toBe(true);
    expect(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toContain('right-password');
  });

  it('the page-load check also catches a tab restored after a long absence (timestamp survives in sessionStorage)', async () => {
    sessionStorage.setItem('ewb.hiddenAt', String(Date.now() - 5 * 60_000));
    mount();
    expect(await screen.findByRole('dialog', { name: /Session locked/ })).toBeInTheDocument();
  });

  it('an API refusal (SESSION_LOCKED from another tab or the server) shows the lock screen without any local timer', async () => {
    mount();
    await screen.findByText('Avery');
    act(() => { window.dispatchEvent(new CustomEvent('ewb:session-locked')); });
    expect(await screen.findByRole('dialog', { name: /Session locked/ })).toBeInTheDocument();
  });
});

describe('shared avatar', () => {
  const Probe = () => <Avatar alt="Avery Morgan" />;
  it('uses the photo version in the URL and falls back to initials if the image fails', async () => {
    render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    const img = await screen.findByAltText('Avery Morgan');
    expect(img.getAttribute('src')).toContain('/users/me/photo?v=abc123');
    fireEvent.error(img);
    expect(await screen.findByText('AM')).toBeInTheDocument();
  });
});

describe('logout confirmation', () => {
  it('shows the dialog, does nothing on Cancel, and only logs out on confirmation (once)', async () => {
    const onConfirm = vi.fn(() => new Promise((r) => setTimeout(r, 30)));
    const onClose = vi.fn();
    render(<LogoutDialog open onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Log out of EWB Bank?');
    expect(screen.getByText('Are you sure you want to log out of your account?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    const out = screen.getByRole('button', { name: 'Log out' });
    fireEvent.click(out); fireEvent.click(out); fireEvent.click(out);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(out).toHaveAttribute('aria-busy', 'true');
  });

  it('stays open with an honest message when the server cannot be reached', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('We couldn’t reach EWB Bank.'));
    render(<LogoutDialog open onClose={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByText(/couldn’t reach EWB Bank/)).toBeInTheDocument();
    expect(screen.getByText(/You are still signed in/)).toBeInTheDocument();
  });

  it('auth.logout() raises on a network failure instead of pretending the session ended', async () => {
    state.logoutError = true;
    let ctx; const Grab = () => { ctx = useAuth(); return null; };
    render(<MemoryRouter><AuthProvider><Grab /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(ctx.user).toBeTruthy());
    await expect(ctx.logout()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(ctx.user).toBeTruthy();
    state.logoutError = false;
    await act(async () => { await ctx.logout(); });
    expect(ctx.user).toBeNull();
  });
});
