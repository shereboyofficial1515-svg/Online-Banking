// Business rules for moving value inside the internal software ledger.
// No function in this module can contact an external bank or payment network; see providers/regulated.js.
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as L from '../repositories/ledger.js';
import * as audit from './auditService.js';
import { assertSavingsEnabled } from './featureService.js';
import * as security from './securityEventService.js';
import { notify } from './notificationService.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { formatMinor } from '../utils/money.js';

export const mask = (n) => `••••${String(n).slice(-4)}`;
const insufficient = (e) => /insufficient funds/i.test(e?.message || '');

async function replay(q, actorId, key) {
  if (!key) return null;
  const { rows } = await q.query('SELECT * FROM transactions WHERE initiated_by=$1 AND idempotency_key=$2', [actorId, key]);
  return rows[0] || null;
}

/**
 * Staff-initiated ledger adjustment. Balances are never edited: this appends a transaction plus a
 * balanced pair of ledger entries (customer account <-> internal funding account), then re-derives
 * the balance from entries. MFA step-up and permission checks happen before this is called.
 */
export async function adjust(ctx, { accountId, direction, amountMinor, currency, reason, idempotencyKey }) {
  if (!['credit', 'debit'].includes(direction)) throw badRequest('Invalid direction.');
  if (amountMinor > config.ledger.maxAdjustmentMinor) throw badRequest('Amount exceeds the configured maximum for a single adjustment.');
  const db = getDb();
  const actorId = ctx.actor.id;

  const result = await db.tx(async (t) => {
    const prior = await replay(t, actorId, idempotencyKey);
    if (prior) return { replayed: true, transaction: prior };

    const { rows: pre } = await t.query('SELECT id, currency FROM accounts WHERE id=$1', [accountId]);
    if (!pre[0]) throw notFound('Account not found.');
    const funding = await L.getOrCreateFundingAccount(t, pre[0].currency);
    const locked = await L.lockAccounts(t, [accountId, funding.id]);
    const account = locked.get(accountId);
    const fundingAcct = locked.get(funding.id);
    if (account.kind !== 'customer') throw forbidden('System accounts cannot be adjusted.');
    if (account.currency !== currency) throw badRequest(`Currency must match the account currency (${account.currency}).`);
    if (account.status !== 'active') throw conflict('Ledger adjustments require an active account.', 'ACCOUNT_NOT_ACTIVE');

    const before = await L.ledgerBalance(t, accountId);
    if (direction === 'debit') {
      const { available } = await L.balances(t, accountId);
      if (available < amountMinor) throw conflict('Insufficient available balance for this debit adjustment.', 'INSUFFICIENT_FUNDS');
    }
    const tx = await L.insertTransaction(t, {
      type: direction === 'credit' ? 'ledger_credit' : 'ledger_debit', status: 'completed', amount: amountMinor, currency,
      accountId, counterpartyAccountId: fundingAcct.id, initiatedBy: actorId, reason, idempotencyKey,
      description: direction === 'credit' ? 'Account credit' : 'Account debit adjustment',
      metadata: { adjustment: true, note: 'Ledger adjustment recorded by authorised staff.' },
    });
    const desc = `${tx.description} (${tx.reference})`;
    await L.postEntry(t, { account, transactionId: tx.id, entryType: 'admin_adjustment', direction, amount: amountMinor, description: desc });
    await L.postEntry(t, { account: fundingAcct, transactionId: tx.id, entryType: 'funding_contra', direction: direction === 'credit' ? 'debit' : 'credit', amount: amountMinor, description: desc });
    const after = await L.ledgerBalance(t, accountId); // recalculated from entries, never trusted from input

    await audit.record(t, ctx, {
      action: `ledger.${direction}`, targetType: 'account', targetId: accountId, accountId,
      previous: { ledgerBalance: before }, next: { ledgerBalance: after }, reason,
      metadata: { reference: tx.reference, amountMinor, currency, transactionId: tx.id },
    });
    const large = amountMinor >= config.ledger.largeAdjustmentMinor;
    const evt = await security.record(t, {
      userId: account.user_id, type: large ? 'large_ledger_adjustment' : 'admin_financial_action', severity: large ? 'high' : 'info',
      summary: `${large ? 'Large l' : 'L'}edger ${direction} of ${formatMinor(amountMinor, currency)} posted by staff`, ip: ctx.ip, sessionId: ctx.sessionId,
      details: { reference: tx.reference, adminId: actorId },
    });
    return { replayed: false, transaction: tx, account, before, after, largeEvent: large ? evt : null };
  }).catch((e) => { throw insufficient(e) ? conflict('Insufficient funds.', 'INSUFFICIENT_FUNDS') : e; });

  if (!result.replayed) {
    const { account, transaction } = result;
    if (result.largeEvent) security.alertAdmins(result.largeEvent).catch(() => {}); // staff alert only once the adjustment has committed
    await notify(account.user_id, {
      category: 'transaction', title: `${direction === 'credit' ? 'Credit' : 'Debit'} posted to your account`, link: `/app/transactions/${transaction.id}`,
      body: `${formatMinor(amountMinor, currency)} ${direction} on account ${mask(account.account_number)}. Reference ${transaction.reference}.`,
      email: { template: 'ledger_adjustment', data: { firstName: await firstName(account.user_id), direction, amount: amountMinor, currency, reference: transaction.reference, accountMasked: mask(account.account_number), description: transaction.description, time: new Date().toUTCString() } },
    });
  }
  return result;
}

async function firstName(userId) {
  const { rows } = await getDb().query('SELECT first_name FROM users WHERE id=$1', [userId]);
  return rows[0]?.first_name;
}

/** Reverse a completed transaction by appending compensating entries; the original is marked reversed. */
export async function reverse(ctx, { transactionId, reason }) {
  const db = getDb();
  const out = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [transactionId]);
    const orig = rows[0];
    if (!orig) throw notFound('Transaction not found.');
    if (orig.status !== 'completed') throw conflict('Only completed transactions can be reversed.', 'NOT_REVERSIBLE');
    if (!['ledger_credit', 'ledger_debit', 'transfer'].includes(orig.type)) throw conflict('This transaction type cannot be reversed.', 'NOT_REVERSIBLE');
    const { rows: entries } = await t.query('SELECT * FROM ledger_entries WHERE transaction_id=$1 ORDER BY seq', [transactionId]);
    const locked = await L.lockAccounts(t, entries.map((e) => e.account_id));
    const rev = await L.insertTransaction(t, {
      type: 'reversal', status: 'completed', amount: orig.amount, currency: orig.currency, accountId: orig.account_id,
      counterpartyAccountId: orig.counterparty_account_id, initiatedBy: ctx.actor.id, reason, reversesTransactionId: orig.id,
      description: `Reversal of ${orig.reference}`,
    });
    for (const e of entries) {
      await L.postEntry(t, {
        account: locked.get(e.account_id), transactionId: rev.id, entryType: 'reversal',
        direction: e.direction === 'credit' ? 'debit' : 'credit', amount: e.amount, description: `Reversal of ${orig.reference}`,
      });
    }
    await t.query("UPDATE transactions SET status='reversed' WHERE id=$1", [orig.id]);
    await audit.record(t, ctx, {
      action: 'ledger.reverse', targetType: 'transaction', targetId: orig.id, accountId: orig.account_id,
      previous: { status: 'completed' }, next: { status: 'reversed', reversalReference: rev.reference }, reason, metadata: { reference: orig.reference },
    });
    await security.record(t, { type: 'admin_financial_action', severity: 'info', summary: `Transaction ${orig.reference} reversed by staff`, ip: ctx.ip, sessionId: ctx.sessionId, details: { adminId: ctx.actor.id } });
    return { original: orig, reversal: rev, entries };
  }).catch((e) => { throw insufficient(e) ? conflict('Reversal would overdraw a customer account.', 'INSUFFICIENT_FUNDS') : e; });

  for (const accountId of new Set(out.entries.map((e) => e.account_id))) {
    const { rows } = await db.query('SELECT user_id FROM accounts WHERE id=$1 AND kind=$2', [accountId, 'customer']);
    if (rows[0]) {
      await notify(rows[0].user_id, { category: 'transaction', title: 'Transaction reversed', body: `Transaction ${out.original.reference} was reversed. Reference ${out.reversal.reference}.`, link: `/app/transactions/${out.reversal.id}` });
    }
  }
  return out;
}

/** Customer-initiated transfer between two EWB ledger accounts. The authenticated user is the only source of ownership. */
export async function transfer(ctx, { fromAccountId, toAccountNumber, amountMinor, description, idempotencyKey }) {
  const db = getDb();
  const userId = ctx.actor.id;
  if (amountMinor > config.ledger.maxTransferMinor) throw badRequest(`Transfers are limited to ${formatMinor(config.ledger.maxTransferMinor, config.ledger.defaultCurrency)} per transaction.`);

  const { rows: urows } = await db.query('SELECT verification_status, status FROM users WHERE id=$1', [userId]);
  if (urows[0]?.verification_status !== 'verified') throw forbidden('Identity verification is required before you can make transfers.', 'VERIFICATION_REQUIRED');

  const out = await db.tx(async (t) => {
    const prior = await replay(t, userId, idempotencyKey);
    if (prior) return { replayed: true, transaction: prior };
    const { rows: own } = await t.query('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [fromAccountId, userId]);
    if (!own[0]) throw notFound('Account not found.');
    const { rows: dest } = await t.query("SELECT id, type FROM accounts WHERE (account_number=$1 OR legacy_account_number=$1) AND kind='customer'", [toAccountNumber]);
    if (!dest[0]) throw notFound('The destination account was not found.');
    if (dest[0].type === 'savings') await assertSavingsEnabled(t); // new deposits into savings are paused while the feature is off; withdrawals from existing savings are not blocked
    if (dest[0].id === fromAccountId) throw badRequest('Choose a different destination account.');

    const locked = await L.lockAccounts(t, [fromAccountId, dest[0].id]);
    const from = locked.get(fromAccountId);
    const to = locked.get(dest[0].id);
    if (from.status !== 'active') throw conflict('Your account is not active, so transfers are unavailable.', 'ACCOUNT_NOT_ACTIVE');
    if (to.status !== 'active') throw conflict('The destination account cannot receive transfers right now.', 'DESTINATION_UNAVAILABLE');
    if (from.currency !== to.currency) throw badRequest('Transfers between different currencies are not supported.');

    const { available } = await L.balances(t, fromAccountId);
    if (available < amountMinor) throw conflict('Insufficient available balance.', 'INSUFFICIENT_FUNDS');

    const tx = await L.insertTransaction(t, {
      type: 'transfer', status: 'completed', amount: amountMinor, currency: from.currency, accountId: from.id, counterpartyAccountId: to.id,
      initiatedBy: userId, description: description || 'Transfer', idempotencyKey,
    });
    const d = `${tx.description} (${tx.reference})`;
    await L.postEntry(t, { account: from, transactionId: tx.id, entryType: 'transfer_out', direction: 'debit', amount: amountMinor, description: d });
    await L.postEntry(t, { account: to, transactionId: tx.id, entryType: 'transfer_in', direction: 'credit', amount: amountMinor, description: d });
    await audit.record(t, ctx, { action: 'transfer.create', targetType: 'transaction', targetId: tx.id, accountId: from.id, metadata: { reference: tx.reference, amountMinor, toAccount: mask(to.account_number) } });
    return { replayed: false, transaction: tx, from, to };
  }).catch((e) => { throw insufficient(e) ? conflict('Insufficient available balance.', 'INSUFFICIENT_FUNDS') : e; });

  if (!out.replayed) {
    const { transaction: tx, from, to } = out;
    const time = new Date().toUTCString();
    await notify(from.user_id, { category: 'transaction', title: 'Transfer completed', body: `${formatMinor(amountMinor, from.currency)} sent to ${mask(to.account_number)}. Reference ${tx.reference}.`, link: `/app/transactions/${tx.id}`, email: { template: 'transfer_receipt', data: { firstName: await firstName(from.user_id), role: 'sender', amount: amountMinor, currency: from.currency, reference: tx.reference, accountMasked: mask(to.account_number), time } } });
    await notify(to.user_id, { category: 'transaction', title: 'Transfer received', body: `${formatMinor(amountMinor, to.currency)} received from ${mask(from.account_number)}. Reference ${tx.reference}.`, link: `/app/transactions/${tx.id}`, email: { template: 'transfer_receipt', data: { firstName: await firstName(to.user_id), role: 'receiver', amount: amountMinor, currency: to.currency, reference: tx.reference, accountMasked: mask(from.account_number), time } } });
  }
  return out;
}
