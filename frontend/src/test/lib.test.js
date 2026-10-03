import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { money, relativeTime, passwordChecks, passwordScore, mask, titleCase, initials } from '../lib/format.js';

describe('format helpers', () => {
  it('formats minor units as currency without float drift', () => {
    expect(money(1999)).toBe('$19.99');
    expect(money(10)).toBe('$0.10');
    expect(money(250075, 'USD')).toBe('$2,500.75');
    expect(money(null)).toBe('$0.00');
  });
  it('masks account numbers and title-cases statuses', () => {
    expect(mask('EWB1234567890')).toBe('••••7890');
    expect(titleCase('additional_verification_required')).toBe('Additional verification required');
    expect(initials({ firstName: 'ana', lastName: 'lee' })).toBe('AL');
  });
  it('relativeTime is human readable', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(relativeTime('2026-10-02T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-10-02T11:30:00Z', now)).toBe('30 minutes ago');
    expect(relativeTime('2026-10-02T10:00:00Z', now)).toBe('2 hours ago');
    expect(relativeTime('2026-09-30T12:00:00Z', now)).toBe('2 days ago');
  });
  it('password checks mirror the server policy', () => {
    expect(passwordScore('Str0ng!Passw0rd#42')).toBe(6);
    expect(passwordScore('short')).toBeLessThan(3);
    expect(passwordChecks('MyPassword!2024xyz').find((c) => c.id === 'common').ok).toBe(false);
    expect(passwordChecks('jordanlee!Aa1234567', 'jordanlee@example.com').find((c) => c.id === 'common').ok).toBe(false);
  });
});

describe('api client', () => {
  let api;
  beforeEach(async () => {
    vi.resetModules();
    document.cookie = 'ewb_csrf=tok123';
    api = (await import('../lib/api.js')).api;
  });
  afterEach(() => vi.restoreAllMocks());

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends the CSRF header on writes and never on reads, with credentials included', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    await api.get('/api/accounts');
    await api.post('/api/withdrawals', { a: 1 });
    expect(f.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
    expect(f.mock.calls[1][1].headers['X-CSRF-Token']).toBe('tok123');
    expect(f.mock.calls[1][1].credentials).toBe('include');
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ a: 1 });
  });
  it('tolerates null params and drops empty query values', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {}));
    await api.get('/api/transactions', null);
    await api.get('/api/transactions', { q: '', type: 'transfer', limit: 5 });
    expect(f.mock.calls[0][0]).toBe('/api/transactions');
    expect(f.mock.calls[1][0]).toBe('/api/transactions?type=transfer&limit=5');
  });
  it('maps API errors, including 422 field details, to ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(422, { error: { code: 'VALIDATION_ERROR', message: 'Bad', details: { email: ['Invalid'] }, requestId: 'r1' } }));
    const { ApiError, fieldErrors } = await import('../lib/api.js');
    const err = await api.post('/api/auth/register', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(fieldErrors(err)).toEqual({ email: 'Invalid' });
    expect(err.requestId).toBe('r1');
  });
  it('refreshes the session once on 401 then retries; signs out if refresh fails', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { ok: true })) // refresh
      .mockResolvedValueOnce(json(200, { accounts: [] })); // retry
    expect(await api.get('/api/accounts')).toEqual({ accounts: [] });
    expect(f.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect(f).toHaveBeenCalledTimes(3);

    await new Promise((r) => setTimeout(r, 5)); // let the single-flight refresh slot clear
    const expired = vi.fn();
    window.addEventListener('ewb:session-expired', expired);
    f.mockReset()
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'SESSION_EXPIRED', message: 'gone' } }));
    await expect(api.get('/api/accounts')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalled();
  });
  it('does not try to refresh for login failures', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'nope' } }));
    await expect(api.post('/api/auth/login', {})).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
