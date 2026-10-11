import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, fund, PASSWORD, PIN } from './helpers.js';
import config from '../src/config/index.js';
import { pinProblem } from '../src/services/pinService.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const signedIn = async (opts) => { const cust = await makeCustomer(opts); const c = client(app); assert.equal((await login(c, cust.email)).status, 200); return { cust, c }; };
const setTransfers = (on) => db.query("INSERT INTO app_settings (key, value) VALUES ('transfers.enabled', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify({ enabled: on })]);

describe('six-digit session PIN', () => {
  test('a customer without a PIN is held at setup: banking endpoints refuse, setup endpoints work', async () => {
    const { c } = await signedIn({ over: { noPin: true } });
    const me = (await c.get('/api/users/me')).body.user;
    assert.equal(me.pinSet, false);
    for (const url of ['/api/accounts', '/api/transactions']) {
      const r = await c.get(url);
      assert.equal(r.status, 403, url);
      assert.equal(r.body.error.code, 'PIN_SETUP_REQUIRED');
    }
    assert.equal((await c.get('/api/security/overview')).status, 200);
  });

  test('PIN rules are enforced on the server: exactly six digits and no obvious patterns', async () => {
    const { c } = await signedIn({ over: { noPin: true } });
    for (const pin of ['12345', '1234567', 'abcdef', '12 345', '000000', '123456', '654321', '121212', '123123', '']) {
      const r = await c.post('/api/security/pin', { pin, password: PASSWORD });
      assert.equal(r.status, 422, JSON.stringify(pin));
    }
    assert.equal((await c.post('/api/security/pin', { pin: '482915', password: 'Wrong-password-1!' })).status, 422);
    assert.equal(pinProblem('482915'), null);
  });

  test('setting a PIN needs the password, stores only a keyed hash, never returns it, and opens banking', async () => {
    const { cust, c } = await signedIn({ over: { noPin: true } });
    const r = await c.post('/api/security/pin', { pin: '739204', password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { pinSet: true });
    const row = (await db.query('SELECT session_pin_hash FROM users WHERE id=$1', [cust.user.id])).rows[0];
    assert.match(row.session_pin_hash, /^\$argon2id\$/);
    assert.equal(row.session_pin_hash.includes('739204'), false);
    for (const url of ['/api/users/me', '/api/security/overview', '/api/auth/session']) assert.equal(JSON.stringify((await c.get(url)).body).includes('argon2'), false, `${url} must not expose the hash`);
    assert.equal((await c.get('/api/users/me')).body.user.pinSet, true);
    assert.equal((await c.get('/api/accounts')).status, 200);
    assert.ok((await db.query("SELECT 1 FROM audit_logs WHERE action='pin.set' AND actor_id=$1", [cust.user.id])).rows[0]);
  });

  test('locked sessions unlock with the right PIN, stay locked on a wrong one, and the server delays then ends the session', async () => {
    const { c, cust } = await signedIn();
    await c.post('/api/auth/lock', {});
    assert.equal((await c.get('/api/accounts')).status, 403);
    const bad = await c.post('/api/auth/unlock', { pin: '111222' });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.details.pin);
    assert.equal((await c.get('/api/accounts')).status, 403);
    assert.equal((await c.post('/api/auth/unlock', { pin: '12ab56' })).status, 422, 'malformed PIN is rejected before any check');
    const ok = await c.post('/api/auth/unlock', { pin: PIN });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await c.get('/api/accounts')).status, 200);

    // progressive delay and session end
    await c.post('/api/auth/lock', {});
    await c.post('/api/auth/unlock', { pin: '111222' }); await c.post('/api/auth/unlock', { pin: '111223' });
    const third = await c.post('/api/auth/unlock', { pin: '111224' });
    assert.equal(third.status, 422);
    const delayed = await c.post('/api/auth/unlock', { pin: PIN });
    assert.equal(delayed.status, 429, 'even the right PIN waits out the delay');
    assert.match(delayed.body.error.message, /seconds/);
    await db.query('UPDATE users SET pin_locked_until=NULL WHERE id=$1', [cust.user.id]);
    await c.post('/api/auth/unlock', { pin: '111225' });
    await db.query('UPDATE users SET pin_locked_until=NULL WHERE id=$1', [cust.user.id]);
    const last = await c.post('/api/auth/unlock', { pin: '111226' });
    assert.equal(last.status, 401);
    assert.equal(last.body.error.code, 'SESSION_ENDED');
    assert.equal((await c.get('/api/auth/session')).body.authenticated, false);
    // a PIN never signs anyone in: a brand-new browser with the right PIN and no session gets nothing
    const fresh = client(app);
    assert.equal((await fresh.post('/api/auth/unlock', { pin: PIN })).status, 401);
  });

  test('forgotten PIN: the password plus a NEW PIN is the only recovery; the password alone never unlocks a customer', async () => {
    const { c } = await signedIn();
    await c.post('/api/auth/lock', {});
    assert.equal((await c.post('/api/auth/unlock', { password: PASSWORD })).status, 422, 'password without a new PIN is refused');
    assert.equal((await c.post('/api/auth/unlock', { password: 'Wrong-password-1!', newPin: '580417' })).status, 422);
    assert.equal((await c.post('/api/auth/unlock', { password: PASSWORD, newPin: '111111' })).status, 422, 'weak new PIN refused');
    const ok = await c.post('/api/auth/unlock', { password: PASSWORD, newPin: '580417' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    await c.post('/api/auth/lock', {});
    assert.equal((await c.post('/api/auth/unlock', { pin: PIN })).status, 422, 'old PIN no longer works');
    assert.equal((await c.post('/api/auth/unlock', { pin: '580417' })).status, 200);
  });

  test('passkey unlock can be turned off in settings and is then refused by the server', async () => {
    const { c } = await signedIn();
    assert.equal((await c.patch('/api/security/unlock-methods', { passkey: false })).body.unlockPasskeyEnabled, false);
    await c.post('/api/auth/lock', {});
    assert.equal((await c.post('/api/auth/unlock/passkey/options', {})).status, 403);
    assert.equal((await c.get('/api/auth/session')).body.lock.passkeyAvailable, false);
    assert.equal((await c.post('/api/auth/unlock', { pin: PIN })).status, 200);
  });

  test('server-side inactivity: a session with no activity heartbeat past the limit is locked by the server alone', async () => {
    const { c, cust } = await signedIn();
    assert.equal((await c.get('/api/accounts')).status, 200);
    await db.query("UPDATE sessions SET activity_at = now() - make_interval(secs => $2::int) WHERE user_id=$1 AND revoked_at IS NULL", [cust.user.id, config.auth.idleLockSeconds + config.auth.idleGraceSeconds + 5]);
    const r = await c.get('/api/accounts');
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SESSION_LOCKED');
    assert.equal((await c.post('/api/auth/unlock', { pin: PIN })).status, 200);
    assert.equal((await c.get('/api/accounts')).status, 200);
    // activity heartbeats keep it open
    await c.post('/api/auth/back', {});
    assert.equal((await c.get('/api/accounts')).status, 200);
  });

  test('staff are not asked for a PIN and still unlock with password and authenticator code', async () => {
    const staff = await makeStaff('support_agent'); const c = await loginStaff(app, staff);
    assert.equal((await c.get('/api/admin/dashboard')).status, 200);
    await c.post('/api/auth/lock', {});
    assert.equal((await c.post('/api/auth/unlock', { pin: PIN })).status, 403);
    assert.equal((await c.post('/api/auth/unlock', { password: PASSWORD, code: await freshCode(staff) })).status, 200);
  });
});

describe('transfer maintenance and retired withdrawal requests', () => {
  const body = (fromAccountId, to) => ({ fromAccountId, toAccountNumber: to, amount: '10.00', description: 'Test', idempotencyKey: `t-${Date.now()}-${Math.random()}` });

  test('while transfers are in maintenance nothing is debited or recorded, and the answer carries the support address that is configured', async () => {
    const a = await makeCustomer({ verified: true }); const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const c = client(app); await login(c, a.email);
    await setTransfers(false);
    try {
      const before = (await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [a.accountId])).rows[0].n;
      const r = await c.post('/api/transactions/transfers', body(a.accountId, b.accountNumber));
      assert.equal(r.status, 503, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'TRANSFERS_UNAVAILABLE');
      assert.match(r.body.error.message, /unavailable while we carry out maintenance/i);
      assert.match(r.body.error.message, /customer support/i);
      assert.ok('supportEmail' in r.body.error.details);
      assert.equal(JSON.stringify(r.body).includes(a.accountNumber), false, 'no account data in the error');
      assert.equal((await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [a.accountId])).rows[0].n, before);
      assert.equal((await db.query('SELECT count(*)::int n FROM ledger_entries WHERE account_id=$1 AND entry_type=$2', [a.accountId, 'transfer_out'])).rows[0].n, 0);
      const ext = await c.post('/api/transactions/external-transfers', { fromAccountId: a.accountId, bankName: 'Other Bank', accountName: 'A B', accountNumber: '0123456789', amount: '5.00' });
      assert.equal(ext.status, 503);
      assert.equal(ext.body.error.code, 'TRANSFERS_UNAVAILABLE');
      assert.equal((await c.get('/api/features')).body.transfers.enabled, false);
    } finally { await setTransfers(true); }
  });

  test('with maintenance off, To EWB works and To Bank honestly reports that no external rail exists (nothing is recorded)', async () => {
    const a = await makeCustomer({ verified: true }); const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const c = client(app); await login(c, a.email);
    assert.equal((await c.post('/api/transactions/transfers', body(a.accountId, b.accountNumber))).status, 201);
    const n = (await db.query('SELECT count(*)::int n FROM transactions')).rows[0].n;
    const ext = await c.post('/api/transactions/external-transfers', { fromAccountId: a.accountId, bankName: 'Other Bank', accountName: 'A B', accountNumber: '0123456789', amount: '5.00' });
    assert.equal(ext.status, 501);
    assert.equal(ext.body.error.code, 'PROVIDER_NOT_CONFIGURED');
    assert.equal((await db.query('SELECT count(*)::int n FROM transactions')).rows[0].n, n);
    assert.equal((await c.post('/api/transactions/external-transfers', { fromAccountId: a.accountId, bankName: 'x', accountNumber: 'abc', amount: '-1' })).status, 422);
  });

  test('only a Super Admin can switch transfers on or off, and it is audited', async () => {
    const cust = await makeCustomer(); const cc = client(app); await login(cc, cust.email);
    assert.equal((await cc.put('/api/admin/features/transfers', { enabled: false, reason: 'trying it out' })).status, 403);
    const support = await loginStaff(app, await makeStaff('support_agent'));
    assert.equal((await support.put('/api/admin/features/transfers', { enabled: false, reason: 'not allowed' })).status, 403);
    const sa = await makeStaff('super_admin'); const admin = await loginStaff(app, sa);
    assert.equal((await admin.put('/api/admin/features/nonsense', { enabled: true, reason: 'abcde' })).status, 422);
    try {
      const off = await admin.put('/api/admin/features/transfers', { enabled: false, reason: 'Scheduled maintenance window' });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.equal((await cc.get('/api/features')).body.transfers.enabled, false, 'no redeploy needed');
      assert.ok((await db.query("SELECT 1 FROM audit_logs WHERE action='feature.transfers_disable' AND actor_id=$1", [sa.user.id])).rows[0]);
    } finally { await admin.put('/api/admin/features/transfers', { enabled: true, reason: 'Maintenance finished' }); }
  });

  test('customers cannot create withdrawal requests any more; history and the staff workflow remain', async () => {
    const a = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const c = client(app); await login(c, a.email);
    const body2 = { accountId: a.accountId, amount: '20.00', bankName: 'Example Bank', accountName: 'Casey Doe', last4: '4321' };
    const flag = config.features.withdrawalRequests;
    config.features.withdrawalRequests = false;
    try {
      const r = await c.post('/api/withdrawals', body2);
      assert.equal(r.status, 410);
      assert.equal(r.body.error.code, 'WITHDRAWALS_RETIRED');
      assert.equal((await db.query('SELECT count(*)::int n FROM withdrawal_requests WHERE user_id=$1', [a.user.id])).rows[0].n, 0);
    } finally { config.features.withdrawalRequests = flag; }
    assert.equal((await c.get('/api/withdrawals')).status, 200, 'history is still readable');
  });
});
