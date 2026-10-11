import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, fund } from './helpers.js';
import { newAccountNumber, isValidAccountNumber, ACCOUNT_NUMBER_RE } from '../src/utils/crypto.js';
import * as L from '../src/repositories/ledger.js';
import { plan, apply } from '../src/db/remediateAccountNumbers.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const insertLegacy = async (userId, number) => {
  // Simulates an account that predates the standard (the guard trigger would normally refuse this insert).
  await db.query('ALTER TABLE accounts DISABLE TRIGGER accounts_number_guard_trg');
  try {
    return (await db.query("INSERT INTO accounts (user_id, kind, account_number, type, name, currency, status) VALUES ($1,'customer',$2,'checking','Legacy','USD','active') RETURNING *", [userId, number])).rows[0];
  } finally { await db.query('ALTER TABLE accounts ENABLE TRIGGER accounts_number_guard_trg'); }
};

describe('account number standard (605 + 9 digits)', () => {
  test('every generated number is exactly 12 digits and starts with 605', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const n = newAccountNumber();
      assert.equal(typeof n, 'string', 'handled as a string so leading zeros survive');
      assert.match(n, /^\d{12}$/);
      assert.ok(n.startsWith('605'));
      assert.ok(isValidAccountNumber(n));
      seen.add(n);
    }
    assert.ok(seen.size > 4990, 'numbers are well distributed (no obvious repetition)');
  });

  test('digits after 605 can start with zero (formatting preserved as text)', () => {
    assert.ok(isValidAccountNumber('605000000001'));
    assert.equal('605000000001'.length, 12);
  });

  test('validation rejects letters, symbols, wrong lengths, wrong prefixes and non-strings', () => {
    for (const bad of ['60512345678', '6051234567890', '605abc123456', '605-12345678', '605 123456789', '705123456789', '604123456789', 'EWB1234567890', '', ' 605123456789', '605123456789\n', 605123456789, null, undefined]) {
      assert.equal(isValidAccountNumber(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
    assert.ok(ACCOUNT_NUMBER_RE.test('605123456789'));
  });

  test('new accounts (registration and "open another account") get a conforming number', async () => {
    const a = await makeCustomer();
    assert.ok(isValidAccountNumber(a.accountNumber));
    const c = client(app); await login(c, a.email);
    const extra = await c.post('/api/accounts', { type: 'checking' });
    assert.equal(extra.status, 201);
    assert.ok(isValidAccountNumber(extra.body.account.accountNumber));
    const list = await c.get('/api/accounts');
    assert.ok(list.body.accounts.every((x) => isValidAccountNumber(x.accountNumber)));
  });

  test('the client cannot choose an account number', async () => {
    const a = await makeCustomer();
    const c = client(app); await login(c, a.email);
    const r = await c.post('/api/accounts', { type: 'checking', accountNumber: '605999999999', account_number: '605888888888' });
    assert.equal(r.status, 201);
    assert.notEqual(r.body.account.accountNumber, '605999999999');
    assert.notEqual(r.body.account.accountNumber, '605888888888');
  });

  test('the database refuses non-conforming customer numbers and duplicates', async () => {
    const a = await makeCustomer();
    await assert.rejects(db.query("INSERT INTO accounts (user_id, kind, account_number, type, name, currency) VALUES ($1,'customer','EWB1234567890','checking','X','USD')", [a.user.id]), /605/);
    await assert.rejects(db.query("INSERT INTO accounts (user_id, kind, account_number, type, name, currency) VALUES ($1,'customer','60512345','checking','X','USD')", [a.user.id]), /605/);
    await assert.rejects(db.query("INSERT INTO accounts (user_id, kind, account_number, type, name, currency) VALUES ($1,'customer',$2,'checking','X','USD')", [a.user.id, a.accountNumber]), /unique|duplicate/i);
  });

  test('collision handling: a clash draws another number and does NOT abort the surrounding transaction', async () => {
    const a = await makeCustomer();
    const draws = [a.accountNumber, a.accountNumber, '605424242424']; // two collisions, then a free number
    let i = 0;
    const created = await db.tx(async (t) => {
      const acct = await L.createAccount(t, { userId: a.user.id, name: 'Second', currency: 'USD', status: 'active', generate: () => draws[i++] });
      const still = await t.query('SELECT 1 AS ok'); // would throw "current transaction is aborted" with the old implementation
      assert.equal(still.rows[0].ok, 1);
      return acct;
    });
    assert.equal(created.account_number, '605424242424');
    assert.equal(i, 3);
    assert.equal((await db.query('SELECT count(*)::int n FROM accounts WHERE account_number=$1', [a.accountNumber])).rows[0].n, 1);
  });

  test('gives up cleanly (error, no partial data) if numbers keep colliding', async () => {
    const a = await makeCustomer();
    await assert.rejects(L.createAccount(db, { userId: a.user.id, name: 'X', currency: 'USD', generate: () => a.accountNumber }), /unique account number/);
  });

  test('account numbers cannot be changed by ordinary updates, including by the app database role', async () => {
    const a = await makeCustomer();
    await assert.rejects(db.query("UPDATE accounts SET account_number='605111111111' WHERE id=$1", [a.accountId]), /immutable/);
    await db.query("UPDATE accounts SET name='Renamed', status='active' WHERE id=$1", [a.accountId]); // other columns remain editable
    assert.equal((await db.query('SELECT account_number FROM accounts WHERE id=$1', [a.accountId])).rows[0].account_number, a.accountNumber);
  });

  test('lookup: transfers resolve the new number and a legacy number, and reject unknown ones', async () => {
    const sender = await makeCustomer({ verified: true });
    const receiver = await makeCustomer({ verified: true });
    const legacyOwner = await makeCustomer({ verified: true, accountActive: false });
    await fund(app, db, sender.accountId, '100');
    const legacy = await insertLegacy(legacyOwner.user.id, 'EWB5550001111');
    const c = client(app); await login(c, sender.email);
    const t = (to, k) => c.post('/api/transactions/transfers', { fromAccountId: sender.accountId, toAccountNumber: to, amount: '5', idempotencyKey: `lookup-${k}-abcdef` });
    assert.equal((await t(receiver.accountNumber, 1)).status, 201);
    assert.equal((await t(legacy.account_number, 2)).status, 201, 'legacy numbers still resolve');
    assert.equal((await t('605000000000', 3)).status, 404, 'valid format, no such account');
    assert.equal((await t('605ABC123456', 4)).status, 422);
    assert.equal((await t('6051234567', 5)).status, 422);
  });
});

describe('remediation of pre-standard account numbers', () => {
  test('dry run reports accounts, flags activity, and changes nothing', async () => {
    const o = await makeCustomer({ verified: true });
    const quiet = await insertLegacy(o.user.id, 'EWB7000000001');
    const busy = await insertLegacy(o.user.id, 'EWB7000000002');
    await db.query("UPDATE accounts SET status='active' WHERE id=$1", [busy.id]);
    await fund(app, db, busy.id, '10');
    const rows = await plan(db);
    const q = rows.find((r) => r.id === quiet.id); const b = rows.find((r) => r.id === busy.id);
    assert.equal(q.safeToRenumber, true);
    assert.equal(b.safeToRenumber, false);
    assert.ok(b.ledgerEntries > 0);
    assert.equal((await db.query('SELECT account_number FROM accounts WHERE id=$1', [quiet.id])).rows[0].account_number, 'EWB7000000001');
  });

  test('apply renumbers only untouched accounts, keeps the old number, preserves relationships, and is audited', async () => {
    const o = await makeCustomer({ verified: true });
    const quiet = await insertLegacy(o.user.id, 'EWB7100000001');
    const busy = await insertLegacy(o.user.id, 'EWB7100000002');
    await fund(app, db, busy.id, '25');
    const txBefore = (await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [busy.id])).rows[0].n;

    const changed = await apply(db);
    assert.ok(changed.some((c) => c.id === quiet.id));
    assert.ok(!changed.some((c) => c.id === busy.id), 'accounts with activity are never touched');

    const q = (await db.query('SELECT * FROM accounts WHERE id=$1', [quiet.id])).rows[0];
    assert.ok(isValidAccountNumber(q.account_number));
    assert.equal(q.legacy_account_number, 'EWB7100000001');
    assert.equal(q.user_id, o.user.id, 'ownership preserved');
    const b = (await db.query('SELECT * FROM accounts WHERE id=$1', [busy.id])).rows[0];
    assert.equal(b.account_number, 'EWB7100000002');
    assert.equal((await db.query('SELECT count(*)::int n FROM transactions WHERE account_id=$1', [busy.id])).rows[0].n, txBefore);
    assert.equal((await L.balances(db, busy.id)).ledger, 2500);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='account.renumber' AND account_id=$1", [quiet.id])).rows[0].n, 1);

    // the old number keeps working for transfers
    const sender = await makeCustomer({ verified: true });
    await db.query("UPDATE accounts SET status='active' WHERE id=$1", [quiet.id]);
    await fund(app, db, sender.accountId, '20');
    const c = client(app); await login(c, sender.email);
    const r = await c.post('/api/transactions/transfers', { fromAccountId: sender.accountId, toAccountNumber: 'EWB7100000001', amount: '5', idempotencyKey: 'legacy-after-renumber-1' });
    assert.equal(r.status, 201);
    assert.equal((await L.balances(db, quiet.id)).ledger, 500);
    assert.deepEqual((await apply(db)).filter((c2) => c2.id === quiet.id), [], 'idempotent: nothing left to renumber');
  });

  test('a failed run rolls back completely', async () => {
    const o = await makeCustomer();
    await insertLegacy(o.user.id, 'EWB7200000001');
    await assert.rejects(apply(db, { generate: () => 'EWB0000000000' }), /non-conforming/);
    assert.equal((await db.query("SELECT count(*)::int n FROM accounts WHERE account_number='EWB7200000001'")).rows[0].n, 1);
  });
});
