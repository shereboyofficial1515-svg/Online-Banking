import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, PASSWORD, PIN } from './helpers.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const signedIn = async () => { const cust = await makeCustomer(); const c = client(app); assert.equal((await login(c, cust.email)).status, 200); return { cust, c }; };
const sessionId = async (userId) => (await db.query('SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [userId])).rows[0].id;
const ageAway = (id, seconds) => db.query("UPDATE sessions SET away_since = now() - make_interval(secs => $2::int) WHERE id=$1", [id, seconds]);

describe('away tracking and session lock', () => {
  test('returning before the limit does not interrupt the user', async () => {
    const { cust, c } = await signedIn();
    assert.equal((await c.post('/api/auth/away', {})).body.locked, false);
    await ageAway(await sessionId(cust.user.id), 20);
    const back = await c.post('/api/auth/back', {});
    assert.equal(back.body.locked, false);
    assert.equal((await c.get('/api/accounts')).status, 200);
    assert.equal((await db.query('SELECT away_since FROM sessions WHERE id=$1', [await sessionId(cust.user.id)])).rows[0].away_since, null, 'away marker cleared');
  });

  test('after the limit the SERVER refuses protected endpoints, with no help from the browser', async () => {
    const { cust, c } = await signedIn();
    await c.post('/api/auth/away', {});
    await ageAway(await sessionId(cust.user.id), 61);
    for (const url of ['/api/accounts', '/api/users/me', '/api/transactions', '/api/security/overview', '/api/users/me/photo']) {
      const r = await c.get(url);
      assert.equal(r.status, 403, url);
      assert.equal(r.body?.error?.code ?? 'SESSION_LOCKED', 'SESSION_LOCKED');
    }
    const write = await c.post('/api/withdrawals', { accountId: cust.accountId, amount: '5', bankName: 'Example Bank', accountName: 'A B', last4: '1234' });
    assert.equal(write.status, 403);
    assert.equal((await db.query('SELECT count(*)::int n FROM withdrawal_requests WHERE user_id=$1', [cust.user.id])).rows[0].n, 0, 'nothing was created');
  });

  test('the session status endpoint shows the lock screen only minimal details', async () => {
    const { cust, c } = await signedIn();
    await c.post('/api/auth/lock', {});
    const s = (await c.get('/api/auth/session')).body;
    assert.equal(s.authenticated, true);
    assert.equal(s.locked, true);
    assert.equal(s.user, undefined);
    assert.equal(s.permissions, undefined);
    assert.equal(s.lock.firstName, 'Casey');
    assert.doesNotMatch(s.lock.emailHint, new RegExp(cust.email.split('@')[0]));
    assert.equal(JSON.stringify(s).includes(cust.email), false);
  });

  test('a stale or refreshed token cannot get around the lock', async () => {
    const { c } = await signedIn();
    await c.post('/api/auth/lock', {});
    assert.equal((await c.post('/api/auth/refresh', {})).status, 200, 'refresh itself works');
    assert.equal((await c.get('/api/accounts')).status, 403, 'but the new token is still locked');
  });

  test('a wrong PIN keeps it locked; the right PIN restores access and is audited', async () => {
    const { cust, c } = await signedIn();
    await c.post('/api/auth/lock', {});
    const bad = await c.post('/api/auth/unlock', { pin: '111222' });
    assert.equal(bad.status, 422);
    assert.equal((await c.get('/api/accounts')).status, 403);
    const ok = await c.post('/api/auth/unlock', { pin: PIN });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.locked, false);
    assert.equal((await c.get('/api/accounts')).status, 200);
    for (const a of ['session.lock', 'session.unlock_failed', 'session.unlock']) {
      assert.ok((await db.query('SELECT 1 FROM audit_logs WHERE action=$1 AND actor_id=$2', [a, cust.user.id])).rows[0], a);
    }
    assert.equal((await c.post('/api/auth/unlock', { pin: PIN })).body.locked, false, 'unlocking an unlocked session is harmless');
  });

  test('locking and unlocking never run a money action by themselves', async () => {
    const { cust, c } = await signedIn();
    await c.post('/api/auth/lock', {});
    await c.post('/api/auth/unlock', { password: PASSWORD });
    assert.equal((await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [cust.accountId])).rows[0].n, 0);
  });

  test('logout is allowed while locked, and a locked session is not another user\'s problem', async () => {
    const a = await signedIn(); const b = await signedIn();
    await a.c.post('/api/auth/lock', {});
    assert.equal((await b.c.get('/api/accounts')).status, 200, 'other sessions are unaffected');
    assert.equal((await a.c.post('/api/auth/logout', {})).status, 200);
    assert.equal((await a.c.get('/api/auth/session')).body.authenticated, false);
  });

  test('staff need the authenticator code as well to unlock', async () => {
    const staff = await makeStaff('support_agent'); const c = await loginStaff(app, staff);
    await c.post('/api/auth/lock', {});
    assert.equal((await c.get('/api/admin/dashboard')).status, 403);
    assert.equal((await c.post('/api/auth/unlock', { password: PASSWORD })).status, 403, 'password alone is not enough');
    assert.equal((await c.post('/api/auth/unlock', { password: PASSWORD, code: await freshCode(staff) })).status, 200);
    assert.equal((await c.get('/api/admin/dashboard')).status, 200);
  });

  test('passkey unlock refuses a made-up assertion', async () => {
    const { c } = await signedIn();
    await c.post('/api/auth/lock', {});
    assert.equal((await c.post('/api/auth/unlock/passkey/options', {})).status, 400, 'no passkeys registered');
    const fake = { response: { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: 'x', origin: 'https://evil.example', type: 'webauthn.get' })).toString('base64url'), authenticatorData: 'AAAA', signature: 'AAAA' }, clientExtensionResults: {} } };
    const r = await c.post('/api/auth/unlock/passkey/verify', fake);
    assert.ok([400, 401].includes(r.status), String(r.status));
    assert.equal((await c.get('/api/accounts')).status, 403);
  });
});
