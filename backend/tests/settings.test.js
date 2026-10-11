import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, fund, latestEmail, codeFromEmail, PASSWORD, uniqueEmail } from './helpers.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const signedIn = async (opts) => { const cust = await makeCustomer(opts); const c = client(app); const r = await login(c, cust.email); assert.equal(r.status, 200, JSON.stringify(r.body)); return { cust, c }; };

describe('email change', () => {
  test('needs the password, sends a code to the NEW address, only switches after the code, signs out other sessions and warns the old address', async () => {
    const { cust, c } = await signedIn();
    const other = client(app); await login(other, cust.email);
    const next = uniqueEmail('new');

    assert.equal((await c.post('/api/users/me/email-change', { newEmail: next, password: 'Wrong-password-1!' })).status, 422);
    assert.equal((await c.post('/api/users/me/email-change', { newEmail: cust.email, password: PASSWORD })).status, 422, 'same address');
    const r = await c.post('/api/users/me/email-change', { newEmail: next, password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await c.get('/api/users/me')).body.user.email, cust.email, 'unchanged until confirmed');

    const mail = await latestEmail(db, next, 'email_change');
    assert.ok(mail, 'code goes to the new address');
    assert.equal(await latestEmail(db, cust.email, 'email_change'), undefined);
    const code = codeFromEmail(mail);
    assert.equal((await c.post('/api/users/me/email-change/confirm', { code: code === '000000' ? '111111' : '000000' })).status, 400);
    const ok = await c.post('/api/users/me/email-change/confirm', { code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.email, next);
    assert.equal(ok.body.user.emailVerified, true);
    assert.equal((await c.get('/api/users/me')).status, 200, 'current session stays signed in');
    assert.equal((await other.get('/api/users/me')).status, 401, 'other sessions are ended');
    assert.ok(await latestEmail(db, cust.email, 'security_alert'), 'old address is told');
    assert.equal((await c.post('/api/users/me/email-change/confirm', { code })).status, 400, 'a code works once');
    assert.ok((await db.query("SELECT 1 FROM audit_logs WHERE action='email_change.confirm' AND target_id=$1", [cust.user.id])).rows[0]);
  });

  test('five wrong guesses burn the code; an address already in use looks identical but changes nothing', async () => {
    const { cust, c } = await signedIn();
    const next = uniqueEmail('burn');
    await c.post('/api/users/me/email-change', { newEmail: next, password: PASSWORD });
    const code = codeFromEmail(await latestEmail(db, next, 'email_change'));
    const bad = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await c.post('/api/users/me/email-change/confirm', { code: bad });
    assert.equal((await c.post('/api/users/me/email-change/confirm', { code })).status, 400, 'burnt code no longer works');

    const taken = await makeCustomer();
    const { c: c2 } = await signedIn();
    const res = await c2.post('/api/users/me/email-change', { newEmail: taken.email, password: PASSWORD });
    assert.equal(res.status, 200, 'does not reveal the address is in use');
    assert.equal(await latestEmail(db, taken.email, 'email_change'), undefined, 'no code is sent to an existing profile');
    assert.ok(await latestEmail(db, taken.email, 'security_alert'), 'the owner is notified');
    assert.equal((await db.query('SELECT count(*)::int n FROM users WHERE lower(email)=lower($1)', [taken.email])).rows[0].n, 1);
  });
});

describe('phone number change requires re-authentication', () => {
  test('wrong or missing password is refused; correct password marks the new number unverified', async () => {
    const { cust, c } = await signedIn({ over: { phone: '+1 555 010 0100' } });
    assert.equal((await c.patch('/api/users/me', { phone: '+1 555 010 0111' })).status, 422);
    assert.equal((await c.patch('/api/users/me', { phone: '+1 555 010 0111', currentPassword: 'Nope-nope-1!' })).status, 422);
    assert.equal((await c.patch('/api/users/me', { city: 'Austin' })).status, 200, 'other fields need no password');
    const ok = await c.patch('/api/users/me', { phone: '+1 555 010 0111', currentPassword: PASSWORD });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.phoneVerified, false);
  });
});

describe('account name and closure', () => {
  test('rename works only on your own account', async () => {
    const a = await signedIn(); const b = await makeCustomer();
    const r = await a.c.patch(`/api/accounts/${a.cust.accountId}`, { name: 'Holiday fund' });
    assert.equal(r.status, 200);
    assert.equal(r.body.account.name, 'Holiday fund');
    assert.equal((await a.c.patch(`/api/accounts/${b.accountId}`, { name: 'Mine now' })).status, 404);
    assert.equal((await a.c.patch(`/api/accounts/${a.cust.accountId}`, { name: 'x' })).status, 422);
  });

  test('closure is refused while there is a balance, then requested, cancellable, and completed by staff', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '25.00');
    const blocked = await c.post(`/api/accounts/${cust.accountId}/closure`, { password: PASSWORD, reason: 'moving' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'BALANCE_NOT_ZERO');

    // empty the account through the ledger (finance adjustment) so closure is allowed
    const finance = await makeStaff('finance_operator'); const fc = await loginStaff(app, finance);
    const { freshCode } = await import('./helpers.js');
    const adj = await fc.post('/api/ledger/adjustments', { accountId: cust.accountId, direction: 'debit', amount: '25.00', currency: 'USD', reason: 'Test: remove balance before closure', mfaCode: await freshCode(finance), idempotencyKey: `close-${Date.now()}` });
    assert.equal(adj.status, 201, JSON.stringify(adj.body));

    assert.equal((await c.post(`/api/accounts/${cust.accountId}/closure`, { password: 'Wrong-pass-1!' })).status, 422);
    const req = await c.post(`/api/accounts/${cust.accountId}/closure`, { password: PASSWORD, reason: 'No longer needed' });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    assert.equal(req.body.closure.status, 'requested');
    assert.ok(req.body.closure.ticketId, 'a support conversation is opened');
    assert.equal((await c.post(`/api/accounts/${cust.accountId}/closure`, { password: PASSWORD })).status, 409, 'only one open request');

    const cancel = await c.delete(`/api/accounts/${cust.accountId}/closure`);
    assert.equal(cancel.body.closure.status, 'cancelled');
    const again = await c.post(`/api/accounts/${cust.accountId}/closure`, { password: PASSWORD });
    assert.equal(again.status, 201);

    // customers and support cannot decide; compliance admins can
    assert.equal((await c.post(`/api/admin/account-closures/${again.body.closure.id}`, { decision: 'complete' })).status, 403);
    const support = await loginStaff(app, await makeStaff('support_agent'));
    assert.equal((await support.post(`/api/admin/account-closures/${again.body.closure.id}`, { decision: 'complete' })).status, 403);
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    assert.ok((await comp.get('/api/admin/account-closures')).body.items.some((i) => i.id === again.body.closure.id));
    const done = await comp.post(`/api/admin/account-closures/${again.body.closure.id}`, { decision: 'complete', note: 'Confirmed with customer' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((await db.query('SELECT status FROM accounts WHERE id=$1', [cust.accountId])).rows[0].status, 'closed');
    assert.ok((await db.query("SELECT 1 FROM audit_logs WHERE action='account.closure_completed' AND account_id=$1", [cust.accountId])).rows[0]);
    // history is kept
    assert.ok((await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [cust.accountId])).rows[0].n >= 2);
  });
});

describe('feedback and legal acceptance listing', () => {
  test('feedback opens a support request; acceptance history lists accepted versions', async () => {
    const { cust, c } = await signedIn();
    assert.equal((await c.post('/api/users/me/feedback', { kind: 'suggestion', message: 'short' })).status, 422);
    const r = await c.post('/api/users/me/feedback', { kind: 'suggestion', message: 'Please add a dark theme to the statements page.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.ticket.subject, /Feedback/);
    const acc = await c.get('/api/users/me/legal-acceptances');
    assert.equal(acc.status, 200);
    assert.ok(Array.isArray(acc.body.items));
    assert.equal(acc.body.items.length, 0, 'users created outside registration have no recorded acceptance');
  });
});
