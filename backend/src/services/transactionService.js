import { getDb } from '../db/index.js';
import { notFound } from '../utils/errors.js';
import { mask } from './ledgerService.js';

const dto = (r) => ({
  id: r.id,
  reference: r.reference,
  type: r.type,
  status: r.status,
  amount: r.amount,
  currency: r.currency,
  direction: r.direction || (r.type === 'withdrawal' ? 'debit' : null),
  balanceAfter: r.balance_after ?? null,
  description: r.description,
  accountId: r.entry_account_id || r.account_id,
  counterparty: r.counterparty_number ? mask(r.counterparty_number) : null,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  hasLedgerEntries: r.direction != null,
});

/**
 * Transactions visible to a customer = those touching one of THEIR accounts, via ledger entries (money
 * that moved) or as the primary account (requests that moved nothing, e.g. withdrawals). The user id always
 * comes from the authenticated session.
 */
export async function listForUser(userId, f = {}) {
  const db = getDb();
  const p = [userId];
  const w = [];
  const add = (s, v) => { p.push(v); w.push(s.replaceAll('?', `$${p.length}`)); };
  if (f.accountId) add('(e.account_id = ? OR (e.id IS NULL AND t.account_id = ?))', f.accountId);
  if (f.type) add('t.type = ?', f.type);
  if (f.status) add('t.status = ?', f.status);
  if (f.from) add("t.created_at >= ((?::date)::timestamp AT TIME ZONE 'UTC')", f.from);
  if (f.to) add("t.created_at < (((?::date) + 1)::timestamp AT TIME ZONE 'UTC')", f.to);
  if (f.q) add('(t.reference ILIKE ? OR t.description ILIKE ?)', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
  const where = w.length ? `AND ${w.join(' AND ')}` : '';
  const base = `FROM transactions t
    JOIN accounts a ON a.user_id = $1
    LEFT JOIN ledger_entries e ON e.transaction_id = t.id AND e.account_id = a.id
    WHERE (e.id IS NOT NULL OR (t.account_id = a.id AND t.type = 'withdrawal')) ${where}`;
  const limit = Math.min(Number(f.limit) || 25, 100);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const { rows } = await db.query(
    `SELECT t.*, e.direction, e.balance_after, e.account_id AS entry_account_id,
            (SELECT account_number FROM accounts c WHERE c.id = CASE WHEN t.account_id = a.id THEN t.counterparty_account_id ELSE t.account_id END) AS counterparty_number
     ${base} ORDER BY t.created_at DESC, t.id LIMIT ${limit} OFFSET ${offset}`, p);
  const total = (await db.query(`SELECT count(*)::bigint AS n ${base}`, p)).rows[0].n;
  return { items: rows.map(dto), total };
}

export async function getForUser(userId, transactionId) {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT t.*, e.direction, e.balance_after, e.account_id AS entry_account_id,
            (SELECT account_number FROM accounts c WHERE c.id = CASE WHEN t.account_id = a.id THEN t.counterparty_account_id ELSE t.account_id END) AS counterparty_number
     FROM transactions t JOIN accounts a ON a.user_id = $1
     LEFT JOIN ledger_entries e ON e.transaction_id = t.id AND e.account_id = a.id
     WHERE t.id = $2 AND (e.id IS NOT NULL OR (t.account_id = a.id AND t.type = 'withdrawal')) LIMIT 1`, [userId, transactionId]);
  if (!rows[0]) throw notFound('Transaction not found.');
  const t = rows[0];
  const { rows: entries } = await db.query(
    'SELECT id, seq, entry_type, direction, amount, currency, balance_after, description, created_at FROM ledger_entries WHERE transaction_id=$1 AND account_id IN (SELECT id FROM accounts WHERE user_id=$2) ORDER BY seq', [transactionId, userId]);
  const note = t.type === 'withdrawal'
    ? 'This is a withdrawal request. No funds have been sent to an external account.'
    : null;
  return { ...dto(t), note, entries: entries.map((e) => ({ id: e.id, entryType: e.entry_type, direction: e.direction, amount: e.amount, balanceAfter: e.balance_after, description: e.description, createdAt: e.created_at })) };
}

/** Staff view of an account's transactions (permission-checked by the route). */
export async function listForAccount(accountId, { limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT t.*, e.direction, e.balance_after, e.account_id AS entry_account_id, NULL::text AS counterparty_number
     FROM transactions t LEFT JOIN ledger_entries e ON e.transaction_id = t.id AND e.account_id = $1
     WHERE e.id IS NOT NULL OR t.account_id = $1 ORDER BY t.created_at DESC LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(offset, 0)}`, [accountId]);
  return rows.map(dto);
}
