// Withdrawals are REQUESTS for staff processing only. This module never moves money: it creates no ledger
// entries and has no code path to PaymentProvider/BankingProvider. "Approved" means approved in the internal
// test workflow; the UI and emails say explicitly that no external transfer has been performed.
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as L from '../repositories/ledger.js';
import * as audit from './auditService.js';
import * as security from './securityEventService.js';
import { notify } from './notificationService.js';
import { newReference } from '../utils/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { formatMinor } from '../utils/money.js';

export const STATUS_LABELS = {
  requested: 'Requested', under_review: 'Under review', additional_verification_required: 'Additional verification required',
  customer_support_required: 'Customer support required', approved: 'Approved (internal)', rejected: 'Rejected', cancelled: 'Cancelled',
};
export const CUSTOMER_MESSAGE = 'Your withdrawal request requires additional account review. Please contact EWB Bank Customer Support for assistance with your account. No funds have been sent.';
const OPEN = ['requested', 'under_review', 'additional_verification_required', 'customer_support_required'];

const dto = (w) => ({
  id: w.id, reference: w.reference, accountId: w.account_id, amount: w.amount, currency: w.currency,
  destination: { bankName: w.destination_bank_name, accountName: w.destination_account_name, last4: w.destination_last4 },
  status: w.status, statusLabel: STATUS_LABELS[w.status], note: w.user_note, createdAt: w.created_at, updatedAt: w.updated_at,
  customerMessage: w.status === 'approved'
    ? 'Your request was approved in the internal review workflow. External bank transfers are not enabled, so no funds have been sent. Please contact EWB Bank Customer Support.'
    : w.status === 'rejected' ? 'Your request was not approved. Please contact EWB Bank Customer Support for details.'
    : w.status === 'cancelled' ? 'This request was cancelled.' : CUSTOMER_MESSAGE,
});

export async function create(ctx, { accountId, amountMinor, bankName, accountName, last4, note }) {
  const db = getDb();
  const userId = ctx.actor.id;
  const out = await db.tx(async (t) => {
    const { rows: ur } = await t.query('SELECT id, status, verification_status, first_name FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const user = ur[0];
    if (user.status !== 'active') throw forbidden('Withdrawal requests are unavailable while your account is restricted. Please contact customer support.', 'ACCOUNT_RESTRICTED');
    const { rows: ar } = await t.query('SELECT * FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE', [accountId, userId]);
    const account = ar[0];
    if (!account) throw notFound('Account not found.');
    if (account.status !== 'active') throw conflict('This account is not active, so withdrawal requests are unavailable.', 'ACCOUNT_NOT_ACTIVE');
    const open = (await t.query("SELECT count(*)::bigint n FROM withdrawal_requests WHERE user_id=$1 AND status = ANY($2::text[])", [userId, OPEN])).rows[0].n;
    if (open >= 5) throw conflict('You already have several open withdrawal requests. Please contact customer support.', 'TOO_MANY_OPEN_REQUESTS');
    const { available } = await L.balances(t, accountId);
    if (amountMinor > available) throw badRequest('The requested amount exceeds your available balance.');

    const verified = user.verification_status === 'verified';
    const status = verified ? 'requested' : 'additional_verification_required';
    const reference = newReference('WDR');
    const tx = await L.insertTransaction(t, {
      type: 'withdrawal', status: verified ? 'pending' : 'blocked', amount: amountMinor, currency: account.currency, accountId, initiatedBy: userId,
      description: 'Withdrawal request (no funds sent)', metadata: { withdrawalReference: reference },
    });
    const { rows } = await t.query(
      `INSERT INTO withdrawal_requests (reference, user_id, account_id, transaction_id, amount, currency, destination_bank_name, destination_account_name, destination_last4, user_note, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [reference, userId, accountId, tx.id, amountMinor, account.currency, bankName, accountName, last4, note ?? null, status]);
    await audit.record(t, ctx, { action: 'withdrawal.request', targetType: 'withdrawal', targetId: rows[0].id, accountId, next: { status, amountMinor }, metadata: { reference, verified } });
    const recent = (await t.query("SELECT count(*)::bigint n FROM withdrawal_requests WHERE user_id=$1 AND created_at > now() - interval '24 hours'", [userId])).rows[0].n;
    return { w: rows[0], user, verified, recent, tx };
  });

  if (out.recent >= config.ledger.withdrawalAttemptAlertThreshold) {
    await security.record(db, { userId, type: 'repeated_withdrawal_attempts', severity: 'low', summary: `${out.recent} withdrawal requests in 24 hours (for review; not an accusation)`, ip: ctx.ip, sessionId: ctx.sessionId });
  }
  const base = { firstName: out.user.first_name, amount: amountMinor, currency: out.w.currency, reference: out.w.reference, statusLabel: STATUS_LABELS[out.w.status] };
  await notify(userId, {
    category: 'withdrawal', title: out.verified ? 'Withdrawal request received' : 'Withdrawal request on hold', link: '/app/withdrawals',
    body: out.verified ? `Request ${out.w.reference} for ${formatMinor(amountMinor, out.w.currency)} needs account review. No funds have been sent.` : `Request ${out.w.reference} is on hold until your identity is verified. No funds have been sent.`,
    email: out.verified ? { template: 'withdrawal_received', data: base } : { template: 'withdrawal_blocked', data: { ...base, message: 'Your request is on hold because identity verification is required before it can be reviewed.' } },
  });
  return { withdrawal: dto(out.w), message: CUSTOMER_MESSAGE };
}

export async function listForUser(userId) {
  const { rows } = await getDb().query('SELECT * FROM withdrawal_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]);
  return rows.map(dto);
}
export async function getForUser(userId, id) {
  const { rows } = await getDb().query('SELECT * FROM withdrawal_requests WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!rows[0]) throw notFound('Withdrawal request not found.');
  return dto(rows[0]);
}

export async function cancel(ctx, id) {
  const db = getDb();
  const w = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM withdrawal_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, ctx.actor.id]);
    const cur = rows[0];
    if (!cur) throw notFound('Withdrawal request not found.');
    if (!OPEN.includes(cur.status)) throw conflict('This request can no longer be cancelled.', 'NOT_CANCELLABLE');
    const { rows: up } = await t.query("UPDATE withdrawal_requests SET status='cancelled', updated_at=now() WHERE id=$1 RETURNING *", [id]);
    if (cur.transaction_id) await t.query("UPDATE transactions SET status='cancelled' WHERE id=$1 AND status IN ('pending','blocked')", [cur.transaction_id]);
    await audit.record(t, ctx, { action: 'withdrawal.cancel', targetType: 'withdrawal', targetId: id, accountId: cur.account_id, previous: { status: cur.status }, next: { status: 'cancelled' } });
    return up[0];
  });
  return dto(w);
}

// ───────────────────────── staff workflow ─────────────────────────
const TRANSITIONS = {
  start_review: { to: 'under_review', from: OPEN, perm: 'withdrawals.review' },
  request_verification: { to: 'additional_verification_required', from: OPEN, perm: 'withdrawals.review' },
  require_support: { to: 'customer_support_required', from: OPEN, perm: 'withdrawals.review' },
  approve: { to: 'approved', from: OPEN, perm: 'withdrawals.decide', reasonRequired: true },
  reject: { to: 'rejected', from: OPEN, perm: 'withdrawals.decide', reasonRequired: true },
};
export const TRANSITION_PERMISSIONS = Object.fromEntries(Object.entries(TRANSITIONS).map(([k, v]) => [k, v.perm]));

export async function adminList({ status, q, limit = 50, offset = 0 }) {
  const p = [];
  const w = [];
  if (status) { p.push(status); w.push(`w.status = $${p.length}`); }
  if (q) { p.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`); w.push(`(w.reference ILIKE $${p.length} OR u.email ILIKE $${p.length} OR u.last_name ILIKE $${p.length} OR u.first_name ILIKE $${p.length})`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const db = getDb();
  const { rows } = await db.query(
    `SELECT w.*, u.email, u.first_name, u.last_name, u.verification_status FROM withdrawal_requests w JOIN users u ON u.id = w.user_id ${where}
     ORDER BY w.created_at DESC LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(offset, 0)}`, p);
  const total = (await db.query(`SELECT count(*)::bigint n FROM withdrawal_requests w JOIN users u ON u.id = w.user_id ${where}`, p)).rows[0].n;
  return { total, items: rows.map((r) => ({ ...dto(r), customer: { id: r.user_id, email: r.email, name: `${r.first_name} ${r.last_name}`, verificationStatus: r.verification_status } })) };
}

export async function adminDetail(id) {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT w.*, u.email, u.first_name, u.last_name, u.verification_status, u.status AS user_status, a.account_number, a.status AS account_status
     FROM withdrawal_requests w JOIN users u ON u.id=w.user_id JOIN accounts a ON a.id=w.account_id WHERE w.id=$1`, [id]);
  const r = rows[0];
  if (!r) throw notFound('Withdrawal request not found.');
  const notes = (await db.query('SELECT n.id, n.note, n.created_at, u.email AS admin_email FROM withdrawal_notes n JOIN users u ON u.id=n.admin_id WHERE withdrawal_id=$1 ORDER BY n.created_at', [id])).rows;
  const history = (await db.query('SELECT id, reference, type, status, amount, currency, created_at FROM transactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 15', [r.account_id])).rows;
  return {
    ...dto(r),
    customer: { id: r.user_id, email: r.email, name: `${r.first_name} ${r.last_name}`, status: r.user_status, verificationStatus: r.verification_status },
    account: { id: r.account_id, number: r.account_number, status: r.account_status, balances: await L.balances(db, r.account_id) },
    decision: { by: r.decided_by, at: r.decided_at, reason: r.decision_reason },
    notes: notes.map((n) => ({ id: n.id, note: n.note, admin: n.admin_email, createdAt: n.created_at })),
    history,
    externalTransferNotice: 'No external bank transfer is performed by this system. Approval is an internal test-workflow state only.',
  };
}

export async function addNote(ctx, id, note) {
  const db = getDb();
  const { rows } = await db.query('SELECT account_id FROM withdrawal_requests WHERE id=$1', [id]);
  if (!rows[0]) throw notFound('Withdrawal request not found.');
  await db.tx(async (t) => {
    await t.query('INSERT INTO withdrawal_notes (withdrawal_id, admin_id, note) VALUES ($1,$2,$3)', [id, ctx.actor.id, note]);
    await audit.record(t, ctx, { action: 'withdrawal.note', targetType: 'withdrawal', targetId: id, accountId: rows[0].account_id, reason: note });
  });
}

export async function transition(ctx, id, action, reason) {
  const rule = TRANSITIONS[action];
  if (!rule) throw badRequest('Unknown action.');
  if (rule.reasonRequired && !reason) throw badRequest('A reason is required for this decision.');
  const db = getDb();
  const out = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM withdrawal_requests WHERE id=$1 FOR UPDATE', [id]);
    const cur = rows[0];
    if (!cur) throw notFound('Withdrawal request not found.');
    if (!rule.from.includes(cur.status)) throw conflict(`A request that is "${STATUS_LABELS[cur.status]}" cannot be changed this way.`, 'INVALID_TRANSITION');
    if (action === 'approve' || action === 'reject') {
      if (cur.user_id === ctx.actor.id) throw forbidden('You cannot decide your own request.', 'SELF_APPROVAL');
    }
    if (action === 'approve') {
      const { rows: ur } = await t.query('SELECT verification_status, status FROM users WHERE id=$1', [cur.user_id]);
      if (ur[0].verification_status !== 'verified') throw conflict('The customer must complete identity verification before approval.', 'VERIFICATION_REQUIRED');
      if (ur[0].status !== 'active') throw conflict('The customer account is restricted.', 'ACCOUNT_RESTRICTED');
      const { ledger, held } = await L.balances(t, cur.account_id);
      if (ledger < held) throw conflict('Insufficient ledger balance to cover this and other open requests.', 'INSUFFICIENT_FUNDS');
    }
    const decided = action === 'approve' || action === 'reject';
    const { rows: up } = await t.query(
      `UPDATE withdrawal_requests SET status=$2, updated_at=now(), decided_by=CASE WHEN $3 THEN $4::uuid ELSE decided_by END,
              decided_at=CASE WHEN $3 THEN now() ELSE decided_at END, decision_reason=CASE WHEN $3 THEN $5 ELSE decision_reason END WHERE id=$1 RETURNING *`,
      [id, rule.to, decided, ctx.actor.id, reason ?? null]);
    if (cur.transaction_id) {
      if (action === 'reject') await t.query("UPDATE transactions SET status='failed', completed_at=now() WHERE id=$1 AND status IN ('pending','blocked')", [cur.transaction_id]);
      else if (action === 'approve') await t.query("UPDATE transactions SET status='pending', description='Withdrawal approved internally; no external transfer performed' WHERE id=$1 AND status IN ('pending','blocked')", [cur.transaction_id]);
      else if (cur.status === 'additional_verification_required' && rule.to !== 'additional_verification_required') await t.query("UPDATE transactions SET status='pending' WHERE id=$1 AND status='blocked'", [cur.transaction_id]);
      else if (rule.to === 'additional_verification_required') await t.query("UPDATE transactions SET status='blocked' WHERE id=$1 AND status='pending'", [cur.transaction_id]);
    }
    await audit.record(t, ctx, { action: `withdrawal.${action}`, targetType: 'withdrawal', targetId: id, accountId: cur.account_id, previous: { status: cur.status }, next: { status: rule.to }, reason, metadata: { reference: cur.reference } });
    return { cur, w: up[0] };
  });
  const { rows: u } = await db.query('SELECT first_name FROM users WHERE id=$1', [out.w.user_id]);
  await notify(out.w.user_id, {
    category: 'withdrawal', title: `Withdrawal request: ${STATUS_LABELS[out.w.status]}`, link: '/app/withdrawals',
    body: `Request ${out.w.reference} is now "${STATUS_LABELS[out.w.status]}". No funds have been sent to an external account.`,
    email: { template: 'withdrawal_update', data: { firstName: u[0]?.first_name, amount: out.w.amount, currency: out.w.currency, reference: out.w.reference, statusLabel: STATUS_LABELS[out.w.status], message: dto(out.w).customerMessage } },
  });
  return dto(out.w);
}
