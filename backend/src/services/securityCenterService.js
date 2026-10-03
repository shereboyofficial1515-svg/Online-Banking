import { getDb } from '../db/index.js';
import * as sessions from './sessionService.js';
import * as passkeys from './passkeyService.js';
import * as mfa from './mfaService.js';
import * as audit from './auditService.js';
import * as security from './securityEventService.js';
import { notify } from './notificationService.js';
import { notFound } from '../utils/errors.js';

/** Everything the Security Center page shows, assembled from authoritative server state. */
export async function overview(user, currentSessionId) {
  const db = getDb();
  const [passkeyList, sessionList, devices, logins, events, recovery] = await Promise.all([
    passkeys.list(user.id),
    sessions.listForUser(user.id, currentSessionId),
    sessions.listDevices(user.id),
    db.query('SELECT id, success, method, reason, ip, user_agent, created_at FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]),
    db.query("SELECT id, type, severity, summary, created_at FROM security_events WHERE user_id=$1 AND severity <> 'info' ORDER BY created_at DESC LIMIT 10", [user.id]),
    user.mfa_enabled ? mfa.recoveryCodesRemaining(user.id) : 0,
  ]);
  return {
    password: { changedAt: user.password_changed_at },
    mfa: { enabled: user.mfa_enabled, recoveryCodesRemaining: recovery },
    emailVerified: !!user.email_verified_at,
    phoneVerified: !!user.phone_verified_at,
    passkeys: passkeyList,
    sessions: sessionList,
    trustedDevices: devices,
    recentActivity: logins.rows.map((l) => ({ id: l.id, success: l.success, method: l.method, reason: l.reason, ip: l.ip, device: sessions.describeDevice(l.user_agent), at: l.created_at })),
    alerts: events.rows.map((e) => ({ id: e.id, type: e.type, severity: e.severity, summary: e.summary, at: e.created_at })),
  };
}

export async function revokeSession(ctx, user, sessionId) {
  const db = getDb();
  const { rowCount } = await db.query("UPDATE sessions SET revoked_at=now(), revoked_reason='user_revoked' WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [sessionId, user.id]);
  if (!rowCount) throw notFound('Session not found.');
  await audit.record(db, ctx, { action: 'session.revoke', targetType: 'session', targetId: sessionId });
}

export async function revokeOtherSessions(ctx, user) {
  const db = getDb();
  const n = await sessions.revokeAllForUser(db, user.id, { exceptSessionId: ctx.sessionId, reason: 'user_revoked_all' });
  await audit.record(db, ctx, { action: 'session.revoke_others', targetType: 'user', targetId: user.id, metadata: { count: n } });
  return { revoked: n };
}

export async function removeDevice(ctx, user, deviceId) {
  if (!(await sessions.removeDevice(user.id, deviceId))) throw notFound('Device not found.');
  await audit.record(getDb(), ctx, { action: 'device.remove', targetType: 'device', targetId: deviceId });
  await notify(user.id, { category: 'security', title: 'Device removed', body: 'A device was removed from your trusted devices and its sessions were ended.', link: '/app/security' });
}

export { security };
