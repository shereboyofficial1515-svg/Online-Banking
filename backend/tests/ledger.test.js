import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, latestEmail, fund } from './helpers.js';
import * as L from '../src/repositories/ledger.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const balance = async (accountId) => (await L.balances(db, accountId));

describe('admin ledger credit', () => {
  test('creates immutable entries, derives balance from them, audits everything, and notifies the user', async () => {
    const cust = await makeCustomer();
    const finance = await makeStaff('finance_operator');
    const c = await loginStaff(app, finance);
    const r = await c.post('/api/ledger/adjustments', {
      accountId: cust.accountId, direction: 'credit', amount: '250.75', currency: 'USD', reason: 'Initial test-ledger funding', mfaCode: await freshCode(finance), idempotencyKey: 'credit-0001-abcdef',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.balanceBefore, 0);
    assert.equal(r.body.balanceAfter, 25075);
    assert.match(r.body.reference, /^EWB-/);

    // balance is derived from entries
    assert.equal((await balance(cust.accountId)).ledger, 25075);
    const entries = (await db.query('SELECT * FROM ledger_entries WHERE transaction_id=$1 ORDER BY direction', [r.body.transactionId])).rows;
    assert.equal(entries.length, 2, 'double entry: customer + internal funding account');
    const net = entries.reduce((s, e) => s + (e.direction === 'credit' ? e.amount : -e.amount), 0);
    assert.equal(net, 0, 'entries balance to zero');
    assert.deepEqual(await L.verifyIntegrity(db, cust.accountId), { ok: true, balance: 25075, entries: 1 });

    // audit record has every required field
    const { rows: [a] } = await db.query("SELECT * FROM audit_logs WHERE action='ledger.credit' AND account_id=$1", [cust.accountId]);
    assert.equal(a.actor_id, finance.user.id);
    assert.equal(a.actor_role, 'finance_operator');
    assert.equal(a.reason, 'Initial test-ledger funding');
    assert.ok(a.ip && a.session_id && a.device_id, 'ip, session and device recorded');
    assert.equal(a.previous_state.ledgerBalance, 0);
    assert.equal(a.new_state.ledgerBalance, 25075);
    assert.equal(a.metadata.reference, r.body.reference);
    assert.equal(a.metadata.currency, 'USD');
    assert.equal(a.metadata.amountMinor, 25075);

    // user is told, in-app and by email, without leaking the internal reason
    const mail = await latestEmail(db, cust.email, 'ledger_adjustment');
    assert.ok(mail);
    assert.ok(mail.body_html.includes(r.body.reference));
    assert.ok(!mail.body_html.includes('Initial test-ledger funding'));
    assert.equal((await db.query("SELECT 1 FROM notifications WHERE user_id=$1 AND category='transaction'", [cust.user.id])).rows.length, 1);
    assert.equal((await db.query("SELECT 1 FROM security_events WHERE user_id=$1 AND type='admin_financial_action'", [cust.user.id])).rows.length, 1);
  });

  test('requires a valid, unused authenticator code and a real reason', async () => {
    const cust = await makeCustomer();
    const finance = await makeStaff('finance_operator');
    const c = await loginStaff(app, finance);
    const base = { accountId: cust.accountId, direction: 'credit', amount: '10', currency: 'USD', reason: 'Valid reason here', idempotencyKey: 'idem-key-12345' };
    assert.equal((await c.post('/api/ledger/adjustments', { ...base })).status, 422, 'no MFA code');
    assert.equal((await c.post('/api/ledger/adjustments', { ...base, mfaCode: '000000' })).status, 403);
    assert.equal((await c.post('/api/ledger/adjustments', { ...base, reason: 'short', mfaCode: await freshCode(finance) })).status, 422);
    const code = await freshCode(finance);
    assert.equal((await c.post('/api/ledger/adjustments', { ...base, mfaCode: code })).status, 201);
    assert.equal((await c.post('/api/ledger/adjustments', { ...base, idempotencyKey: 'idem-key-67890', mfaCode: code })).status, 403, 'code cannot be replayed');
    assert.equal((await balance(cust.accountId)).ledger, 1000);
  });

  test('is idempotent: repeating the same key does not double-credit', async () => {
    const cust = await makeCustomer();
    const finance = await makeStaff('finance_operator');
    const c = await loginStaff(app, finance);
    const body = { accountId: cust.accountId, direction: 'credit', amount: '50', currency: 'USD', reason: 'Idempotency check', idempotencyKey: 'same-key-123456' };
    const a = await c.post('/api/ledger/adjustments', { ...body, mfaCode: await freshCode(finance) });
    const b = await c.post('/api/ledger/adjustments', { ...body, mfaCode: await freshCode(finance) });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.replayed, true);
    assert.equal(a.body.reference, b.body.reference);
    assert.equal((await balance(cust.accountId)).ledger, 5000);
  });

  test('rejects currency mismatch, inactive accounts, system accounts and overdrawing debits', async () => {
    const cust = await makeCustomer();
    const pending = await makeCustomer({ accountActive: false });
    const finance = await makeStaff('finance_operator');
    const c = await loginStaff(app, finance);
    const go = async (over) => c.post('/api/ledger/adjustments', { accountId: cust.accountId, direction: 'credit', amount: '5', currency: 'USD', reason: 'Edge case testing', idempotencyKey: `k-${Math.random()}-xxxxx`, ...over, mfaCode: await freshCode(finance) });
    assert.equal((await go({ currency: 'EUR' })).status, 400);
    assert.equal((await go({ accountId: pending.accountId })).status, 409);
    const sys = (await db.query("SELECT id FROM accounts WHERE kind='system' LIMIT 1")).rows[0];
    if (sys) assert.equal((await go({ accountId: sys.id })).status, 403);
    assert.equal((await go({ direction: 'debit', amount: '1' })).status, 409, 'cannot debit an empty account');
    assert.equal((await go({ amount: '1.999' })).status, 422);
    assert.equal((await go({ amount: '-5' })).status, 422);
    assert.equal((await balance(cust.accountId)).ledger, 0);
  });

  test('large adjustments raise a high-severity security event and email security admins', async () => {
    const cust = await makeCustomer();
    const secAdmin = await makeStaff('security_admin');
    const finance = await makeStaff('finance_operator');
    const c = await loginStaff(app, finance);
    const r = await c.post('/api/ledger/adjustments', { accountId: cust.accountId, direction: 'credit', amount: '2000000', currency: 'USD', reason: 'Large amount for threshold test', idempotencyKey: 'large-0001-abcd', mfaCode: await freshCode(finance) });
    assert.equal(r.status, 201);
    const ev = await db.query("SELECT severity FROM security_events WHERE user_id=$1 AND type='large_ledger_adjustment'", [cust.user.id]);
    assert.equal(ev.rows[0].severity, 'high');
    let alert;
    for (let i = 0; i < 20 && !alert; i++) { alert = await latestEmail(db, secAdmin.email, 'admin_security_alert'); if (!alert) await new Promise((r) => setTimeout(r, 50)); }
    assert.ok(alert, 'security administrators are emailed about large financial actions');
    assert.ok(!alert.body_html.includes(cust.email), 'alert does not leak customer PII');
  });
});

describe('ledger immutability (database level)', () => {
  test('ledger entries, audit logs and transaction financials cannot be altered or deleted', async () => {
    const cust = await makeCustomer();
    const out = await fund(app, db, cust.accountId, '100.00');
    await assert.rejects(db.query("UPDATE ledger_entries SET amount = amount + 1 WHERE transaction_id=$1", [out.transactionId]), /append-only/);
    await assert.rejects(db.query("UPDATE ledger_entries SET balance_after = 999999 WHERE transaction_id=$1", [out.transactionId]), /append-only/);
    await assert.rejects(db.query('DELETE FROM ledger_entries WHERE transaction_id=$1', [out.transactionId]), /append-only/);
    await assert.rejects(db.query("UPDATE transactions SET amount = 1 WHERE id=$1", [out.transactionId]), /immutable/);
    await assert.rejects(db.query('DELETE FROM transactions WHERE id=$1', [out.transactionId]), /not permitted/);
    await assert.rejects(db.query("UPDATE audit_logs SET reason='tampered' WHERE account_id=$1", [cust.accountId]), /append-only/);
    await assert.rejects(db.query('DELETE FROM audit_logs WHERE account_id=$1', [cust.accountId]), /append-only/);
    await assert.rejects(db.query("UPDATE transactions SET status='pending' WHERE id=$1", [out.transactionId]), /illegal transaction status/);
    assert.equal((await balance(cust.accountId)).ledger, 10000);
  });

  test('database refuses to drive a customer account negative even if application code is bypassed', async () => {
    const cust = await makeCustomer();
    const acct = (await db.query('SELECT * FROM accounts WHERE id=$1', [cust.accountId])).rows[0];
    const tx = await L.insertTransaction(db, { type: 'ledger_debit', status: 'completed', amount: 100, currency: 'USD', accountId: cust.accountId, initiatedBy: cust.user.id });
    await assert.rejects(L.postEntry(db, { account: acct, transactionId: tx.id, entryType: 'x', direction: 'debit', amount: 100 }), /insufficient funds/);
  });
});

describe('customer transfers', () => {
  test('requires identity verification', async () => {
    const a = await makeCustomer({ verified: false });
    const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const c = client(app);
    await login(c, a.email);
    const r = await c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '10', idempotencyKey: 'transfer-key-1' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'VERIFICATION_REQUIRED');
    assert.equal((await balance(a.accountId)).ledger, 10000);
  });

  test('moves money atomically with double entry and notifies both parties', async () => {
    const a = await makeCustomer({ verified: true });
    const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const c = client(app);
    await login(c, a.email);
    const r = await c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '30.50', description: 'Rent', idempotencyKey: 'transfer-key-2' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.transaction.status, 'completed');
    assert.equal((await balance(a.accountId)).ledger, 6950);
    assert.equal((await balance(b.accountId)).ledger, 3050);
    for (const id of [a.accountId, b.accountId]) assert.equal((await L.verifyIntegrity(db, id)).ok, true);
    // replay with the same key
    const again = await c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '30.50', description: 'Rent', idempotencyKey: 'transfer-key-2' });
    assert.equal(again.status, 200);
    assert.equal((await balance(a.accountId)).ledger, 6950);
    assert.ok(await latestEmail(db, b.email, 'transfer_receipt'));
    // visible in both histories
    const hb = client(app);
    await login(hb, b.email);
    const list = await hb.get('/api/transactions');
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].direction, 'credit');
    const detail = await c.get(`/api/transactions/${r.body.transaction.id}`);
    assert.equal(detail.body.transaction.entries.length, 1, 'user sees only entries on their own account');
  });

  test('rejects overdrafts, self-transfers, unknown accounts, inactive destinations and foreign source accounts', async () => {
    const a = await makeCustomer({ verified: true });
    const b = await makeCustomer({ verified: true });
    const dormant = await makeCustomer({ accountActive: false });
    await fund(app, db, a.accountId, '20');
    const c = client(app);
    await login(c, a.email);
    const t = (over) => c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '5', idempotencyKey: `k-${Math.random()}-zzzz`, ...over });
    assert.equal((await t({ amount: '20.01' })).status, 409);
    assert.equal((await t({ toAccountNumber: a.accountNumber })).status, 400);
    assert.equal((await t({ toAccountNumber: 'EWB0000000000' })).status, 404);
    assert.equal((await t({ toAccountNumber: dormant.accountNumber })).status, 409);
    assert.equal((await t({ fromAccountId: b.accountId })).status, 404, 'cannot spend from someone else\'s account');
    assert.equal((await t({ amount: '999999' })).status, 400, 'per-transaction limit');
    assert.equal((await balance(b.accountId)).ledger, 0);
  });

  test('concurrent transfers can never overdraw the account', async () => {
    const a = await makeCustomer({ verified: true });
    const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const c = client(app);
    await login(c, a.email);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '40', idempotencyKey: `race-key-${i}-aaaa` })));
    const ok = results.filter((r) => r.status === 201).length;
    assert.equal(ok, 2);
    assert.equal((await balance(a.accountId)).ledger, 2000);
    assert.equal((await balance(b.accountId)).ledger, 8000);
    assert.equal((await L.verifyIntegrity(db, a.accountId)).ok, true);
  });
});

describe('reversals', () => {
  test('a completed credit can be reversed with compensating entries; history is preserved', async () => {
    const cust = await makeCustomer();
    const out = await fund(app, db, cust.accountId, '75.00');
    const finance = await makeStaff('finance_operator');
    const c = await loginStaff(app, finance);
    const r = await c.post('/api/ledger/reversals', { transactionId: out.transactionId, reason: 'Funded the wrong account', mfaCode: await freshCode(finance) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await balance(cust.accountId)).ledger, 0);
    const entries = (await db.query('SELECT count(*)::bigint n FROM ledger_entries WHERE account_id=$1', [cust.accountId])).rows[0].n;
    assert.equal(entries, 2, 'original entry still present plus the reversal entry');
    assert.equal((await db.query('SELECT status FROM transactions WHERE id=$1', [out.transactionId])).rows[0].status, 'reversed');
    const again = await c.post('/api/ledger/reversals', { transactionId: out.transactionId, reason: 'Trying to reverse twice', mfaCode: await freshCode(finance) });
    assert.equal(again.status, 409);
    assert.equal((await L.verifyIntegrity(db, cust.accountId)).ok, true);
  });

  test('cannot reverse a credit that would overdraw the customer', async () => {
    const a = await makeCustomer({ verified: true });
    const b = await makeCustomer({ verified: true });
    const out = await fund(app, db, a.accountId, '50');
    const c = client(app);
    await login(c, a.email);
    await c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '50', idempotencyKey: 'drain-key-0001' });
    const finance = await makeStaff('finance_operator');
    const fc = await loginStaff(app, finance);
    const r = await fc.post('/api/ledger/reversals', { transactionId: out.transactionId, reason: 'Attempt to overdraw by reversal', mfaCode: await freshCode(finance) });
    assert.equal(r.status, 409);
    assert.equal((await balance(a.accountId)).ledger, 0);
  });
});
