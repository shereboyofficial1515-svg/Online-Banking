// Customer account settings: verified email change, account display name, and the account-closure request workflow.
import { randomInt } from 'node:crypto';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as users from '../repositories/users.js';
import * as L from '../repositories/ledger.js';
import * as audit from './auditService.js';
import * as sessions from './sessionService.js';
import * as support from './supportService.js';
import { sendEmail } from './emailService.js';
import { notify } from './notificationService.js';
import { verifyPassword } from '../utils/passwords.js';
import { hmacSha256Hex, safeEqual } from '../utils/crypto.js';
import { badRequest, conflict, notFound, tooMany, validationError } from '../utils/errors.js';

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const hash = (userId, email, code) => hmacSha256Hex(`${config.auth.jwtRefreshSecret}:email-change`, `${userId}:${email}:${code}`);

// ───────── email change ─────────
export async function requestEmailChange(ctx, user, { newEmail, password }) {
  if (!(await verifyPassword(user.password_hash, password))) throw validationError({ password: ['Your password is incorrect.'] });
  const email = newEmail.trim().toLowerCase();
  if (email === user.email.toLowerCase()) throw validationError({ newEmail: ['That is already your email address.'] });
  const db = getDb();
  const recent = await db.query("SELECT 1 FROM email_change_requests WHERE user_id=$1 AND created_at > now() - interval '60 seconds'", [user.id]);
  if (recent.rows[0]) throw tooMany('A code was just sent. Please wait a minute before requesting another.');

  const taken = await users.findByEmail(db, email);
  if (taken) {
    // Same response as success so the form cannot be used to discover which addresses have profiles; the owner is told instead.
    await sendEmail({ to: taken.email, userId: taken.id, template: 'security_alert', data: { firstName: taken.first_name, title: 'Someone tried to use your email address', message: 'A request was made to use your email address on another EWB Bank profile. Nothing was changed on your profile.', time: new Date().toUTCString(), ip: ctx.ip } });
    return { sent: true, minutes: CODE_MINUTES };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.tx(async (t) => {
    await t.query('UPDATE email_change_requests SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [user.id]);
    await t.query('INSERT INTO email_change_requests (user_id, new_email, code_hash, expires_at) VALUES ($1,$2,$3,$4)', [user.id, email, hash(user.id, email, code), new Date(Date.now() + CODE_MINUTES * 60_000)]);
    await audit.record(t, ctx, { action: 'email_change.request', targetType: 'user', targetId: user.id });
  });
  await sendEmail({ to: email, userId: user.id, template: 'email_change', data: { firstName: user.first_name, code, minutes: CODE_MINUTES } });
  return { sent: true, minutes: CODE_MINUTES };
}

const wrong = () => badRequest('That code is incorrect or has expired. Please check it or request a new code.');

export async function confirmEmailChange(ctx, user, { code }) {
  const db = getDb();
  const outcome = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM email_change_requests WHERE user_id=$1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [user.id]);
    const req = rows[0];
    if (!req) return { ok: false };
    if (!safeEqual(req.code_hash, hash(user.id, req.new_email, code))) {
      const attempts = req.attempts + 1;
      await t.query('UPDATE email_change_requests SET attempts=$2::int, consumed_at = CASE WHEN $2::int >= $3::int THEN now() ELSE NULL END WHERE id=$1', [req.id, attempts, MAX_ATTEMPTS]);
      return { ok: false, exhausted: attempts >= MAX_ATTEMPTS };
    }
    try {
      await t.query('UPDATE users SET email=$2, email_verified_at=now(), updated_at=now() WHERE id=$1', [user.id, req.new_email]);
    } catch (e) {
      if (e?.code === '23505') return { ok: false, taken: true };
      throw e;
    }
    await t.query('UPDATE email_change_requests SET consumed_at=now() WHERE id=$1', [req.id]);
    await sessions.revokeAllForUser(t, user.id, { exceptSessionId: ctx.sessionId, reason: 'email_changed' });
    await audit.record(t, ctx, { action: 'email_change.confirm', targetType: 'user', targetId: user.id, previous: { email: user.email }, next: { email: req.new_email } });
    return { ok: true, newEmail: req.new_email };
  });
  if (outcome.taken) throw conflict('That email address can no longer be used. Please choose a different one.');
  if (!outcome.ok) throw outcome.exhausted ? badRequest('Too many incorrect attempts. Please request a new code.') : wrong();
  // the previous address is told about the change so a hijacked profile is noticed
  await sendEmail({ to: user.email, userId: user.id, template: 'security_alert', data: { firstName: user.first_name, title: 'Your email address was changed', message: `The email address on your EWB Bank profile was changed to ${outcome.newEmail}. If you did not do this, contact customer support immediately.`, time: new Date().toUTCString(), ip: ctx.ip } });
  await notify(user.id, { category: 'security', title: 'Email address changed', body: 'Your email address was updated and your other sessions were signed out.', link: '/app/settings/email' });
  const fresh = await users.findById(db, user.id);
  return users.toPublic(fresh);
}

// ───────── account display name ─────────
export async function renameAccount(ctx, user, accountId, name) {
  const db = getDb();
  const { rows } = await db.query("UPDATE accounts SET name=$3 WHERE id=$1 AND user_id=$2 AND kind='customer' RETURNING id, name", [accountId, user.id, name]);
  if (!rows[0]) throw notFound('Account not found.');
  await audit.record(db, ctx, { action: 'account.rename', targetType: 'account', targetId: accountId, accountId, next: { name } });
  return rows[0];
}

// ───────── account closure ─────────
const closureDto = (r) => (r ? { id: r.id, accountId: r.account_id, status: r.status, reason: r.reason, createdAt: r.created_at, resolvedAt: r.resolved_at, ticketId: r.ticket_id } : null);

export async function getClosure(userId, accountId) {
  const { rows } = await getDb().query('SELECT * FROM account_closure_requests WHERE user_id=$1 AND account_id=$2 ORDER BY created_at DESC LIMIT 1', [userId, accountId]);
  return closureDto(rows[0]);
}

export async function requestClosure(ctx, user, accountId, { reason, password }) {
  if (!(await verifyPassword(user.password_hash, password))) throw validationError({ password: ['Your password is incorrect.'] });
  const db = getDb();
  const acct = (await db.query("SELECT * FROM accounts WHERE id=$1 AND user_id=$2 AND kind='customer'", [accountId, user.id])).rows[0];
  if (!acct) throw notFound('Account not found.');
  if (acct.status === 'closed') throw conflict('This account is already closed.');
  const b = await L.balances(db, accountId);
  if (BigInt(b.ledger) !== 0n || BigInt(b.held) !== 0n) throw conflict('An account can only be closed when its balance is zero and nothing is on hold. Withdraw or transfer the remaining balance first, or contact customer support.', 'BALANCE_NOT_ZERO');
  const open = (await db.query('SELECT count(*)::int n FROM withdrawal_requests WHERE account_id=$1 AND status = ANY($2)', [accountId, L.HOLD_STATUSES])).rows[0].n;
  if (open) throw conflict('Finish or cancel your open withdrawal requests before closing this account.', 'OPEN_REQUESTS');

  let req;
  try {
    req = await db.tx(async (t) => {
      const { rows } = await t.query('INSERT INTO account_closure_requests (user_id, account_id, reason) VALUES ($1,$2,$3) RETURNING *', [user.id, accountId, reason || null]);
      await audit.record(t, ctx, { action: 'account.closure_request', targetType: 'account', targetId: accountId, accountId, reason: reason || null });
      return rows[0];
    });
  } catch (e) {
    if (e?.code === '23505') throw conflict('A closure request for this account is already waiting for review.');
    throw e;
  }
  // The request also opens a support conversation so the customer and our team have one place to follow up.
  const ticket = await support.create(ctx, { category: 'account', subject: `Account closure request: ${acct.name}`, message: `I would like to close my account ending ${String(acct.account_number).slice(-4)}.${reason ? `\nReason: ${reason}` : ''}` }, []).catch(() => null);
  if (ticket) await db.query('UPDATE account_closure_requests SET ticket_id=$2 WHERE id=$1', [req.id, ticket.id]);
  await notify(user.id, { category: 'account', title: 'Account closure requested', body: 'We received your request. Our team will confirm once it is complete. You can cancel it until then.', link: '/app/settings/accounts' });
  return closureDto({ ...req, ticket_id: ticket?.id ?? null });
}

export async function cancelClosure(ctx, user, accountId) {
  const db = getDb();
  const { rows } = await db.query("UPDATE account_closure_requests SET status='cancelled', resolved_at=now() WHERE account_id=$1 AND user_id=$2 AND status='requested' RETURNING *", [accountId, user.id]);
  if (!rows[0]) throw notFound('There is no open closure request for this account.');
  await audit.record(db, ctx, { action: 'account.closure_cancel', targetType: 'account', targetId: accountId, accountId });
  return closureDto(rows[0]);
}

// staff side
export async function listClosureRequests() {
  const { rows } = await getDb().query(
    `SELECT r.*, a.account_number, a.name AS account_name, u.email, u.first_name, u.last_name FROM account_closure_requests r
     JOIN accounts a ON a.id=r.account_id JOIN users u ON u.id=r.user_id WHERE r.status='requested' ORDER BY r.created_at`);
  return { items: rows.map((r) => ({ ...closureDto(r), accountNumber: r.account_number, accountName: r.account_name, customer: `${r.first_name} ${r.last_name}`, email: r.email })) };
}

export async function decideClosure(ctx, requestId, { decision, note }) {
  const db = getDb();
  const out = await db.tx(async (t) => {
    const req = (await t.query("SELECT * FROM account_closure_requests WHERE id=$1 AND status='requested' FOR UPDATE", [requestId])).rows[0];
    if (!req) throw notFound('Closure request not found or already resolved.');
    if (decision === 'complete') {
      await L.lockAccounts(t, [req.account_id]);
      const b = await L.balances(t, req.account_id);
      if (BigInt(b.ledger) !== 0n || BigInt(b.held) !== 0n) throw conflict('The account balance is not zero, so it cannot be closed.', 'BALANCE_NOT_ZERO');
      await t.query("UPDATE accounts SET status='closed' WHERE id=$1", [req.account_id]);
    }
    const status = decision === 'complete' ? 'completed' : 'declined';
    const { rows } = await t.query('UPDATE account_closure_requests SET status=$2, staff_note=$3, resolved_by=$4, resolved_at=now() WHERE id=$1 RETURNING *', [requestId, status, note || null, ctx.actor.id]);
    await audit.record(t, ctx, { action: `account.closure_${status}`, targetType: 'account', targetId: req.account_id, accountId: req.account_id, reason: note || null });
    return rows[0];
  });
  await notify(out.user_id, { category: 'account', title: out.status === 'completed' ? 'Account closed' : 'Account closure not completed', body: out.status === 'completed' ? 'Your account is now closed. Your transaction history remains available.' : (out.staff_note || 'We could not close this account. Please contact customer support.'), link: '/app/settings/accounts' });
  return closureDto(out);
}
