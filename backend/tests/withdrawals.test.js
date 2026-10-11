import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, latestEmail, fund } from './helpers.js';
import * as L from '../src/repositories/ledger.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const request = (accountId, over = {}) => ({ accountId, amount: '40.00', bankName: 'Example Bank', accountName: 'Casey Doe', last4: '4321', ...over });
const entryCount = async (accountId) => (await db.query('SELECT count(*)::bigint n FROM ledger_entries WHERE account_id=$1', [accountId])).rows[0].n;

describe('customer withdrawal requests', () => {
  test('unverified customer: request is blocked pending verification, nothing is sent, ledger untouched', async () => {
    const cust = await makeCustomer({ verified: false });
    await fund(app, db, cust.accountId, '100');
    const before = await entryCount(cust.accountId);
    const c = client(app);
    await login(c, cust.email);
    const r = await c.post('/api/withdrawals', request(cust.accountId));
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.withdrawal.status, 'additional_verification_required');
    assert.match(r.body.message, /awaiting security verification/i);
    assert.doesNotMatch(r.body.message, /contact/i, 'a customer-care instruction is not shown when only verification is needed');
    assert.match(r.body.message, /No funds have been sent/i);
    assert.equal(await entryCount(cust.accountId), before, 'no ledger entries created');
    assert.equal((await L.balances(db, cust.accountId)).ledger, 10000);
    const tx = (await db.query("SELECT status FROM transactions WHERE type='withdrawal' AND account_id=$1", [cust.accountId])).rows[0];
    assert.equal(tx.status, 'blocked');
    assert.ok(await latestEmail(db, cust.email, 'withdrawal_blocked'));
  });

  test('verified customer: request goes to review; funds are held from availability but never moved', async () => {
    const cust = await makeCustomer({ verified: true });
    await fund(app, db, cust.accountId, '100');
    const c = client(app);
    await login(c, cust.email);
    const r = await c.post('/api/withdrawals', request(cust.accountId, { amount: '60' }));
    assert.equal(r.status, 202);
    assert.equal(r.body.withdrawal.status, 'requested');
    const bal = await L.balances(db, cust.accountId);
    assert.equal(bal.ledger, 10000);
    assert.equal(bal.available, 4000);
    assert.ok(await latestEmail(db, cust.email, 'withdrawal_received'));
    const over = await c.post('/api/withdrawals', request(cust.accountId, { amount: '50' }));
    assert.equal(over.status, 400, 'cannot request more than is available after holds');
    const tx = await c.get('/api/transactions?type=withdrawal');
    assert.equal(tx.body.items.length, 1);
    const detail = await c.get(`/api/transactions/${tx.body.items[0].id}`);
    assert.match(detail.body.transaction.note, /No funds have been sent/i);
  });

  test('ignores client-supplied status/ids and cannot target another customer\'s account', async () => {
    const mine = await makeCustomer({ verified: true });
    const theirs = await makeCustomer({ verified: true });
    await fund(app, db, theirs.accountId, '500');
    await fund(app, db, mine.accountId, '100');
    const c = client(app);
    await login(c, mine.email);
    const foreign = await c.post('/api/withdrawals', request(theirs.accountId));
    assert.equal(foreign.status, 404);
    const r = await c.post('/api/withdrawals', { ...request(mine.accountId), status: 'approved', userId: theirs.user.id });
    assert.equal(r.status, 202);
    assert.equal(r.body.withdrawal.status, 'requested');
    assert.equal((await db.query('SELECT user_id FROM withdrawal_requests WHERE id=$1', [r.body.withdrawal.id])).rows[0].user_id, mine.user.id);
  });

  test('restricted accounts cannot create requests; users can cancel open requests; repeated attempts raise an event', async () => {
    const cust = await makeCustomer({ verified: true });
    await fund(app, db, cust.accountId, '1000');
    const c = client(app);
    await login(c, cust.email);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await c.post('/api/withdrawals', request(cust.accountId, { amount: '10' }))).body.withdrawal.id);
    const ev = await db.query("SELECT severity FROM security_events WHERE user_id=$1 AND type='repeated_withdrawal_attempts'", [cust.user.id]);
    assert.equal(ev.rows.length, 1);
    assert.equal(ev.rows[0].severity, 'low', 'signal for review, not an accusation');
    const cancel = await c.post(`/api/withdrawals/${ids[0]}/cancel`);
    assert.equal(cancel.body.withdrawal.status, 'cancelled');
    assert.equal((await c.post(`/api/withdrawals/${ids[0]}/cancel`)).status, 409);
    await db.query("UPDATE users SET status='suspended' WHERE id=$1", [cust.user.id]);
    assert.equal((await c.post('/api/withdrawals', request(cust.accountId, { amount: '10' }))).status, 403);
  });
});

describe('staff withdrawal management', () => {
  async function pending(verified = true) {
    const cust = await makeCustomer({ verified });
    await fund(app, db, cust.accountId, '300');
    const c = client(app);
    await login(c, cust.email);
    const r = await c.post('/api/withdrawals', request(cust.accountId, { amount: '100' }));
    return { cust, id: r.body.withdrawal.id };
  }

  test('workflow: review -> request verification -> notes -> approve only by finance with MFA; no ledger movement ever', async () => {
    const { cust, id } = await pending(true);
    const compliance = await makeStaff('compliance_admin');
    const cc = await loginStaff(app, compliance);
    const detail = await cc.get(`/api/admin/withdrawals/${id}`);
    assert.equal(detail.status, 200);
    assert.match(detail.body.withdrawal.externalTransferNotice, /No external bank transfer/i);
    assert.equal(detail.body.withdrawal.customer.verificationStatus, 'verified');
    assert.equal((await cc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'start_review' })).body.withdrawal.status, 'under_review');
    assert.equal((await cc.post(`/api/admin/withdrawals/${id}/notes`, { note: 'Reviewed ID documents' })).status, 201);
    assert.equal((await cc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'approve', reason: 'ok', mfaCode: await freshCode(compliance) })).status, 403, 'compliance cannot approve');

    const finance = await makeStaff('finance_operator');
    const fc = await loginStaff(app, finance);
    assert.equal((await fc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'approve', reason: 'Verified and funded' })).status, 403, 'approval needs MFA step-up');
    const ok = await fc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'approve', reason: 'Verified and funded', mfaCode: await freshCode(finance) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.withdrawal.status, 'approved');
    assert.match(ok.body.withdrawal.customerMessage, /no funds have been sent/i);

    assert.equal((await L.balances(db, cust.accountId)).ledger, 30000, 'approval moves nothing');
    assert.equal((await db.query("SELECT count(*)::bigint n FROM ledger_entries WHERE account_id=$1", [cust.accountId])).rows[0].n, 1);
    const tx = (await db.query("SELECT status FROM transactions WHERE type='withdrawal' AND account_id=$1", [cust.accountId])).rows[0];
    assert.notEqual(tx.status, 'completed', 'never marked completed - nothing was transferred');
    const audit = await db.query("SELECT actor_role, previous_state, new_state, reason FROM audit_logs WHERE action='withdrawal.approve'");
    assert.equal(audit.rows.at(-1).actor_role, 'finance_operator');
    assert.equal((await fc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'reject', reason: 'Late change of mind', mfaCode: await freshCode(finance) })).status, 409, 'decided requests are final');
  });

  test('approval is refused when the customer is not verified', async () => {
    const { id } = await pending(false);
    const finance = await makeStaff('finance_operator');
    const fc = await loginStaff(app, finance);
    const r = await fc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'approve', reason: 'Trying anyway', mfaCode: await freshCode(finance) });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'VERIFICATION_REQUIRED');
  });

  test('listing supports status filter and search; support agents can read and note but not decide', async () => {
    const { cust, id } = await pending(true);
    const agent = await makeStaff('support_agent');
    const ac = await loginStaff(app, agent);
    const list = await ac.get(`/api/admin/withdrawals?status=requested&q=${encodeURIComponent(cust.email)}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((w) => w.id === id));
    assert.equal((await ac.post(`/api/admin/withdrawals/${id}/notes`, { note: 'Customer called' })).status, 201);
    assert.equal((await ac.post(`/api/admin/withdrawals/${id}/actions`, { action: 'reject', reason: 'nope nope' })).status, 403);
    assert.equal((await ac.post(`/api/admin/withdrawals/${id}/actions`, { action: 'start_review' })).status, 403);
    const compliance = await makeStaff('compliance_admin');
    const cc = await loginStaff(app, compliance);
    const rv = await cc.post(`/api/admin/withdrawals/${id}/actions`, { action: 'request_verification' });
    assert.equal(rv.body.withdrawal.status, 'additional_verification_required');
    assert.ok(await latestEmail(db, cust.email, 'withdrawal_update'));
  });
});
