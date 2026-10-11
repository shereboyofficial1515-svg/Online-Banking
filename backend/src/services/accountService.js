import { getDb } from '../db/index.js';
import config from '../config/index.js';
import * as L from '../repositories/ledger.js';
import * as audit from './auditService.js';
import { conflict, notFound } from '../utils/errors.js';
import { mask } from './ledgerService.js';
import { assertSavingsEnabled } from './featureService.js';

export const accountDto = (a, b) => ({
  id: a.id,
  accountNumber: a.account_number,
  accountNumberMasked: mask(a.account_number),
  type: a.type,
  name: a.name,
  currency: a.currency,
  status: a.status,
  createdAt: a.created_at,
  securityReview: !!a.security_review_at, // boolean only; the staff reason is never sent to customers
  ...(b ? { balance: b.ledger, availableBalance: b.available, heldAmount: b.held } : {}),
});

/** Create the first checking account during registration (pending compliance review). */
export async function openDefaultAccount(q, userId) {
  return L.createAccount(q, { userId, type: 'checking', name: 'EWB Checking', currency: config.ledger.defaultCurrency, status: 'pending_review' });
}

export async function listForUser(userId) {
  const db = getDb();
  const { rows } = await db.query("SELECT * FROM accounts WHERE user_id=$1 AND kind='customer' ORDER BY created_at", [userId]);
  return Promise.all(rows.map(async (a) => accountDto(a, await L.balances(db, a.id))));
}

/** Ownership is enforced in SQL: the account id from the URL is only ever resolved together with the session's user id. */
export async function getOwned(userId, accountId) {
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM accounts WHERE id=$1 AND user_id=$2', [accountId, userId]);
  if (!rows[0]) throw notFound('Account not found.');
  return accountDto(rows[0], await L.balances(db, accountId));
}

export async function openAdditional(ctx, { type, name }) {
  if (type === 'savings') await assertSavingsEnabled(); // management controls when savings becomes available
  const db = getDb();
  const userId = ctx.actor.id;
  return db.tx(async (t) => {
    const { rows } = await t.query("SELECT status FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (rows[0]?.status !== 'active') throw conflict('Your profile is not eligible to open another account.');
    const count = (await t.query("SELECT count(*)::bigint n FROM accounts WHERE user_id=$1 AND status <> 'closed'", [userId])).rows[0].n;
    if (count >= 3) throw conflict('You have reached the maximum number of accounts.', 'ACCOUNT_LIMIT');
    const { rows: primary } = await t.query("SELECT status FROM accounts WHERE user_id=$1 AND kind='customer' ORDER BY created_at LIMIT 1", [userId]);
    if (primary[0]?.status !== 'active') throw conflict('Your primary account must be approved before opening another.', 'ACCOUNT_NOT_ACTIVE');
    const acct = await L.createAccount(t, { userId, type, name: name || (type === 'savings' ? 'EWB Savings' : 'EWB Checking'), currency: config.ledger.defaultCurrency, status: 'active' });
    await audit.record(t, ctx, { action: 'account.open', targetType: 'account', targetId: acct.id, accountId: acct.id, next: { type } });
    return accountDto(acct, { ledger: 0, available: 0, held: 0 });
  });
}

/** Balance history (running balance per entry) and monthly in/out for charts. All derived from ledger entries. */
export async function summary(userId, accountId) {
  const db = getDb();
  const acct = await getOwned(userId, accountId);
  const { rows: history } = await db.query(
    'SELECT created_at, balance_after FROM (SELECT created_at, balance_after, seq FROM ledger_entries WHERE account_id=$1 ORDER BY seq DESC LIMIT 60) s ORDER BY seq', [accountId]);
  const { rows: monthly } = await db.query(
    `SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month,
            COALESCE(SUM(amount) FILTER (WHERE direction='credit'),0)::bigint AS money_in,
            COALESCE(SUM(amount) FILTER (WHERE direction='debit'),0)::bigint AS money_out
     FROM ledger_entries WHERE account_id=$1 AND created_at >= date_trunc('month', now()) - interval '5 months'
     GROUP BY 1 ORDER BY 1`, [accountId]);
  return {
    account: acct,
    history: history.map((h) => ({ at: h.created_at, balance: h.balance_after })),
    monthly: monthly.map((m) => ({ month: m.month, in: m.money_in, out: m.money_out })),
  };
}
