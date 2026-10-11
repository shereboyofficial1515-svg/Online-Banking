// Staff-facing customer and platform administration. Every mutating function writes an audit record in the
// same transaction. Route-level middleware has already checked the permission; mutating functions here
// still refuse to touch staff accounts or invalid targets (defence in depth).
import { getDb } from '../db/index.js';
import * as users from '../repositories/users.js';
import * as L from '../repositories/ledger.js';
import * as audit from './auditService.js';
import * as security from './securityEventService.js';
import * as sessions from './sessionService.js';
import * as auth from './authService.js';
import * as transactions from './transactionService.js';
import { sendEmail } from './emailService.js';
import { notify } from './notificationService.js';
import { STAFF_ROLES, ROLES } from '../config/permissions.js';
import { randomToken } from '../utils/crypto.js';
import { hashPassword } from '../utils/passwords.js';
import config from '../config/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

export const CUSTOMER_ACTIONS = {
  approve_account: 'accounts.review',
  reject_account: 'accounts.review',
  suspend: 'customers.status',
  reactivate: 'customers.status',
  lock: 'customers.status',
  reset_sessions: 'sessions.reset',
};

export async function dashboard() {
  const db = getDb();
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const [u, a, l, w, s, t, recent, pendingAccounts] = await Promise.all([
    one(`SELECT count(*)::bigint total, count(*) FILTER (WHERE verification_status='verified')::bigint verified,
                count(*) FILTER (WHERE verification_status IN ('pending','verification_required','manual_review'))::bigint pending_verification
         FROM users WHERE role='customer'`),
    one(`SELECT count(*) FILTER (WHERE status='active')::bigint active, count(*) FILTER (WHERE status IN ('suspended','locked'))::bigint suspended,
                count(*) FILTER (WHERE status='pending_review')::bigint pending_review FROM accounts WHERE kind='customer'`),
    one(`SELECT count(*)::bigint count_24h, COALESCE(SUM(amount),0)::bigint volume_24h FROM transactions WHERE created_at > now() - interval '24 hours' AND status='completed'`),
    one("SELECT count(*)::bigint pending FROM withdrawal_requests WHERE status IN ('requested','under_review','additional_verification_required','customer_support_required')"),
    one("SELECT count(*)::bigint open_alerts FROM security_events WHERE status IN ('open','investigating') AND severity IN ('medium','high')"),
    one("SELECT count(*)::bigint open_tickets FROM support_tickets WHERE status IN ('open','in_progress')"),
    db.query(`SELECT a.id, a.action, a.target_type, a.reason, a.created_at, u.email AS actor_email FROM audit_logs a JOIN users u ON u.id=a.actor_id
              WHERE a.actor_role <> 'customer' ORDER BY a.created_at DESC LIMIT 10`),
    one("SELECT count(*)::bigint n FROM accounts WHERE status='pending_review'"),
  ]);
  const activity = (await db.query(
    `SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS day, count(*)::bigint AS n, COALESCE(SUM(amount),0)::bigint AS volume
     FROM transactions WHERE created_at > now() - interval '14 days' AND status='completed' GROUP BY 1 ORDER BY 1`)).rows;
  return {
    users: { total: u.total, verified: u.verified, pendingVerification: u.pending_verification },
    accounts: { active: a.active, suspended: a.suspended, pendingReview: pendingAccounts.n },
    ledger: { transactions24h: l.count_24h, volume24h: l.volume_24h, daily: activity },
    withdrawals: { pending: w.pending },
    security: { openAlerts: s.open_alerts },
    support: { openTickets: t.open_tickets },
    recentActions: recent.rows.map((r) => ({ id: r.id, action: r.action, target: r.target_type, reason: r.reason, actor: r.actor_email, at: r.created_at })),
  };
}

const like = (s) => `%${s.replace(/[%_\\]/g, '\\$&')}%`;

export async function listCustomers({ q, status, verification, limit = 25, offset = 0 }) {
  const p = [];
  const w = ["u.role = 'customer'"];
  if (q) { p.push(like(q)); w.push(`(u.email ILIKE $${p.length} OR u.first_name ILIKE $${p.length} OR u.last_name ILIKE $${p.length} OR u.username ILIKE $${p.length} OR EXISTS (SELECT 1 FROM accounts a WHERE a.user_id=u.id AND a.account_number ILIKE $${p.length}))`); }
  if (status) { p.push(status); w.push(`u.status = $${p.length}`); }
  if (verification) { p.push(verification); w.push(`u.verification_status = $${p.length}`); }
  const where = `WHERE ${w.join(' AND ')}`;
  const db = getDb();
  const { rows } = await db.query(
    `SELECT u.*, (SELECT status FROM accounts a WHERE a.user_id=u.id AND a.kind='customer' ORDER BY created_at LIMIT 1) AS account_status
     FROM users u ${where} ORDER BY u.created_at DESC LIMIT ${Math.min(limit, 100)} OFFSET ${Math.max(offset, 0)}`, p);
  const total = (await db.query(`SELECT count(*)::bigint n FROM users u ${where}`, p)).rows[0].n;
  return { total, items: rows.map((r) => ({ ...users.toPublic(r), accountStatus: r.account_status })) };
}

export async function customerDetail(id) {
  const db = getDb();
  const user = await users.findById(db, id);
  if (!user || user.role !== 'customer') throw notFound('Customer not found.');
  const accounts = (await db.query("SELECT * FROM accounts WHERE user_id=$1 AND kind='customer' ORDER BY created_at", [id])).rows;
  const withBalances = await Promise.all(accounts.map(async (a) => ({
    id: a.id, accountNumber: a.account_number, type: a.type, name: a.name, currency: a.currency, status: a.status, createdAt: a.created_at, securityReview: !!a.security_review_at, securityReviewReason: a.security_review_reason, balances: await L.balances(db, a.id),
  })));
  const [logins, tickets, withdrawals, events] = await Promise.all([
    db.query('SELECT success, method, reason, ip, user_agent, created_at FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [id]),
    db.query('SELECT id, reference, subject, status, updated_at FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 10', [id]),
    db.query('SELECT id, reference, amount, currency, status, created_at FROM withdrawal_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [id]),
    db.query('SELECT id, type, severity, status, summary, created_at FROM security_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [id]),
  ]);
  const txs = accounts[0] ? await transactions.listForAccount(accounts[0].id, { limit: 20 }) : [];
  return {
    profile: users.toPublic(user), accounts: withBalances,
    loginActivity: logins.rows.map((l) => ({ success: l.success, method: l.method, reason: l.reason, ip: l.ip, device: sessions.describeDevice(l.user_agent), at: l.created_at })),
    supportRequests: tickets.rows, withdrawals: withdrawals.rows, securityEvents: events.rows, transactions: txs,
    activeSessions: (await sessions.listForUser(id, null)).length,
  };
}

const STATUS_LABEL = { active: 'Active', suspended: 'Suspended', locked: 'Locked', rejected: 'Rejected' };

export async function customerAction(ctx, userId, action, reason) {
  if (!CUSTOMER_ACTIONS[action]) throw badRequest('Unknown action.');
  const db = getDb();
  const result = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const user = rows[0];
    if (!user) throw notFound('Customer not found.');
    if (user.role !== 'customer') throw forbidden('Staff accounts are managed in Staff administration.');
    const accts = (await t.query("SELECT id, status FROM accounts WHERE user_id=$1 AND kind='customer' FOR UPDATE", [userId])).rows;
    const prev = { userStatus: user.status, accounts: accts.map((a) => ({ id: a.id, status: a.status })) };
    let userStatus = user.status;
    let acctMap = null; // from -> to
    let email = null;

    switch (action) {
      case 'approve_account':
        if (!accts.some((a) => a.status === 'pending_review')) throw conflict('There is no account awaiting approval.');
        if (user.status !== 'active') throw conflict('The customer profile must be active to approve an account.');
        acctMap = { pending_review: 'active' };
        email = { template: 'account_approved', data: { firstName: user.first_name } };
        break;
      case 'reject_account':
        if (!accts.some((a) => a.status === 'pending_review')) throw conflict('There is no account awaiting approval.');
        userStatus = 'rejected'; acctMap = { pending_review: 'closed' };
        email = { template: 'account_rejected', data: { firstName: user.first_name, reason } };
        break;
      case 'suspend':
        if (user.status !== 'active') throw conflict('Only active customers can be suspended.');
        userStatus = 'suspended'; acctMap = { active: 'suspended' };
        email = { template: 'account_status', data: { firstName: user.first_name, statusLabel: 'Suspended', reason } };
        break;
      case 'reactivate':
        if (!['suspended', 'locked'].includes(user.status)) throw conflict('Only suspended or locked customers can be reactivated.');
        userStatus = 'active'; acctMap = { suspended: 'active', locked: 'active' };
        email = { template: 'account_status', data: { firstName: user.first_name, statusLabel: 'Active', reason } };
        break;
      case 'lock':
        if (!['active', 'suspended'].includes(user.status)) throw conflict('This customer cannot be locked from their current status.');
        userStatus = 'locked'; acctMap = { active: 'locked', suspended: 'locked' };
        email = { template: 'account_status', data: { firstName: user.first_name, statusLabel: 'Locked', reason } };
        break;
      case 'reset_sessions':
        break;
      default:
        throw badRequest('Unknown action.');
    }
    if (userStatus !== user.status) await users.update(t, userId, { status: userStatus, ...(action === 'reactivate' ? { failed_login_count: 0, locked_until: null } : {}) });
    if (acctMap) for (const a of accts) if (acctMap[a.status]) await t.query('UPDATE accounts SET status=$2 WHERE id=$1', [a.id, acctMap[a.status]]);
    const revoke = ['lock', 'reject_account', 'reset_sessions'].includes(action);
    const revoked = revoke ? await sessions.revokeAllForUser(t, userId, { reason: `staff_${action}` }) : 0;
    const next = { userStatus, accounts: (await t.query("SELECT id, status FROM accounts WHERE user_id=$1 AND kind='customer'", [userId])).rows };
    await audit.record(t, ctx, { action: `customer.${action}`, targetType: 'user', targetId: userId, accountId: accts[0]?.id, previous: prev, next, reason, metadata: { sessionsRevoked: revoked } });
    if (action === 'lock') await security.record(t, { userId, type: 'account_locked', severity: 'medium', summary: 'Account locked by staff for review', ip: ctx.ip, details: { by: ctx.actor.id } });
    if (action === 'reset_sessions') await security.record(t, { userId, type: 'session_reset', severity: 'low', summary: 'All sessions were reset by staff', ip: ctx.ip, details: { by: ctx.actor.id } });
    return { user, email, userStatus };
  });
  if (result.email) {
    await notify(userId, {
      category: 'account', title: action === 'approve_account' ? 'Account approved' : action === 'reject_account' ? 'Application update' : `Account ${STATUS_LABEL[result.userStatus]?.toLowerCase()}`,
      body: reason, link: '/app', email: result.email,
    });
  }
  return customerDetail(userId);
}

// ───────────────────────── staff administration (super admin) ─────────────────────────
export async function listStaff() {
  const { rows } = await getDb().query("SELECT * FROM users WHERE role <> 'customer' ORDER BY created_at");
  return rows.map((u) => ({ ...users.toPublic(u), roleLabel: ROLES[u.role] }));
}

export async function createStaff(ctx, { email, firstName, lastName, role }) {
  if (!STAFF_ROLES.includes(role)) throw badRequest('Choose a valid staff role.');
  const db = getDb();
  if (await users.findByEmail(db, email)) throw conflict('An account with that email already exists.');
  const placeholder = await hashPassword(`${randomToken(24)}Aa1!`); // unusable until the invitee sets a password via the emailed link
  const { user, token } = await db.tx(async (t) => {
    const user = await users.create(t, { email, firstName, lastName, passwordHash: placeholder, role, status: 'active' });
    const token = await auth.issueToken(t, user.id, 'password_reset', 24 * 60);
    await audit.record(t, ctx, { action: 'staff.create', targetType: 'user', targetId: user.id, next: { role, email } });
    return { user, token };
  });
  await sendEmail({ to: user.email, userId: user.id, template: 'staff_invite', data: { firstName, roleLabel: ROLES[role], url: `${config.appUrl}/reset-password?token=${token}` } });
  return { ...users.toPublic(user), roleLabel: ROLES[role] };
}

export async function updateStaff(ctx, id, { role, status }) {
  if (id === ctx.actor.id) throw forbidden('You cannot change your own role or status.', 'SELF_MODIFICATION');
  if (role !== undefined && !STAFF_ROLES.includes(role)) throw badRequest('Choose a valid staff role.');
  if (status !== undefined && !['active', 'suspended'].includes(status)) throw badRequest('Invalid status.');
  const db = getDb();
  const updated = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
    const u = rows[0];
    if (!u || u.role === 'customer') throw notFound('Staff member not found.');
    if (u.role === 'super_admin' && (role && role !== 'super_admin' || status === 'suspended')) {
      const others = (await t.query("SELECT count(*)::bigint n FROM users WHERE role='super_admin' AND status='active' AND id <> $1", [id])).rows[0].n;
      if (others < 1) throw conflict('At least one active Super Admin must remain.');
    }
    const fields = {};
    if (role) fields.role = role;
    if (status) fields.status = status;
    const out = await users.update(t, id, fields);
    await sessions.revokeAllForUser(t, id, { reason: 'staff_role_or_status_changed' }); // privilege changes take effect immediately
    await audit.record(t, ctx, { action: 'staff.update', targetType: 'user', targetId: id, previous: { role: u.role, status: u.status }, next: fields });
    return out;
  });
  return { ...users.toPublic(updated), roleLabel: ROLES[updated.role] };
}
