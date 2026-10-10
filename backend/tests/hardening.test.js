// Adversarial checks added by the security audit (Engineering Task 01). Each test states the attack it simulates.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, fund, latestEmail, uniqueEmail, PASSWORD } from './helpers.js';
import * as L from '../src/repositories/ledger.js';
import config from '../src/config/index.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const wd = (accountId, over = {}) => ({ accountId, amount: '60.00', bankName: 'Example Bank', accountName: 'Casey Doe', last4: '4321', ...over });

describe('duplicate and concurrent financial requests', () => {
  test('double-submitting a withdrawal form (same idempotency key) creates ONE request and one hold', async () => {
    const cust = await makeCustomer({ verified: true });
    await fund(app, db, cust.accountId, '500');
    const c = client(app); await login(c, cust.email);
    const body = wd(cust.accountId, { amount: '100', idempotencyKey: 'form-submit-0001' });
    const [a, b] = await Promise.all([c.post('/api/withdrawals', body), c.post('/api/withdrawals', body)]);
    assert.ok([a.status, b.status].every((s) => s === 202 || s === 409), `unexpected statuses ${a.status}/${b.status}`);
    const n = (await db.query('SELECT count(*)::bigint n FROM withdrawal_requests WHERE user_id=$1', [cust.user.id])).rows[0].n;
    assert.equal(n, 1, 'duplicate submission must not create a second request');
    assert.equal((await L.balances(db, cust.accountId)).held, 10000);
    const again = await c.post('/api/withdrawals', body);
    assert.equal(again.status, 202);
    assert.equal(again.body.withdrawal.id, (await db.query('SELECT id FROM withdrawal_requests WHERE user_id=$1', [cust.user.id])).rows[0].id, 'replay returns the original request');
  });

  test('parallel withdrawal requests cannot hold more than the available balance', async () => {
    const cust = await makeCustomer({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const c = client(app); await login(c, cust.email);
    const rs = await Promise.all([1, 2, 3, 4].map((i) => c.post('/api/withdrawals', wd(cust.accountId, { amount: '60', idempotencyKey: `race-wd-${i}-abcdef` }))));
    assert.equal(rs.filter((r) => r.status === 202).length, 1);
    const b = await L.balances(db, cust.accountId);
    assert.equal(b.held, 6000);
    assert.ok(b.available >= 0);
  });

  test('two staff approving the same request at once: exactly one decision is recorded', async () => {
    const cust = await makeCustomer({ verified: true });
    await fund(app, db, cust.accountId, '300');
    const cc = client(app); await login(cc, cust.email);
    const w = await cc.post('/api/withdrawals', wd(cust.accountId, { amount: '50', idempotencyKey: 'approve-race-0001' }));
    const f1 = await makeStaff('finance_operator'); const f2 = await makeStaff('finance_operator');
    const c1 = await loginStaff(app, f1); const c2 = await loginStaff(app, f2);
    const act = (c, f) => freshCode(f).then((mfaCode) => c.post(`/api/admin/withdrawals/${w.body.withdrawal.id}/actions`, { action: 'approve', reason: 'Concurrent approval test', mfaCode }));
    const rs = await Promise.all([act(c1, f1), act(c2, f2)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await db.query("SELECT count(*)::bigint n FROM audit_logs WHERE action='withdrawal.approve' AND target_id=$1", [w.body.withdrawal.id])).rows[0].n, 1);
  });

  test('the same ledger-credit idempotency key raced in parallel credits exactly once', async () => {
    // Service level on purpose: through HTTP each request needs its own single-use MFA code, which is a separate control.
    const { adjust } = await import('../src/services/ledgerService.js');
    const cust = await makeCustomer();
    const finance = await makeStaff('finance_operator');
    const ctx = () => ({ actor: { id: finance.user.id, role: 'finance_operator' }, ip: '127.0.0.1', userAgent: 'test', sessionId: null, deviceId: null });
    const input = { accountId: cust.accountId, direction: 'credit', amountMinor: 1000, currency: 'USD', reason: 'Parallel idempotency check', idempotencyKey: 'parallel-key-0001' };
    const results = await Promise.allSettled([adjust(ctx(), input), adjust(ctx(), input), adjust(ctx(), input)]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal((await L.balances(db, cust.accountId)).ledger, 1000, 'credited once, never more');
    assert.equal((await db.query('SELECT count(*)::bigint n FROM transactions WHERE account_id=$1', [cust.accountId])).rows[0].n, 1);
    assert.equal((await L.verifyIntegrity(db, cust.accountId)).ok, true);
  });
});

describe('abuse resistance', () => {
  test('password-reset and verification emails cannot be used to flood a victim\'s inbox', async () => {
    const victim = await makeCustomer();
    const c = client(app);
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/forgot-password', { email: victim.email })).status, 202);
    const n = (await db.query("SELECT count(*)::bigint n FROM email_outbox WHERE to_email=$1 AND template='password_reset'", [victim.email])).rows[0].n;
    assert.equal(n, 1, 'only one reset email per cooldown window');
    // the owner can still reset using that single email
    assert.ok(await latestEmail(db, victim.email, 'password_reset'));
  });

  test('CORS: only configured origins are echoed; credentials allowed only for them', async () => {
    const allowed = config.corsOrigins[0];
    const ok = await client(app).agent.get('/api/health').set('Origin', allowed);
    assert.equal(ok.headers['access-control-allow-origin'], allowed);
    assert.equal(ok.headers['access-control-allow-credentials'], 'true');
    const evil = await client(app).agent.get('/api/health').set('Origin', 'https://evil.example');
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    const pre = await client(app).agent.options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
    const wild = await client(app).agent.get('/api/health').set('Origin', 'null');
    assert.equal(wild.headers['access-control-allow-origin'], undefined);
  });

  test('state-changing requests with a forged Origin are rejected even with a valid CSRF token', async () => {
    const cust = await makeCustomer({ verified: true });
    const c = client(app); await login(c, cust.email);
    const r = await c.post('/api/withdrawals', wd(cust.accountId, { idempotencyKey: 'csrf-origin-test-1' }), { Origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'CSRF_ORIGIN');
  });

  test('unauthenticated health endpoints reveal no environment details', async () => {
    for (const url of ['/api/health', '/api/health/live']) {
      const r = await client(app).get(url);
      assert.equal(r.status, 200, url);
      assert.deepEqual(Object.keys(r.body).sort(), url.endsWith('live') ? ['status'] : ['ledgerMode', 'status']);
    }
  });

  test('verification-email resend is also throttled per address', async () => {
    const email = uniqueEmail('unv');
    const reg = client(app);
    const { registrationBody } = await import('./helpers.js');
    await reg.post('/api/auth/register', registrationBody({ email }));
    for (let i = 0; i < 4; i++) await reg.post('/api/auth/resend-verification', { email });
    const n = (await db.query("SELECT count(*)::bigint n FROM email_outbox WHERE to_email=$1 AND template='email_verification'", [email])).rows[0].n;
    assert.equal(n, 1, 'registration already sent one; resends inside the cooldown are suppressed');
  });
});
