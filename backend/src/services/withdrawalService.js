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
// What the customer is told for each real status. Only statuses the backend has actually set produce a message about review;
// "contact Customer Support" appears only where staff have set a status that genuinely needs a conversation.
export const MESSAGES = {
  requested: 'Your withdrawal request has been received and is waiting to be processed. No funds have been sent yet. We will notify you when its status changes.',
  under_review: 'Your account is undergoing an additional security review. Some transactions may require verification before they can be completed. We will notify you when the review is complete. No funds have been sent yet.',
  additional_verification_required: 'Your withdrawal is awaiting security verification. Complete identity verification so we can continue; we will notify you when it is reviewed. No funds have been sent yet.',
  customer_support_required: 'Our team needs to speak with you about this request before it can continue. Please open a Customer Support request. No funds have been sent.',
  approved: 'Your request has been approved. We will show any further status updates here.',
  rejected: 'Your request was not approved. If you have questions you can open a Customer Support request.',
  cancelled: 'This request was cancelled.',
};
export const CUSTOMER_MESSAGE = MESSAGES.requested; // kept for older callers
const OPEN = ['requested', 'under_review', 'additional_verification_required', 'customer_support_required'];

const dto = (w) => ({
  id: w.id, reference: w.reference, accountId: w.account_id, amount: w.amount, currency: w.currency,
  destination: { bankName: w.destination_bank_name, accountName: w.destination_account_name, last4: w.destination_last4 },
  status: w.status, statusLabel: STATUS_LABELS[w.status], note: w.user_note, createdAt: w.created_at, updatedAt: w.updated_at,
  customerMessage: MESSAGES[w.status] || MESSAGES.requested,
});

/** Returns the withdrawal created for an earlier request with the same idempotency key, if any. */
async function findByKey(q, userId, key) {
  if (!key) return null;
  const { rows } = await q.query(
    `SELECT w.* FROM withdrawal_requests w JOIN transactions t ON t.id = w.transaction_id WHERE w.user_id = $1 AND t.idempotency_key = $2`, [userId, key]);
  return rows[0] || null;
}

export async function create(ctx, input) {
  const db = getDb();
  const prior = await findByKey(db, ctx.actor.id, input.idempotencyKey);
  if (prior) return { withdrawal: dto(prior), message: dto(prior).customerMessage, replayed: true };
  try {
    return await createOnce(ctx, input);
  } catch (e) {
    // Two identical submissions raced: the unique (user, key) index let exactly one through. Answer the loser with the winner.
    if (e?.code === '23505' && input.idempotencyKey) {
      const winner = await findByKey(db, ctx.actor.id, input.idempotencyKey);
      if (winner) return { withdrawal: dto(winner), message: dto(winner).customerMessage, replayed: true };
    }
    throw e;
  }
}

async function createOnce(ctx, { accountId, amountMinor, bankName, accountName, last4, note, idempotencyKey }) {
  const db = getDb();
  const userId = ctx.actor.id;
  const out = await db.tx(async (t) => {
    const { rows: ur } = await t.query('SELECT id, status, verification_status, first_name FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const user = ur[0];
    if (user.status !== 'active') throw forbidden('Withdrawal requests are unavailable while your profile is restricted.', 'ACCOUNT_RESTRICTED');
    const { rows: ar } = await t.query('SELECT * FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE', [accountId, userId]);
    const account = ar[0];
    if (!account) throw notFound('Account not found.');
    if (account.status !== 'active') throw conflict('This account is not active, so withdrawal requests are unavailable.', 'ACCOUNT_NOT_ACTIVE');
    const open = (await t.query("SELECT count(*)::bigint n FROM withdrawal_requests WHERE user_id=$1 AND status = ANY($2::text[])", [userId, OPEN])).rows[0].n;
    if (open >= 5) throw conflict('You already have several open withdrawal requests. Please wait for one to be completed or cancel one first.', 'TOO_MANY_OPEN_REQUESTS');
    const { available } = await L.balances(t, accountId);
    if (amountMinor > available) throw badRequest('The requested amount exceeds your available balance.');

    const verified = user.verification_status === 'verified';
    // Decided here, on the server, under the account row lock: identity not verified -> awaiting verification;
    // account under security review -> under review; otherwise the normal flow.
    const underReview = !!account.security_review_at;
    const status = !verified ? 'additional_verification_required' : underReview ? 'under_review' : 'requested';
    const reference = newReference('WDR');
    const tx = await L.insertTransaction(t, {
      type: 'withdrawal', status: verified ? 'pending' : 'blocked', amount: amountMinor, currency: account.currency, accountId, initiatedBy: userId,
      description: 'Withdrawal request (no funds sent)', idempotencyKey, metadata: { withdrawalReference: reference },
    });
    const { rows } = await t.query(
      `INSERT INTO withdrawal_requests (reference, user_id, account_id, transaction_id, amount, currency, destination_bank_name, destination_account_name, destination_last4, user_note, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [reference, userId, accountId, tx.id, amountMinor, account.currency, bankName, accountName, last4, note ?? null, status]);
    await audit.record(t, ctx, { action: 'withdrawal.request', targetType: 'withdrawal', targetId: rows[0].id, accountId, next: { status, amountMinor }, metadata: { reference, verified, underReview } });
    const recent = (await t.query("SELECT count(*)::bigint n FROM withdrawal_requests WHERE user_id=$1 AND created_at > now() - interval '24 hours'", [userId])).rows[0].n;
    return { w: rows[0], user, verified, underReview, recent, tx };
  });

  if (out.recent >= config.ledger.withdrawalAttemptAlertThreshold) {
    await security.record(db, { userId, type: 'repeated_withdrawal_attempts', severity: 'low', summary: `${out.recent} withdrawal requests in 24 hours (for review; not an accusation)`, ip: ctx.ip, sessionId: ctx.sessionId });
  }
  const base = { firstName: out.user.first_name, amount: amountMinor, currency: out.w.currency, reference: out.w.reference, statusLabel: STATUS_LABELS[out.w.status] };
  await notify(userId, {
    category: 'withdrawal', title: !out.verified ? 'Withdrawal awaiting security verification' : out.underReview ? 'Withdrawal pending security review' : 'Withdrawal request received', link: '/app/withdrawals',
    body: !out.verified ? `Request ${out.w.reference} is awaiting security verification. No funds have been sent.`
      : out.underReview ? `Request ${out.w.reference} for ${formatMinor(amountMinor, out.w.currency)} is pending an additional security review. No funds have been sent.`
      : `Request ${out.w.reference} for ${formatMinor(amountMinor, out.w.currency)} was received. No funds have been sent yet.`,
    email: { template: out.verified ? 'withdrawal_received' : 'withdrawal_blocked', data: { ...base, message: dto(out.w).customerMessage.replace(/\s*No funds have been sent( yet)?\.?/i, '').trim() } },
  });
  return { withdrawal: dto(out.w), message: dto(out.w).customerMessage };
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
      const rev = (await t.query('SELECT security_review_at FROM accounts WHERE id=$1 FOR UPDATE', [cur.account_id])).rows[0];
      if (rev?.security_review_at) throw conflict('This account is under additional security review. Clear the review before approving a withdrawal.', 'ACCOUNT_UNDER_REVIEW');
      const { ledger, held } = await L.balances(t, cur.account_id);
      if (ledger < held) throw conflict('Your balance does not cover this and your other open requests.', 'INSUFFICIENT_FUNDS');
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


// ───────────────────────── account security review (staff) ─────────────────────────
/**
 * Places an account under, or clears it from, additional security review. Open "requested" withdrawals on a flagged account move
 * to "under_review" so nothing waiting can slip through. Other accounts (including the customer's other accounts and other
 * customers) are not affected. Clearing does NOT approve anything: waiting requests keep their status until staff decide them.
 */
export async function setSecurityReview(ctx, accountId, { enabled, reason }) {
  const db = getDb();
  const out = await db.tx(async (t) => {
    const { rows } = await t.query("SELECT * FROM accounts WHERE id=$1 AND kind='customer' FOR UPDATE", [accountId]);
    const a = rows[0];
    if (!a) throw notFound('Account not found.');
    if (!!a.security_review_at === !!enabled) throw conflict(enabled ? 'This account is already under security review.' : 'This account is not under security review.', 'NO_CHANGE');
    await t.query('UPDATE accounts SET security_review_at=$2, security_review_reason=$3 WHERE id=$1', [accountId, enabled ? new Date() : null, enabled ? reason : null]);
    let moved = 0;
    if (enabled) {
      const r = await t.query("UPDATE withdrawal_requests SET status='under_review', updated_at=now() WHERE account_id=$1 AND status='requested' RETURNING id", [accountId]);
      moved = r.rows.length;
    }
    await audit.record(t, ctx, { action: enabled ? 'account.security_review_start' : 'account.security_review_clear', targetType: 'account', targetId: accountId, accountId, reason, previous: { underReview: !!a.security_review_at }, next: { underReview: !!enabled }, metadata: { withdrawalsMoved: moved } });
    return { a, moved };
  });
  await notify(out.a.user_id, enabled
    ? { category: 'account', title: 'Additional security review', link: '/app/withdrawals', body: 'Your account is undergoing an additional security review to help protect it. Some transactions may require verification before they can be completed. We will notify you when the review is complete.' }
    : { category: 'account', title: 'Security review complete', link: '/app/withdrawals', body: 'The additional security review on your account is complete.' });
  return { accountId, underReview: !!enabled, withdrawalsMoved: out.moved };
}
