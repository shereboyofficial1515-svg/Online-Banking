// Low-level ledger primitives. Nothing here decides *whether* a posting is allowed - that is the
// service layer's job. These functions guarantee *how*: gapless per-account sequence numbers,
// running balances computed from prior entries, and no path that updates or deletes an entry.
import { newReference, newAccountNumber } from '../utils/crypto.js';

// Withdrawal requests in these states reserve funds from AVAILABLE balance (not from the ledger).
export const HOLD_STATUSES = ['requested', 'under_review', 'additional_verification_required', 'customer_support_required', 'approved'];

export async function lockAccounts(q, ids) {
  const sorted = [...new Set(ids)].sort(); // consistent lock order prevents deadlocks between concurrent transfers
  const { rows } = await q.query('SELECT * FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [sorted]);
  return new Map(rows.map((r) => [r.id, r]));
}

export async function ledgerBalance(q, accountId) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END),0)::bigint AS bal FROM ledger_entries WHERE account_id=$1`, [accountId]);
  return rows[0].bal;
}
export async function holdsTotal(q, accountId) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(amount),0)::bigint AS held FROM withdrawal_requests WHERE account_id=$1 AND status = ANY($2::text[])`, [accountId, HOLD_STATUSES]);
  return rows[0].held;
}
export async function balances(q, accountId) {
  const [ledger, held] = await Promise.all([ledgerBalance(q, accountId), holdsTotal(q, accountId)]);
  return { ledger, held, available: ledger - held };
}

/**
 * Creates an account with a generated, unique number. Uses ON CONFLICT DO NOTHING so a collision never raises an error
 * (an error would abort the caller's transaction); we simply draw another number. `generate` is injectable for tests.
 */
export async function createAccount(q, { userId = null, kind = 'customer', type = 'checking', name, currency, status = 'pending_review', accountNumber, generate = newAccountNumber }) {
  for (let i = 0; i < 12; i++) {
    const number = accountNumber ?? generate();
    const { rows } = await q.query(
      `INSERT INTO accounts (user_id, kind, account_number, type, name, currency, status) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING RETURNING *`,
      [userId, kind, number, type, name, currency, status]);
    if (rows[0]) return rows[0];
    if (accountNumber) throw new Error('Account number already in use');
  }
  throw new Error('Could not allocate a unique account number');
}

export async function getOrCreateFundingAccount(q, currency) {
  const number = `EWBSYS-FUNDING-${currency}`;
  // ON CONFLICT keeps this safe under concurrency without aborting the surrounding transaction.
  await q.query(
    `INSERT INTO accounts (user_id, kind, account_number, type, name, currency, status)
     VALUES (NULL,'system',$1,'system',$2,$3,'active') ON CONFLICT (account_number) DO NOTHING`,
    [number, `Internal test-ledger funding (${currency})`, currency]);
  const { rows } = await q.query('SELECT * FROM accounts WHERE account_number=$1', [number]);
  return rows[0];
}

export async function insertTransaction(q, t) {
  const { rows } = await q.query(
    `INSERT INTO transactions (reference, type, status, amount, currency, account_id, counterparty_account_id, initiated_by, description, reason, idempotency_key, reverses_transaction_id, metadata, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING *`,
    [newReference(), t.type, t.status, t.amount, t.currency, t.accountId, t.counterpartyAccountId ?? null, t.initiatedBy, t.description ?? null,
      t.reason ?? null, t.idempotencyKey ?? null, t.reversesTransactionId ?? null, JSON.stringify(t.metadata ?? {}), t.status === 'completed' ? new Date() : null]);
  return rows[0];
}

// The caller must hold a row lock on the account (see lockAccounts) so seq / balance_after cannot race.
export async function postEntry(q, { account, transactionId, entryType, direction, amount, description }) {
  const { rows: last } = await q.query('SELECT seq, balance_after FROM ledger_entries WHERE account_id=$1 ORDER BY seq DESC LIMIT 1', [account.id]);
  const prevSeq = last[0]?.seq ?? 0;
  const prevBal = last[0]?.balance_after ?? 0;
  const next = direction === 'credit' ? prevBal + amount : prevBal - amount;
  const { rows } = await q.query(
    `INSERT INTO ledger_entries (account_id, transaction_id, seq, entry_type, direction, amount, currency, balance_after, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [account.id, transactionId, prevSeq + 1, entryType, direction, amount, account.currency, next, description ?? null]);
  return rows[0];
}

// Integrity check used by tests and the admin tooling: running balances must equal the derived sum,
// and sequence numbers must be gapless.
export async function verifyIntegrity(q, accountId) {
  const { rows } = await q.query('SELECT seq, direction, amount, balance_after FROM ledger_entries WHERE account_id=$1 ORDER BY seq', [accountId]);
  let bal = 0;
  let expectedSeq = 1;
  for (const r of rows) {
    if (r.seq !== expectedSeq++) return { ok: false, reason: `sequence gap at ${r.seq}` };
    bal += r.direction === 'credit' ? r.amount : -r.amount;
    if (bal !== r.balance_after) return { ok: false, reason: `running balance mismatch at seq ${r.seq}` };
  }
  return { ok: true, balance: bal, entries: rows.length };
}
