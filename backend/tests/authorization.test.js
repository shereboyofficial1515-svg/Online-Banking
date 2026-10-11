// The "never allowed" matrix: what a normal user (or the wrong staff role) must NEVER be able to do.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, fund, registrationBody, PASSWORD, latestEmail, tokenFromEmail } from './helpers.js';
import * as L from '../src/repositories/ledger.js';
import config from '../src/config/index.js';

let app; let db; let alice; let bob; let ac; let bc;
before(async () => {
  ({ app, db } = await boot());
  alice = await makeCustomer({ verified: true });
  bob = await makeCustomer({ verified: true });
  await fund(app, db, alice.accountId, '500');
  await fund(app, db, bob.accountId, '500');
  ac = client(app); await login(ac, alice.email);
  bc = client(app); await login(bc, bob.email);
});
after(shutdown);

describe('unauthenticated access', () => {
  const protectedGets = ['/api/auth/me', '/api/users/me', '/api/accounts', '/api/transactions', '/api/withdrawals', '/api/notifications', '/api/support', '/api/security/overview', '/api/verification/status', '/api/admin/dashboard', '/api/admin/customers', '/api/audit', '/api/ledger/accounts/00000000-0000-4000-8000-000000000000'];
  for (const url of protectedGets) {
    test(`GET ${url} -> 401`, async () => assert.equal((await client(app).get(url)).status, 401));
  }
  test('mutating endpoints -> 401 (with valid CSRF)', async () => {
    const c = client(app);
    for (const [url, body] of [['/api/ledger/adjustments', {}], ['/api/transactions/transfers', {}], ['/api/withdrawals', {}], ['/api/admin/staff', {}]]) {
      assert.equal((await c.post(url, body)).status, 401, url);
    }
  });
});

describe('a normal user can never...', () => {
  test('access admin, ledger-staff or audit APIs', async () => {
    for (const url of ['/api/admin/dashboard', '/api/admin/customers', `/api/admin/customers/${bob.user.id}`, '/api/admin/withdrawals', '/api/admin/security-events', '/api/admin/staff', '/api/audit', `/api/ledger/accounts/${alice.accountId}`]) {
      assert.equal((await ac.get(url)).status, 403, url);
    }
    for (const [url, body] of [
      ['/api/ledger/adjustments', { accountId: alice.accountId, direction: 'credit', amount: '1000000', currency: 'USD', reason: 'I would like more money', mfaCode: '123456', idempotencyKey: 'hack-attempt-1' }],
      ['/api/ledger/reversals', { transactionId: alice.accountId, reason: 'reverse everything', mfaCode: '123456' }],
      [`/api/admin/customers/${bob.user.id}/actions`, { action: 'lock', reason: 'because i can' }],
      ['/api/admin/staff', { email: 'x@example.test', firstName: 'X', lastName: 'Y', role: 'super_admin' }],
    ]) assert.equal((await ac.post(url, body)).status, 403, url);
    assert.equal((await L.balances(db, alice.accountId)).ledger, 50000);
  });

  test('modify their balance or role through any user-facing endpoint', async () => {
    const before = await db.query('SELECT role, status, verification_status, email_verified_at FROM users WHERE id=$1', [alice.user.id]);
    const patch = await ac.patch('/api/users/me', { phone: '+2348031230000', currentPassword: PASSWORD, role: 'super_admin', status: 'active', verificationStatus: 'verified', balance: 999999, mfaEnabled: false });
    assert.equal(patch.status, 200);
    const after = await db.query('SELECT role, status, verification_status, email_verified_at FROM users WHERE id=$1', [alice.user.id]);
    assert.deepEqual(after.rows[0], before.rows[0]);
    assert.equal(patch.body.user.role, 'customer');
    // no endpoint exists to write an account or ledger row directly
    // the only account PATCH is a rename: anything else is rejected and nothing changes
    assert.equal((await ac.patch(`/api/accounts/${alice.accountId}`, { balance: 1e9 })).status, 422);
    assert.equal((await ac.patch(`/api/accounts/${alice.accountId}`, { name: 'Renamed', balance: 1e9, status: 'closed' })).status, 200);
    assert.equal((await db.query('SELECT status FROM accounts WHERE id=$1', [alice.accountId])).rows[0].status, 'active');
    assert.equal((await L.balances(db, alice.accountId)).ledger, 50000);
    assert.equal((await ac.put(`/api/accounts/${alice.accountId}`, { balance: 1e9 })).status, 404);
    assert.equal((await ac.post('/api/transactions', { amount: '100', type: 'ledger_credit' })).status, 404);
    const acct = await ac.post('/api/accounts', { type: 'checking', balance: 1e9, status: 'active', currency: 'EUR' });
    assert.ok([201, 409].includes(acct.status));
    assert.equal((await L.balances(db, alice.accountId)).ledger, 50000);
  });

  test('self-register as staff via mass assignment', async () => {
    const body = registrationBody({ role: 'super_admin', status: 'active', emailVerifiedAt: '2020-01-01', verificationStatus: 'verified' });
    const c = client(app);
    assert.equal((await c.post('/api/auth/register', body)).status, 202);
    const u = (await db.query('SELECT role, email_verified_at, verification_status FROM users WHERE email=$1', [body.email])).rows[0];
    assert.equal(u.role, 'customer');
    assert.equal(u.email_verified_at, null);
    assert.equal(u.verification_status, 'not_started');
  });

  test('read or touch another user\'s accounts, transactions, withdrawals or tickets', async () => {
    const bobTx = (await bc.get('/api/transactions')).body.items[0];
    assert.ok(bobTx);
    assert.equal((await ac.get(`/api/accounts/${bob.accountId}`)).status, 404);
    assert.equal((await ac.get(`/api/accounts/${bob.accountId}/summary`)).status, 404);
    assert.equal((await ac.get(`/api/transactions/${bobTx.id}`)).status, 404);
    assert.equal((await ac.get(`/api/transactions?accountId=${bob.accountId}`)).body.items.length, 0);

    const w = await bc.post('/api/withdrawals', { accountId: bob.accountId, amount: '5', bankName: 'Example Bank', accountName: 'Bob', last4: '1111' });
    assert.equal((await ac.get(`/api/withdrawals/${w.body.withdrawal.id}`)).status, 404);
    assert.equal((await ac.post(`/api/withdrawals/${w.body.withdrawal.id}/cancel`)).status, 404);

    const t = await bc.post('/api/support', { category: 'account', subject: 'Private matter', message: 'Some private details here' });
    assert.equal((await ac.get(`/api/support/${t.body.ticket.id}`)).status, 404);
    assert.equal((await ac.post(`/api/support/${t.body.ticket.id}/replies`, { message: 'hijack attempt' })).status, 404);
    assert.equal((await ac.post(`/api/support/${t.body.ticket.id}/close`)).status, 404);

    const n = (await bc.get('/api/notifications')).body.items[0];
    assert.equal((await ac.post(`/api/notifications/${n.id}/read`)).status, 404);
    // revoking someone else's session or passkey
    const bobSessions = (await bc.get('/api/security/overview')).body.sessions;
    assert.equal((await ac.delete(`/api/security/sessions/${bobSessions[0].id}`)).status, 404);
    assert.equal((await bc.get('/api/auth/me')).status, 200, 'bob unaffected');
  });

  test('approve their own withdrawal or mark a transaction completed', async () => {
    const w = await ac.post('/api/withdrawals', { accountId: alice.accountId, amount: '5', bankName: 'Example Bank', accountName: 'Alice', last4: '2222' });
    for (const action of ['approve', 'reject', 'start_review']) {
      assert.equal((await ac.post(`/api/admin/withdrawals/${w.body.withdrawal.id}/actions`, { action, reason: 'self approval', mfaCode: '123456' })).status, 403);
    }
    assert.equal((await ac.post(`/api/withdrawals/${w.body.withdrawal.id}`, { status: 'approved' })).status, 404);
    assert.equal((await ac.patch(`/api/withdrawals/${w.body.withdrawal.id}`, { status: 'approved' })).status, 404);
    const row = (await db.query('SELECT status FROM withdrawal_requests WHERE id=$1', [w.body.withdrawal.id])).rows[0];
    assert.equal(row.status, 'requested');
    const txid = (await db.query('SELECT transaction_id FROM withdrawal_requests WHERE id=$1', [w.body.withdrawal.id])).rows[0].transaction_id;
    assert.equal((await ac.patch(`/api/transactions/${txid}`, { status: 'completed' })).status, 404);
    // and even raw SQL cannot complete a blocked/pending withdrawal into a ledger movement
    assert.equal((await db.query('SELECT count(*)::bigint n FROM ledger_entries WHERE transaction_id=$1', [txid])).rows[0].n, 0);
  });

  test('bypass identity verification for transfers', async () => {
    const unverified = await makeCustomer({ verified: false });
    await fund(app, db, unverified.accountId, '100');
    const c = client(app);
    await login(c, unverified.email);
    const r = await c.post('/api/transactions/transfers', { fromAccountId: unverified.accountId, toAccountNumber: bob.accountNumber, amount: '1', idempotencyKey: 'bypass-attempt-1' });
    assert.equal(r.status, 403);
    await c.patch('/api/users/me', { verificationStatus: 'verified' });
    assert.equal((await c.post('/api/transactions/transfers', { fromAccountId: unverified.accountId, toAccountNumber: bob.accountNumber, amount: '1', idempotencyKey: 'bypass-attempt-2' })).status, 403);
  });

  test('obtain service-role credentials, secrets or internals from any response', async () => {
    const sensitive = [config.auth.jwtSecret, config.auth.jwtRefreshSecret, 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'service_role', 'password_hash', 'mfa_secret'];
    const responses = [await ac.get('/api/auth/config'), await ac.get('/api/auth/me'), await ac.get('/api/users/me'), await ac.get('/api/security/overview'), await ac.get('/api/auth/nope'), await ac.get('/api/health')];
    for (const r of responses) {
      const text = JSON.stringify(r.body) + JSON.stringify(r.headers);
      for (const s of sensitive) assert.ok(s && !text.includes(s), `response leaked ${s}`);
    }
    assert.equal(config.supabase.serviceRoleKey, '');
  });
});

describe('staff authorization', () => {
  test('staff without MFA enrolment get a limited session that reaches nothing but MFA setup', async () => {
    const staff = await makeStaff('super_admin', { enrolled: false });
    const c = client(app);
    const r = await login(c, staff.email);
    assert.equal(r.status, 200);
    assert.equal(r.body.mfaEnrollmentRequired, true);
    assert.equal((await c.get('/api/auth/me')).status, 200);
    for (const url of ['/api/admin/dashboard', '/api/admin/customers', '/api/audit', '/api/security/overview']) {
      const x = await c.get(url);
      assert.equal(x.status, 403, url);
      assert.equal(x.body.error.code, 'MFA_ENROLLMENT_REQUIRED');
    }
    assert.equal((await c.post('/api/security/mfa/setup')).status, 200);
  });

  test('permission matrix is enforced on the backend for every role', async () => {
    const roles = ['super_admin', 'compliance_admin', 'support_agent', 'finance_operator', 'security_admin'];
    const clients = {};
    for (const r of roles) clients[r] = await loginStaff(app, await makeStaff(r));
    const expectations = [
      // [method, url, allowed roles]
      ['get', '/api/admin/dashboard', roles],
      ['get', '/api/admin/customers', roles],
      ['get', '/api/admin/withdrawals', ['super_admin', 'compliance_admin', 'support_agent', 'finance_operator']],
      ['get', '/api/admin/verification', ['super_admin', 'compliance_admin']],
      ['get', '/api/admin/support', ['super_admin', 'support_agent', 'compliance_admin']],
      ['get', '/api/admin/security-events', ['super_admin', 'security_admin']],
      ['get', '/api/audit', ['super_admin', 'compliance_admin', 'security_admin']],
      ['get', '/api/admin/staff', ['super_admin']],
      ['get', `/api/ledger/accounts/${alice.accountId}`, ['super_admin', 'finance_operator']],
    ];
    for (const [method, url, allowed] of expectations) {
      for (const role of roles) {
        const res = await clients[role][method](url);
        if (allowed.includes(role)) assert.equal(res.status, 200, `${role} should access ${url} (got ${res.status})`);
        else assert.equal(res.status, 403, `${role} must NOT access ${url} (got ${res.status})`);
      }
    }
  });

  test('customer-status actions are gated per action; only Security/Super can lock, only Compliance/Super can approve', async () => {
    const cust = await makeCustomer({ accountActive: false });
    const sec = await loginStaff(app, await makeStaff('security_admin'));
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    const sup = await loginStaff(app, await makeStaff('support_agent'));
    const url = `/api/admin/customers/${cust.user.id}/actions`;
    assert.equal((await sup.post(url, { action: 'lock', reason: 'support agent attempt' })).status, 403);
    assert.equal((await comp.post(url, { action: 'lock', reason: 'compliance attempt' })).status, 403);
    assert.equal((await sec.post(url, { action: 'approve_account', reason: 'security attempt' })).status, 403);
    assert.equal((await comp.post(url, { action: 'approve_account', reason: 'Documents reviewed' })).status, 200);
    assert.equal((await sec.post(url, { action: 'lock', reason: 'Investigating activity' })).status, 200);
    const u = (await db.query('SELECT status FROM users WHERE id=$1', [cust.user.id])).rows[0];
    assert.equal(u.status, 'locked');
    const a = (await db.query('SELECT status FROM accounts WHERE id=$1', [cust.accountId])).rows[0];
    assert.equal(a.status, 'locked');
    const audit = (await db.query("SELECT previous_state, new_state, reason FROM audit_logs WHERE action='customer.lock' AND target_id=$1", [cust.user.id])).rows[0];
    assert.equal(audit.previous_state.userStatus, 'active');
    assert.equal(audit.new_state.userStatus, 'locked');
    assert.equal(audit.reason, 'Investigating activity');
    // locked customer's sessions are dead and sign-in is refused
    const cc = client(app);
    assert.equal((await login(cc, cust.email)).status, 403);
  });

  test('staff cannot use customer-only APIs, cannot modify staff via customer actions, and cannot change their own role', async () => {
    const sa = await makeStaff('super_admin');
    const sc = await loginStaff(app, sa);
    assert.equal((await sc.get('/api/accounts')).status, 403);
    assert.equal((await sc.post('/api/withdrawals', { accountId: alice.accountId, amount: '1', bankName: 'x y', accountName: 'x y', last4: '1234' })).status, 403);
    const other = await makeStaff('support_agent');
    const r = await sc.post(`/api/admin/customers/${other.user.id}/actions`, { action: 'lock', reason: 'trying to lock staff' });
    assert.ok([403, 404].includes(r.status));
    assert.equal((await sc.patch(`/api/admin/staff/${sa.user.id}`, { role: 'support_agent' })).status, 403, 'no self role changes');
  });

  test('super admin can create staff (invite email, no password sent) and role changes revoke that staff member\'s sessions', async () => {
    const sa = await makeStaff('super_admin');
    const sc = await loginStaff(app, sa);
    const email = `new.hire${Date.now()}@example.test`;
    const r = await sc.post('/api/admin/staff', { email, firstName: 'New', lastName: 'Hire', role: 'support_agent' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const mail = await latestEmail(db, email, 'staff_invite');
    assert.ok(mail && /reset-password\?token=/.test(mail.body_html));
    assert.ok(tokenFromEmail(mail).length > 20);
    const target = await makeStaff('support_agent');
    const tc = await loginStaff(app, target);
    assert.equal((await tc.get('/api/admin/support')).status, 200);
    assert.equal((await sc.patch(`/api/admin/staff/${target.user.id}`, { role: 'security_admin' })).status, 200);
    assert.equal((await tc.get('/api/admin/support')).status, 401, 'session revoked on privilege change');
  });
});
