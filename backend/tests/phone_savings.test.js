import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, registrationBody, uniquePhone, fund, freshCode } from './helpers.js';
import { normalizePhone } from '../src/utils/phone.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const register = (over) => client(app).post('/api/auth/register', registrationBody(over));

describe('mandatory phone number at registration', () => {
  test('missing or empty phone is rejected', async () => {
    const body = registrationBody(); delete body.phone;
    const r1 = await client(app).post('/api/auth/register', body);
    assert.equal(r1.status, 422);
    assert.ok(r1.body.error.details.phone);
    assert.equal((await register({ phone: '' })).status, 422);
    assert.equal((await register({ phone: '   ' })).status, 422);
  });

  test('malformed, impossible and country-less numbers are rejected (rules are per country, not a digit count)', async () => {
    for (const phone of ['12345', 'abcdefghij', '+234', '+2348031', '+1 555 010 0199', '08031234567', '+999123456789', '+23480312345678901234', '<script>', '+234 803 123 45']) {
      const r = await register({ phone });
      assert.equal(r.status, 422, phone);
      assert.ok(r.body.error.details.phone, phone);
    }
  });

  test('valid numbers from different countries are accepted and stored in E.164', async () => {
    const cases = [['+234 803 123 4567', '+2348031234567', 'NG'], ['+1 (212) 555-0123', '+12125550123', 'US'], ['+44 20 7123 4567', '+442071234567', 'GB'], ['+233 24 123 4567', '+233241234567', 'GH'], ['+91 98765 43210', '+919876543210', 'IN'], ['00 27 82 123 4567', '+27821234567', 'ZA']];
    for (const [input, e164, country] of cases) {
      await db.query('DELETE FROM users WHERE phone_e164=$1', [e164]).catch(() => {});
      const body = registrationBody({ phone: input, phoneCountry: country });
      const r = await client(app).post('/api/auth/register', body);
      assert.equal(r.status, 202, `${input} ${JSON.stringify(r.body)}`);
      const row = (await db.query('SELECT phone, phone_e164, phone_verified_at FROM users WHERE email=$1', [body.email.toLowerCase()])).rows[0];
      assert.equal(row.phone_e164, e164);
      assert.equal(row.phone, e164);
      assert.equal(row.phone_verified_at, null, 'entering a number never marks it verified');
    }
  });

  test('the selected country must match the number', async () => {
    const r = await register({ phone: '+234 803 123 9999', phoneCountry: 'GH' });
    assert.equal(r.status, 422);
    assert.match(r.body.error.details.phone[0], /does not match/i);
  });

  test('a phone number can belong to one profile only (any formatting), and concurrent sign-ups cannot both win', async () => {
    const phone = uniquePhone();
    assert.equal((await register({ phone })).status, 202);
    const dup = await register({ phone: phone.replace('+234803', '+234 803 ') });
    assert.equal(dup.status, 422);
    assert.ok(dup.body.error.details.phone);
    const racing = uniquePhone();
    const results = await Promise.all([register({ phone: racing }), register({ phone: racing }), register({ phone: racing })]);
    assert.equal(results.filter((r) => r.status === 202).length, 1, results.map((r) => r.status).join());
    assert.equal((await db.query('SELECT count(*)::int n FROM users WHERE phone_e164=$1', [racing])).rows[0].n, 1);
  });

  test('the server does not trust the client: a "valid" flag or a pre-normalised value is ignored', async () => {
    const r = await register({ phone: '+2348031234', phoneValid: true, phoneE164: '+2348031234567' });
    assert.equal(r.status, 422);
  });

  test('legacy customers keep their records and are asked to add a valid number; changing it needs the password and a unique valid number', async () => {
    const legacy = await makeCustomer({ over: { phone: '0803 000 0000' } });
    const c = client(app); await login(c, legacy.email);
    const me = (await c.get('/api/users/me')).body.user;
    assert.equal(me.phoneRequired, true);
    assert.equal(me.phoneVerified, false);
    assert.equal((await db.query('SELECT phone FROM users WHERE id=$1', [legacy.user.id])).rows[0].phone, '0803 000 0000', 'original value untouched');
    assert.equal((await c.patch('/api/users/me', { phone: '12345', currentPassword: 'Str0ng!Passw0rd#42' })).status, 422);
    const taken = uniquePhone(); await register({ phone: taken });
    assert.equal((await c.patch('/api/users/me', { phone: taken, currentPassword: 'Str0ng!Passw0rd#42' })).status, 422, 'cannot take another profile\'s number');
    const mine = uniquePhone();
    const ok = await c.patch('/api/users/me', { phone: mine, currentPassword: 'Str0ng!Passw0rd#42' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.phone, mine);
    assert.equal(ok.body.user.phoneRequired, false);
    assert.equal(ok.body.user.phoneVerified, false);
  });

  test('normalizePhone unit checks', () => {
    assert.equal(normalizePhone('+234 (803) 123-4567').e164, '+2348031234567');
    assert.equal(normalizePhone('+1 555 010 0199'), null);
    assert.equal(normalizePhone('08031234567'), null);
    assert.equal(normalizePhone(null), null);
  });
});

describe('savings availability (management controlled)', () => {
  const body = (accountId, to, over = {}) => ({ fromAccountId: accountId, toAccountNumber: to, amount: '10.00', description: 'Save', idempotencyKey: `s-${Date.now()}-${Math.random()}`, ...over });

  test('savings is OFF by default; customers get a structured message and nothing is created', async () => {
    const cust = await makeCustomer({ verified: true }); const c = client(app); await login(c, cust.email);
    assert.equal((await c.get('/api/features')).body.savings.enabled, false);
    const r = await c.post('/api/accounts', { type: 'savings', name: 'Rainy day' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SAVINGS_UNAVAILABLE');
    assert.match(r.body.error.message, /not available at the moment/i);
    assert.equal((await db.query("SELECT count(*)::int n FROM accounts WHERE user_id=$1 AND type='savings'", [cust.user.id])).rows[0].n, 0);
    assert.equal((await c.post('/api/accounts', { type: 'checking', name: 'Second checking' })).status, 201, 'unrelated account opening still works');
  });

  test('transfers to a savings account are refused while off; normal transfers and withdrawals from savings still work', async () => {
    const a = await makeCustomer({ verified: true }); const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const sav = await db.query("INSERT INTO accounts (user_id, kind, account_number, type, name, currency, status) VALUES ($1,'customer',$2,'savings','Existing savings','USD','active') RETURNING *", [a.user.id, `605${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`]);
    const c = client(app); await login(c, a.email);
    const blocked = await c.post('/api/transactions/transfers', body(a.accountId, sav.rows[0].account_number));
    assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error.code, 'SAVINGS_UNAVAILABLE');
    const normal = await c.post('/api/transactions/transfers', body(a.accountId, b.accountNumber));
    assert.equal(normal.status, 201, JSON.stringify(normal.body));
    assert.equal((await db.query('SELECT count(*)::int n FROM accounts WHERE id=$1', [sav.rows[0].id])).rows[0].n, 1, 'existing savings records are untouched');
  });

  test('only management can change it; customers and other staff cannot, and the backend follows the setting at once', async () => {
    const cust = await makeCustomer({ verified: true }); const cc = client(app); await login(cc, cust.email);
    assert.equal((await cc.put('/api/admin/features/savings', { enabled: true, reason: 'let me in please' })).status, 403);
    for (const role of ['support_agent', 'finance_operator', 'compliance_admin', 'security_admin']) {
      const s = await loginStaff(app, await makeStaff(role));
      assert.equal((await s.put('/api/admin/features/savings', { enabled: true, reason: 'not allowed to' })).status, 403, role);
    }
    assert.equal((await cc.get('/api/features')).body.savings.enabled, false);

    const sa = await makeStaff('super_admin'); const admin = await loginStaff(app, sa);
    assert.equal((await admin.put('/api/admin/features/savings', { enabled: true })).status, 422, 'a reason is required');
    const on = await admin.put('/api/admin/features/savings', { enabled: true, reason: 'Savings launch approved' });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.enabled, true);
    assert.equal((await cc.get('/api/features')).body.savings.enabled, true, 'no redeploy needed');
    const open = await cc.post('/api/accounts', { type: 'savings', name: 'Holiday' });
    assert.equal(open.status, 201, JSON.stringify(open.body));

    await fund(app, db, (await db.query("SELECT id FROM accounts WHERE user_id=$1 AND type='checking' LIMIT 1", [cust.user.id])).rows[0].id, '50');
    const dep = await cc.post('/api/transactions/transfers', body(cust.accountId, open.body.account.accountNumber));
    assert.equal(dep.status, 201, JSON.stringify(dep.body));

    const off = await admin.put('/api/admin/features/savings', { enabled: false, reason: 'Pausing for maintenance' });
    assert.equal(off.body.enabled, false);
    assert.equal((await cc.post('/api/accounts', { type: 'savings' })).status, 403);
    assert.equal((await cc.post('/api/transactions/transfers', body(cust.accountId, open.body.account.accountNumber))).status, 403);
    assert.equal((await db.query("SELECT count(*)::int n FROM accounts WHERE id=$1", [open.body.account.id])).rows[0].n, 1, 'disabling never deletes savings records');
    for (const a of ['feature.savings_enable', 'feature.savings_disable']) assert.ok((await db.query('SELECT 1 FROM audit_logs WHERE action=$1 AND actor_id=$2', [a, sa.user.id])).rows[0], a);
  });

  test('registration or any customer request cannot switch savings on', async () => {
    const r = await register({ savingsEnabled: true, features: { savings: true } });
    assert.equal(r.status, 202);
    const cust = await makeCustomer(); const c = client(app); await login(c, cust.email);
    await c.patch('/api/users/me', { savingsEnabled: true });
    await c.put('/api/users/me/preferences', { savings: true });
    assert.equal((await db.query("SELECT count(*)::int n FROM app_settings WHERE key='savings.enabled' AND (value->>'enabled')::boolean AND updated_by IS NULL")).rows[0].n, 0);
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    await admin.put('/api/admin/features/savings', { enabled: false, reason: 'Reset after test' });
  });
});

describe('interface language preference', () => {
  test('every supported language is accepted, saved to the account and restored on the next sign-in; unknown ones are refused', async () => {
    const cust = await makeCustomer(); const c = client(app); await login(c, cust.email);
    for (const language of ['fr', 'es', 'pt', 'de', 'ar', 'hi', 'en']) {
      const r = await c.put('/api/users/me/preferences', { language });
      assert.equal(r.status, 200, language);
    }
    assert.equal((await c.put('/api/users/me/preferences', { language: 'ar' })).body.preferences.language, 'ar');
    assert.equal((await c.put('/api/users/me/preferences', { language: 'tlh' })).status, 422);
    const again = client(app); await login(again, cust.email);
    assert.equal((await again.get('/api/users/me/preferences')).body.preferences.language, 'ar');
    // changing language never touches money
    assert.equal((await db.query('SELECT count(*)::int n FROM ledger_entries WHERE account_id=$1', [cust.accountId])).rows[0].n, 0);
  });
});
