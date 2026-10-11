import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, fund } from './helpers.js';
import * as L from '../src/repositories/ledger.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const req = (accountId, over = {}) => ({ accountId, amount: '20.00', bankName: 'Example Bank', accountName: 'Casey Doe', last4: '4321', ...over });
const signedIn = async (opts) => { const cust = await makeCustomer(opts); const c = client(app); await login(c, cust.email); return { cust, c }; };
const review = (c, accountId, enabled, reason = 'Unusual activity check') => c.post(`/api/admin/accounts/${accountId}/security-review`, { enabled, reason });

describe('withdrawal messaging follows the real state', () => {
  test('an eligible account is not told to contact customer care', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const r = await c.post('/api/withdrawals', req(cust.accountId));
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.withdrawal.status, 'requested');
    assert.doesNotMatch(r.body.message, /customer (care|support)|review/i);
    assert.match(r.body.message, /received/i);
    assert.match(r.body.message, /No funds have been sent/i);
    assert.equal((await db.query("SELECT status FROM transactions WHERE type='withdrawal' AND account_id=$1", [cust.accountId])).rows[0].status, 'pending');
  });

  test('an account that needs identity verification gets the specific action, not a support instruction', async () => {
    const { cust, c } = await signedIn({ verified: false });
    await fund(app, db, cust.accountId, '100');
    const r = await c.post('/api/withdrawals', req(cust.accountId));
    assert.equal(r.body.withdrawal.status, 'additional_verification_required');
    assert.match(r.body.message, /awaiting security verification/i);
    assert.match(r.body.message, /identity verification/i);
    assert.doesNotMatch(r.body.message, /contact/i);
  });

  test('customer_support_required (set by staff) is the only state that asks the customer to open a support request', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const w = (await c.post('/api/withdrawals', req(cust.accountId))).body.withdrawal;
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    assert.equal((await comp.post(`/api/admin/withdrawals/${w.id}/actions`, { action: 'require_support', reason: 'Need to confirm details' })).status, 200);
    const got = (await c.get(`/api/withdrawals/${w.id}`)).body.withdrawal;
    assert.equal(got.status, 'customer_support_required');
    assert.match(got.customerMessage, /Customer Support/);
  });
});

describe('account security review', () => {
  test('only accounts.review can start or clear it; customers and support agents cannot', async () => {
    const { cust, c } = await signedIn({ verified: true });
    assert.equal((await review(c, cust.accountId, true)).status, 403);
    const support = await loginStaff(app, await makeStaff('support_agent'));
    assert.equal((await review(support, cust.accountId, true)).status, 403);
    assert.equal((await db.query('SELECT security_review_at FROM accounts WHERE id=$1', [cust.accountId])).rows[0].security_review_at, null);
  });

  test('a flagged account routes new and waiting requests to review with the neutral explanation; other accounts are unaffected', async () => {
    const { cust, c } = await signedIn({ verified: true });
    const other = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '200'); await fund(app, db, other.cust.accountId, '200');
    const waiting = (await c.post('/api/withdrawals', req(cust.accountId, { amount: '10.00' }))).body.withdrawal;
    assert.equal(waiting.status, 'requested');

    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    const on = await review(comp, cust.accountId, true, 'Pattern check on recent activity');
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.withdrawalsMoved, 1);
    assert.equal((await review(comp, cust.accountId, true)).status, 409, 'no duplicate flag');
    assert.equal((await c.get(`/api/withdrawals/${waiting.id}`)).body.withdrawal.status, 'under_review');

    const fresh = await c.post('/api/withdrawals', req(cust.accountId, { amount: '15.00' }));
    assert.equal(fresh.status, 202);
    assert.equal(fresh.body.withdrawal.status, 'under_review');
    assert.match(fresh.body.message, /additional security review/i);
    assert.match(fresh.body.message, /We will notify you/i);
    assert.doesNotMatch(fresh.body.message, /contact|fraud|suspicious/i, 'neutral, no accusation, no customer-care instruction');

    const mine = (await c.get('/api/accounts')).body.accounts.find((a) => a.id === cust.accountId);
    assert.equal(mine.securityReview, true);
    assert.equal(JSON.stringify(mine).includes('Pattern check'), false, 'staff reason is never sent to the customer');

    const theirs = await other.c.post('/api/withdrawals', req(other.cust.accountId));
    assert.equal(theirs.body.withdrawal.status, 'requested', 'unrelated customers are not blocked');
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='account.security_review_start' AND account_id=$1", [cust.accountId])).rows[0].n, 1);
  });

  test('approval is refused while under review, allowed after the review is cleared, and nothing is ever auto-approved', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    await review(comp, cust.accountId, true);
    const w = (await c.post('/api/withdrawals', req(cust.accountId))).body.withdrawal;
    const finance = await makeStaff('finance_operator'); const fc = await loginStaff(app, finance);
    const blocked = await fc.post(`/api/admin/withdrawals/${w.id}/actions`, { action: 'approve', reason: 'Looks fine', mfaCode: await freshCode(finance) });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'ACCOUNT_UNDER_REVIEW');

    assert.equal((await review(comp, cust.accountId, false, 'Review finished, no issues')).status, 200);
    const stillWaiting = (await c.get(`/api/withdrawals/${w.id}`)).body.withdrawal;
    assert.equal(stillWaiting.status, 'under_review', 'clearing the review does not approve anything');

    const ok = await fc.post(`/api/admin/withdrawals/${w.id}/actions`, { action: 'approve', reason: 'Review complete', mfaCode: await freshCode(finance) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const done = (await c.get(`/api/withdrawals/${w.id}`)).body.withdrawal;
    assert.equal(done.status, 'approved');
    assert.match(done.customerMessage, /approved/i);
    assert.doesNotMatch(done.customerMessage, /completed|paid out|sent to your/i, 'never claims completion');
    assert.equal((await L.balances(db, cust.accountId)).ledger, 10000, 'balance untouched');
  });

  test('the client cannot choose the status or bypass review through the request body', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    await review(comp, cust.accountId, true);
    const r = await c.post('/api/withdrawals', { ...req(cust.accountId), status: 'approved', securityReview: false, underReview: false });
    assert.equal(r.body.withdrawal.status, 'under_review');
    assert.equal((await c.patch(`/api/accounts/${cust.accountId}`, { name: 'Renamed', securityReview: false })).status, 200);
    assert.ok((await db.query('SELECT security_review_at FROM accounts WHERE id=$1', [cust.accountId])).rows[0].security_review_at, 'flag unchanged');
  });

  test('a genuinely restricted profile gets an accurate refusal with no invented review claim', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '100');
    await db.query("UPDATE users SET status='suspended' WHERE id=$1", [cust.user.id]);
    const r = await c.post('/api/withdrawals', req(cust.accountId));
    assert.ok([401, 403].includes(r.status), String(r.status));
    assert.doesNotMatch(JSON.stringify(r.body), /security review|fraud/i);
    assert.equal((await db.query('SELECT count(*)::int n FROM withdrawal_requests WHERE user_id=$1', [cust.user.id])).rows[0].n, 0);
  });

  test('existing requests and transactions are preserved when review is switched on and off', async () => {
    const { cust, c } = await signedIn({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const w = (await c.post('/api/withdrawals', req(cust.accountId))).body.withdrawal;
    const before = (await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [cust.accountId])).rows[0].n;
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    await review(comp, cust.accountId, true); await review(comp, cust.accountId, false, 'Done');
    assert.equal((await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [cust.accountId])).rows[0].n, before);
    assert.equal((await db.query('SELECT reference FROM withdrawal_requests WHERE id=$1', [w.id])).rows[0].reference, w.reference);
    assert.equal((await db.query("SELECT status FROM transactions WHERE type='withdrawal' AND account_id=$1", [cust.accountId])).rows[0].status, 'pending');
  });
});
