// Security / risk events are *signals for investigation*, not accusations. Wording in summaries is
// neutral, and no event automatically penalises a customer beyond the explicit lockout rules in authService.
import { getDb } from '../db/index.js';
import { sendEmail } from './emailService.js';
import * as audit from './auditService.js';
import { notFound } from '../utils/errors.js';

export const EVENT_TYPES = {
  multiple_failed_logins: 'Multiple failed sign-in attempts',
  new_device_login: 'Sign-in from a new device',
  password_changed: 'Password changed',
  passkey_registered: 'Passkey registered',
  passkey_removed: 'Passkey removed',
  mfa_enabled: 'MFA enabled',
  mfa_disabled: 'MFA disabled',
  suspicious_session: 'Session flagged for review',
  account_locked: 'Account locked',
  large_ledger_adjustment: 'Large ledger adjustment',
  admin_financial_action: 'Administrative financial action',
  repeated_withdrawal_attempts: 'Repeated withdrawal requests',
  session_reset: 'Sessions reset by administrator',
  refresh_token_reuse: 'Refresh token reuse detected',
};

export async function record(q, { userId = null, type, severity = 'info', summary, details = {}, ip = null, sessionId = null }) {
  const { rows } = await q.query(
    `INSERT INTO security_events (user_id, type, severity, summary, details, ip, session_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
    [userId, type, severity, summary, JSON.stringify(details), ip, sessionId],
  );
  const event = rows[0];
  // Only alert staff when called outside a transaction (a rolled-back event must not generate mail).
  if (severity === 'high' && typeof q.tx === 'function') alertAdmins(event).catch(() => {});
  return event;
}

export async function alertAdmins(event) {
  const db = getDb();
  const { rows } = await db.query("SELECT id, email, first_name FROM users WHERE role IN ('security_admin','super_admin') AND status='active'");
  await Promise.all(rows.map((a) => sendEmail({
    to: a.email, userId: a.id, template: 'admin_security_alert',
    data: { firstName: a.first_name, title: event.summary, message: `A ${event.severity}-severity event of type "${event.type}" was recorded and may need review.`, severity: event.severity, time: new Date(event.created_at).toUTCString(), eventId: event.id },
  })));
}

export async function list({ status, severity, userId, type, limit = 50, offset = 0 }) {
  const p = [];
  const w = [];
  const add = (s, v) => { p.push(v); w.push(s.replace('?', `$${p.length}`)); };
  if (status) add('e.status = ?', status);
  if (severity) add('e.severity = ?', severity);
  if (userId) add('e.user_id = ?', userId);
  if (type) add('e.type = ?', type);
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const db = getDb();
  const { rows } = await db.query(
    `SELECT e.*, u.email AS user_email FROM security_events e LEFT JOIN users u ON u.id = e.user_id ${where} ORDER BY e.created_at DESC LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(offset, 0)}`, p);
  const total = (await db.query(`SELECT count(*)::bigint n FROM security_events e ${where}`, p)).rows[0].n;
  return { items: rows, total };
}

export async function updateStatus(ctx, id, { status, note }) {
  return getDb().tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM security_events WHERE id=$1 FOR UPDATE', [id]);
    const prev = rows[0];
    if (!prev) throw notFound('Security event not found.');
    const resolved = ['resolved', 'dismissed'].includes(status);
    const { rows: out } = await t.query(
      'UPDATE security_events SET status=$2, resolution_note=$3, resolved_by=$4, resolved_at=$5 WHERE id=$1 RETURNING *',
      [id, status, note ?? null, resolved ? ctx.actor.id : null, resolved ? new Date() : null]);
    await audit.record(t, ctx, { action: 'security_event.update', targetType: 'security_event', targetId: id, previous: { status: prev.status }, next: { status }, reason: note });
    return out[0];
  });
}
