import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('API client: configurable base URL, network failures and timeouts', () => {
  beforeEach(() => { vi.resetModules(); document.cookie = 'ewb_csrf=tok123'; });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('defaults to same-origin /api (works with the Vite proxy and a Vercel rewrite)', async () => {
    const { apiUrl } = await import('../lib/api.js');
    expect(apiUrl('/api/accounts')).toBe('/api/accounts');
    expect(apiUrl('/api')).toBe('/api');
  });

  it('VITE_API_BASE_URL switches every call (including asset URLs) to the configured backend', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.ewbbank.net/api/');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    const { api, apiUrl } = await import('../lib/api.js');
    await api.get('/api/accounts');
    expect(f.mock.calls[0][0]).toBe('https://api.ewbbank.net/api/accounts');
    expect(f.mock.calls[0][1].credentials).toBe('include');
    expect(apiUrl('/api/users/me/photo?v=1')).toBe('https://api.ewbbank.net/api/users/me/photo?v=1');
  });

  it('turns a network failure into a friendly ApiError, never a raw "Failed to fetch"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { api, ApiError, isNetworkError } = await import('../lib/api.js');
    const err = await api.get('/api/accounts').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isNetworkError(err)).toBe(true);
    expect(err.message).toMatch(/couldn’t reach EWB Bank/);
    expect(err.message).not.toMatch(/fetch/i);
  });

  it('times out slow requests with a clear message', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const { api } = await import('../lib/api.js');
    const p = api.get('/api/accounts').catch((e) => e);
    await vi.advanceTimersByTimeAsync(21_000);
    const err = await p;
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toMatch(/took too long/);
  });

  it('server errors that return HTML (host 502/504) still produce a readable message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const { api } = await import('../lib/api.js');
    const err = await api.get('/api/accounts').catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/temporarily unavailable/);
  });

  it('a failed write is never reported as success: the promise rejects and carries the server message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient available balance.' } }));
    const { api } = await import('../lib/api.js');
    await expect(api.post('/api/transactions/transfers', { amount: '5' })).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_FUNDS', message: 'Insufficient available balance.' });
  });
});

describe('customer-facing content', () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === 'test' ? [] : walk(p)) : /\.(jsx?|html)$/.test(n) ? [p] : []; });
  const files = walk(src).map((f) => [path.relative(src, f), readFileSync(f, 'utf8')]);

  it('contains no development placeholders or unnecessarily negative copy', () => {
    const banned = /\bdemo\b|not a real bank|this is only a|internal software ledger|software project|test environment|lorem ipsum|coming soon/i;
    const markers = /\bTODO\b|\bFIXME\b/; // case-sensitive: a CSS class such as "check-todo" is fine
    for (const [f, text] of files) {
      const visible = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(visible, `${f} contains unfinished or negative wording`).not.toMatch(banned);
      expect(visible, `${f} contains a TODO/FIXME marker`).not.toMatch(markers);
    }
  });

  it('uses "balance" and "account" instead of "ledger" in customer-facing screens', () => {
    for (const [f, text] of files) {
      if (/pages[\\/]admin|layouts[\\/]Layouts|App\.jsx|TransactionRow/.test(f)) continue; // staff console and routing keep internal names
      const visible = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/hasLedgerEntries/g, '');
      expect(visible, `${f} shows internal accounting terminology to customers`).not.toMatch(/ledger/i);
    }
  });

  it('never claims a licence, regulator, deposit insurance or partnership that does not exist', () => {
    const unsupported = /\bFDIC\b|licensed by|regulated by|authori[sz]ed by|member of|deposits? (are|is) (fully )?insured|(?<!not )insured by|in partnership with [A-Z]|East West/;
    for (const [f, text] of files) {
      const visible = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(visible, `${f} makes an unsupported claim`).not.toMatch(unsupported);
    }
  });

  it('keeps the required disclosure, stated factually and in one place', async () => {
    const { DISCLOSURE } = await import('../lib/disclosures.js');
    expect(DISCLOSURE).toMatch(/does not currently hold a banking licence/);
    expect(DISCLOSURE).toMatch(/not insured deposits/);
    expect(DISCLOSURE).toMatch(/when they become available/); // future partner is described as future, not as done
    const layouts = files.find(([f]) => f.endsWith('Layouts.jsx'))[1];
    expect(layouts).toContain('{DISCLOSURE}');
    const terms = files.find(([f]) => f.endsWith('legalDefaults.js'))[1]; // built-in Terms text (also served by the API)
    expect(terms).toMatch(/not deposits with a bank|does not currently hold a banking licence/);
  });

  it('withdrawal copy still states that nothing was sent', () => {
    const money = files.find(([f]) => f.endsWith('Money.jsx'))[1];
    expect(money).toMatch(/does not itself move funds/);
    expect(money).not.toMatch(/contact (EWB Bank )?Customer Support/i); // no blanket customer-care instruction
  });
});
