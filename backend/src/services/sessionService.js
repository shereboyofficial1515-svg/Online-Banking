// Sessions, devices and token issuance.
// Access token  : short-lived JWT in an HttpOnly cookie; carries only user id + session id.
// Refresh token : JWT signed with a different secret, rotated on every use. The server stores only a hash
//                 of its jti, so presenting an old refresh token (theft/replay) revokes the whole session.
// Authority (role, status) is ALWAYS re-read from the database on each request, never taken from a token.
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { STAFF_ROLES } from '../config/permissions.js';
import { unauthorized } from '../utils/errors.js';
import * as security from './securityEventService.js';

const isStaff = (role) => STAFF_ROLES.includes(role);

export function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

const signAccess = (user, sid) =>
  jwt.sign({ sub: user.id, sid }, config.auth.jwtSecret, { algorithm: 'HS256', expiresIn: isStaff(user.role) ? config.auth.adminAccessTtlSec : config.auth.accessTtlSec });

function idleMs(role) {
  return isStaff(role) ? config.auth.adminIdleMinutes * 60_000 : config.auth.customerSessionDays * 86_400_000;
}
function absoluteMs(role) {
  return isStaff(role) ? config.auth.adminSessionHours * 3_600_000 : 30 * 86_400_000;
}
const signRefresh = (sid, jti, role) =>
  jwt.sign({ sid, jti }, config.auth.jwtRefreshSecret, { algorithm: 'HS256', expiresIn: Math.floor(idleMs(role) / 1000) });

/** Read-only lookup (no side effects) used before authentication has completed. */
export async function findDevice(q, userId, deviceCookie) {
  const { rows } = await q.query('SELECT * FROM devices WHERE user_id=$1 AND device_key=$2 AND removed_at IS NULL', [userId, sha256(deviceCookie)]);
  return rows[0] || null;
}

/** Find or register the device behind this browser. Returns whether it has been seen before. */
export async function touchDevice(q, userId, deviceCookie, ctx) {
  const key = sha256(deviceCookie);
  const label = describeDevice(ctx.userAgent);
  const { rows } = await q.query('SELECT * FROM devices WHERE user_id=$1 AND device_key=$2', [userId, key]);
  if (rows[0] && !rows[0].removed_at) {
    await q.query('UPDATE devices SET last_seen_at=now(), last_ip=$2, user_agent=$3 WHERE id=$1', [rows[0].id, ctx.ip, ctx.userAgent]);
    return { device: rows[0], isNew: false };
  }
  if (rows[0]) { // previously removed by the user: treat as brand new again
    const { rows: re } = await q.query('UPDATE devices SET removed_at=NULL, trusted_until=NULL, label=$2, last_seen_at=now(), last_ip=$3, user_agent=$4 WHERE id=$1 RETURNING *', [rows[0].id, label, ctx.ip, ctx.userAgent]);
    return { device: re[0], isNew: true };
  }
  const { rows: created } = await q.query('INSERT INTO devices (user_id, device_key, label, user_agent, last_ip) VALUES ($1,$2,$3,$4,$5) RETURNING *', [userId, key, label, ctx.userAgent, ctx.ip]);
  return { device: created[0], isNew: true };
}

export async function issueSession({ user, ctx, device, method, mfaVerified, limited = false }) {
  const db = getDb();
  const jti = randomToken(24);
  const now = Date.now();
  const expires = new Date(now + absoluteMs(user.role));
  const idle = new Date(Math.min(now + idleMs(user.role), expires.getTime()));
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, device_id, refresh_hash, auth_method, mfa_verified_at, limited, ip, user_agent, expires_at, idle_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [user.id, device?.id ?? null, sha256(jti), method, mfaVerified ? new Date() : null, limited, ctx.ip, ctx.userAgent, expires, idle]);
  const session = rows[0];
  return { session, accessToken: signAccess(user, session.id), refreshToken: signRefresh(session.id, jti, user.role) };
}

/** Rotate the refresh token. Reuse of a stale token revokes the session (possible theft). */
export async function refresh(refreshToken, ctx) {
  let payload;
  try { payload = jwt.verify(refreshToken, config.auth.jwtRefreshSecret, { algorithms: ['HS256'] }); } catch { throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED'); }
  const db = getDb();
  const { rows } = await db.query(
    'SELECT s.*, u.role, u.status AS user_status, u.id AS uid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id=$1', [payload.sid]);
  const s = rows[0];
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date() || new Date(s.idle_expires_at) < new Date()) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  if (s.refresh_hash !== sha256(payload.jti)) {
    await revoke(s.id, 'refresh_token_reuse');
    await security.record(db, { userId: s.user_id, type: 'refresh_token_reuse', severity: 'medium', summary: 'A previously used session token was presented; the session was ended as a precaution.', ip: ctx.ip, sessionId: s.id });
    throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  }
  if (['locked', 'rejected'].includes(s.user_status)) { await revoke(s.id, 'account_status'); throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED'); }
  const jti = randomToken(24);
  const idle = new Date(Math.min(Date.now() + idleMs(s.role), new Date(s.expires_at).getTime()));
  await db.query('UPDATE sessions SET refresh_hash=$2, idle_expires_at=$3, last_seen_at=now(), ip=$4 WHERE id=$1', [s.id, sha256(jti), idle, ctx.ip]);
  const user = { id: s.uid, role: s.role };
  return { sessionId: s.id, role: s.role, accessToken: signAccess(user, s.id), refreshToken: signRefresh(s.id, jti, s.role) };
}

/** Resolve an access token to the live session + user row, or throw 401. */
export async function authenticate(accessToken) {
  let payload;
  try { payload = jwt.verify(accessToken, config.auth.jwtSecret, { algorithms: ['HS256'] }); } catch (e) {
    throw unauthorized(e.name === 'TokenExpiredError' ? 'Your session has expired.' : 'Authentication is required.', e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED');
  }
  const db = getDb();
  const { rows } = await db.query('SELECT s.*, row_to_json(u) AS user_json FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id=$1 AND s.user_id=$2', [payload.sid, payload.sub]);
  const s = rows[0];
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date() || new Date(s.idle_expires_at) < new Date()) throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  const user = typeof s.user_json === 'string' ? JSON.parse(s.user_json) : s.user_json;
  if (['locked', 'rejected'].includes(user.status)) throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) db.query('UPDATE sessions SET last_seen_at=now() WHERE id=$1', [s.id]).catch(() => {});
  return { session: s, user };
}

export async function revoke(sessionId, reason = 'user_logout') {
  await getDb().query('UPDATE sessions SET revoked_at=now(), revoked_reason=$2 WHERE id=$1 AND revoked_at IS NULL', [sessionId, reason]);
}
export async function revokeAllForUser(q, userId, { exceptSessionId = null, reason = 'revoked' } = {}) {
  const { rowCount } = await q.query('UPDATE sessions SET revoked_at=now(), revoked_reason=$3 WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)', [userId, exceptSessionId, reason]);
  return rowCount;
}

export async function listForUser(userId, currentSessionId) {
  const { rows } = await getDb().query(
    `SELECT s.id, s.ip, s.user_agent, s.auth_method, s.created_at, s.last_seen_at, d.label AS device_label
     FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
     WHERE s.user_id=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.idle_expires_at > now() ORDER BY s.last_seen_at DESC`, [userId]);
  return rows.map((r) => ({ id: r.id, ip: r.ip, device: r.device_label || describeDevice(r.user_agent), method: r.auth_method, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === currentSessionId }));
}

export async function listDevices(userId) {
  const { rows } = await getDb().query('SELECT * FROM devices WHERE user_id=$1 AND removed_at IS NULL ORDER BY last_seen_at DESC', [userId]);
  return rows.map((d) => ({ id: d.id, label: d.label, lastIp: d.last_ip, firstSeenAt: d.first_seen_at, lastSeenAt: d.last_seen_at, trusted: !!d.trusted_until && new Date(d.trusted_until) > new Date() }));
}
export async function removeDevice(userId, deviceId) {
  const db = getDb();
  const { rowCount } = await db.query('UPDATE devices SET removed_at=now(), trusted_until=NULL WHERE id=$1 AND user_id=$2 AND removed_at IS NULL', [deviceId, userId]);
  if (rowCount) await db.query("UPDATE sessions SET revoked_at=now(), revoked_reason='device_removed' WHERE device_id=$1 AND revoked_at IS NULL", [deviceId]);
  return rowCount > 0;
}
