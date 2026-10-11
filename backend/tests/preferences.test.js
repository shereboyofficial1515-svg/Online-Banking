import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, fund } from './helpers.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

describe('display, accessibility and regional preferences', () => {
  test('defaults, partial updates and persistence (a new session sees the saved values)', async () => {
    const cust = await makeCustomer();
    const c = client(app); await login(c, cust.email);
    const d = await c.get('/api/users/me/preferences');
    assert.equal(d.status, 200);
    assert.deepEqual({ t: d.body.preferences.theme, l: d.body.preferences.language, s: d.body.preferences.textSize }, { t: 'system', l: 'en', s: 'default' });

    const r = await c.put('/api/users/me/preferences', { theme: 'dark', textSize: 'large', motion: 'reduce', contrast: 'high', timezone: 'Africa/Lagos', dateFormat: 'dmy', timeFormat: '24h', numberFormat: 'de-DE', currencyDisplay: 'code', dashboard: { showChart: false } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.preferences.theme, 'dark');
    assert.equal(r.body.preferences.dashboard.showChart, false);
    assert.equal(r.body.preferences.dashboard.showRecent, true, 'unspecified dashboard options keep their value');

    const c2 = client(app); await login(c2, cust.email);
    const again = (await c2.get('/api/users/me/preferences')).body.preferences;
    assert.deepEqual([again.theme, again.textSize, again.motion, again.contrast, again.timezone, again.dateFormat, again.timeFormat, again.numberFormat, again.currencyDisplay], ['dark', 'large', 'reduce', 'high', 'Africa/Lagos', 'dmy', '24h', 'de-DE', 'code']);

    const partial = await c2.put('/api/users/me/preferences', { theme: 'light' });
    assert.equal(partial.body.preferences.theme, 'light');
    assert.equal(partial.body.preferences.textSize, 'large', 'a partial update does not reset other settings');
  });

  test('invalid values are rejected by the server (enums, timezone, language)', async () => {
    const cust = await makeCustomer();
    const c = client(app); await login(c, cust.email);
    for (const bad of [{ theme: 'neon' }, { textSize: 'huge' }, { dateFormat: 'weird' }, { numberFormat: 'xx-XX' }, { motion: 'full' }, { timezone: 'Mars/Olympus' }, { language: 'fr' }, { language: 'english' }, { dashboard: { showChart: 'yes' } }]) {
      const r = await c.put('/api/users/me/preferences', bad);
      assert.equal(r.status, 422, `should reject ${JSON.stringify(bad)}`);
    }
    assert.equal((await c.get('/api/users/me/preferences')).body.preferences.theme, 'system', 'nothing was saved');
  });

  test('a customer can only choose one of their own accounts as the dashboard default', async () => {
    const a = await makeCustomer(); const b = await makeCustomer();
    const c = client(app); await login(c, a.email);
    const bad = await c.put('/api/users/me/preferences', { dashboard: { defaultAccountId: b.accountId } });
    assert.equal(bad.status, 422);
    const ok = await c.put('/api/users/me/preferences', { dashboard: { defaultAccountId: a.accountId } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.preferences.dashboard.defaultAccountId, a.accountId);
  });

  test('preferences are per user and require authentication', async () => {
    const a = await makeCustomer(); const b = await makeCustomer();
    const ca = client(app); await login(ca, a.email);
    const cb = client(app); await login(cb, b.email);
    await ca.put('/api/users/me/preferences', { theme: 'dark' });
    assert.equal((await cb.get('/api/users/me/preferences')).body.preferences.theme, 'system');
    assert.equal((await client(app).get('/api/users/me/preferences')).status, 401);
    assert.equal((await client(app).put('/api/users/me/preferences', { theme: 'dark' })).status, 401);
    // the body cannot name another user
    await ca.put('/api/users/me/preferences', { theme: 'light', userId: b.user.id, user_id: b.user.id });
    assert.equal((await cb.get('/api/users/me/preferences')).body.preferences.theme, 'system');
  });

  test('staff can set a theme too', async () => {
    const staff = await makeStaff('support_agent');
    const c = await loginStaff(app, staff);
    assert.equal((await c.put('/api/users/me/preferences', { theme: 'dark' })).body.preferences.theme, 'dark');
  });

  test('display preferences never change money: currency and balances are untouched', async () => {
    const cust = await makeCustomer({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const c = client(app); await login(c, cust.email);
    const before = (await c.get(`/api/accounts/${cust.accountId}`)).body.account;
    await c.put('/api/users/me/preferences', { currencyDisplay: 'code', numberFormat: 'fr-FR', timezone: 'Asia/Tokyo' });
    const after = (await c.get(`/api/accounts/${cust.accountId}`)).body.account;
    assert.deepEqual(after, before);
    assert.equal(after.currency, 'USD');
    assert.equal(after.balance, 10000);
  });
});
