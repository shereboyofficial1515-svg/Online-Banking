import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as users from '../repositories/users.js';
import * as accountService from './accountService.js';
import * as sessions from './sessionService.js';
import * as mfa from './mfaService.js';
import * as audit from './auditService.js';
import * as security from './securityEventService.js';
import { sendEmail } from './emailService.js';
import { notify } from './notificationService.js';
import { hashPassword, verifyPassword, passwordProblems } from '../utils/passwords.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { STAFF_ROLES } from '../config/permissions.js';
import { AppError, badRequest, forbidden, tooMany, unauthorized, validationError } from '../utils/errors.js';

const GENERIC_LOGIN_ERROR = 'The email/username or password is incorrect.';
let dummyHash; // verified against when the user does not exist so timing does not reveal valid accounts
const getDummyHash = async () => (dummyHash ||= await hashPassword('timing-equalisation-only-Aa1!'));

const isStaff = (u) => STAFF_ROLES.includes(u.role);

// ───────── single-use tokens (email verification, password reset) ─────────
async function issueToken(q, userId, purpose, ttlMinutes) {
  const raw = randomToken(32);
  await q.query("UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL", [userId, purpose]);
  await q.query('INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3,$4)', [userId, purpose, sha256(raw), new Date(Date.now() + ttlMinutes * 60_000)]);
  return raw;
}
async function consumeToken(q, raw, purpose) {
  const { rows } = await q.query(
    'UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now() RETURNING user_id', [sha256(String(raw)), purpose]);
  if (!rows[0]) throw badRequest('This link is invalid or has expired. Please request a new one.', undefined);
  return rows[0].user_id;
}

function ageOk(dob) {
  const d = new Date(dob);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return d <= cutoff;
}

// ───────── registration ─────────
export async function register(ctx, input) {
  const problems = passwordProblems(input.password, { email: input.email });
  if (problems.length) throw validationError({ password: [`Password needs ${problems.join(', ')}.`] });
  if (!ageOk(input.dateOfBirth)) throw validationError({ dateOfBirth: ['You must be at least 18 years old to open an account.'] });
  const db = getDb();

  const existing = await users.findByEmail(db, input.email);
  if (existing) {
    // Do not reveal that the address is registered; tell the owner instead.
    await sendEmail({ to: existing.email, userId: existing.id, template: 'security_alert', data: { firstName: existing.first_name, title: 'Registration attempt for your email address', message: 'Someone tried to open an EWB Bank profile using your email address. Your existing account was not changed. If this was you, sign in or reset your password instead.', time: new Date().toUTCString(), ip: ctx.ip } });
    return { created: false };
  }
  if (input.username && (await db.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [input.username])).rows[0]) {
    throw validationError({ username: ['That username is already taken.'] });
  }
  const passwordHash = await hashPassword(input.password);
  const { user, token } = await db.tx(async (t) => {
    const user = await users.create(t, { ...input, passwordHash, role: 'customer', status: 'active' });
    await accountService.openDefaultAccount(t, user.id);
    const token = await issueToken(t, user.id, 'email_verification', config.auth.emailTokenHours * 60);
    await audit.record(t, ctx, { actorId: user.id, actorRole: 'customer', action: 'user.register', targetType: 'user', targetId: user.id });
    return { user, token };
  });
  await sendEmail({ to: user.email, userId: user.id, template: 'welcome', data: { firstName: user.first_name } });
  await sendEmail({ to: user.email, userId: user.id, template: 'email_verification', data: { firstName: user.first_name, url: `${config.appUrl}/verify-email?token=${token}` } });
  return { created: true, userId: user.id };
}

export async function verifyEmail(ctx, rawToken) {
  const db = getDb();
  const userId = await db.tx(async (t) => {
    const uid = await consumeToken(t, rawToken, 'email_verification');
    await users.update(t, uid, { email_verified_at: new Date() });
    await audit.record(t, ctx, { actorId: uid, action: 'user.email_verified', targetType: 'user', targetId: uid });
    return uid;
  });
  await notify(userId, { category: 'account', title: 'Email verified', body: 'Your email address has been verified.' });
}

export async function resendVerification(email) {
  const db = getDb();
  const u = await users.findByEmail(db, email);
  if (u && !u.email_verified_at && u.status !== 'rejected') {
    const token = await issueToken(db, u.id, 'email_verification', config.auth.emailTokenHours * 60);
    await sendEmail({ to: u.email, userId: u.id, template: 'email_verification', data: { firstName: u.first_name, url: `${config.appUrl}/verify-email?token=${token}` } });
  }
}

// ───────── login ─────────
async function logLogin(q, { user, identifier, success, method, reason, ctx, deviceId }) {
  await q.query('INSERT INTO login_events (user_id, identifier, success, method, reason, ip, user_agent, device_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [user?.id ?? null, String(identifier || '').slice(0, 200).toLowerCase(), success, method, reason ?? null, ctx.ip, ctx.userAgent, deviceId ?? null]);
}

async function recentFailuresFor(q, identifier) {
  const { rows } = await q.query(
    `SELECT count(*)::bigint n FROM login_events WHERE identifier=lower($1) AND success=false AND method IN ('password','mfa') AND created_at > now() - make_interval(mins => $2::int)`,
    [identifier, config.auth.lockMinutes]);
  return rows[0].n;
}

export async function login(ctx, { identifier, password }, deviceCookie) {
  const db = getDb();
  const user = await users.findByIdentifier(db, identifier);

  if (!user) {
    await verifyPassword(await getDummyHash(), password);
    if ((await recentFailuresFor(db, identifier)) >= config.auth.maxFailedLogins) throw tooMany('Too many sign-in attempts. Please try again later.');
    await logLogin(db, { identifier, success: false, method: 'password', reason: 'unknown_user', ctx });
    throw unauthorized(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logLogin(db, { user, identifier, success: false, method: 'password', reason: 'temporarily_locked', ctx });
    throw tooMany('Too many sign-in attempts. Please try again later.');
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    const count = user.failed_login_count + 1;
    const lock = count >= config.auth.maxFailedLogins;
    await users.update(db, user.id, { failed_login_count: lock ? 0 : count, locked_until: lock ? new Date(Date.now() + config.auth.lockMinutes * 60_000) : user.locked_until });
    await logLogin(db, { user, identifier, success: false, method: 'password', reason: 'bad_password', ctx });
    if (lock) {
      await security.record(db, { userId: user.id, type: 'multiple_failed_logins', severity: isStaff(user) ? 'high' : 'medium', summary: `${isStaff(user) ? 'Staff account: sign-in' : 'Sign-in'} temporarily paused after ${config.auth.maxFailedLogins} failed attempts`, ip: ctx.ip, details: { lockMinutes: config.auth.lockMinutes } });
      await notify(user.id, { category: 'security', title: 'Sign-in temporarily paused', body: `We paused sign-in for ${config.auth.lockMinutes} minutes after several failed attempts.`, email: { template: 'security_alert', data: { firstName: user.first_name, title: 'Sign-in temporarily paused', message: `We noticed several unsuccessful sign-in attempts and paused sign-in for ${config.auth.lockMinutes} minutes as a precaution.`, time: new Date().toUTCString(), ip: ctx.ip } } });
    }
    throw unauthorized(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  // Password correct from here on - status can now be disclosed without enabling account enumeration.
  if (user.status === 'locked') throw forbidden('Your account is locked. Please contact EWB Bank Customer Support.', 'ACCOUNT_LOCKED');
  if (user.status === 'rejected') throw forbidden('Your application was not approved. Please contact EWB Bank Customer Support.', 'ACCOUNT_REJECTED');
  if (!user.email_verified_at) throw forbidden('Please verify your email address before signing in. Check your inbox or request a new link.', 'EMAIL_NOT_VERIFIED');

  if (user.mfa_enabled) {
    const device = await sessions.findDevice(db, user.id, deviceCookie);
    const trusted = !isStaff(user) && device?.trusted_until && new Date(device.trusted_until) > new Date();
    if (!trusted) {
      const mfaToken = jwt.sign({ sub: user.id, purpose: 'mfa' }, config.auth.jwtSecret, { algorithm: 'HS256', expiresIn: 300 });
      return { status: 'mfa_required', mfaToken };
    }
    return completeLogin(ctx, user, { method: 'password_mfa', mfaVerified: true, deviceCookie, reason: 'trusted_device' });
  }
  return completeLogin(ctx, user, { method: 'password', mfaVerified: false, deviceCookie });
}

export async function loginMfa(ctx, { mfaToken, code, recoveryCode, trustDevice }, deviceCookie) {
  let payload;
  try { payload = jwt.verify(mfaToken, config.auth.jwtSecret, { algorithms: ['HS256'] }); } catch { throw unauthorized('Your verification step expired. Please sign in again.', 'MFA_EXPIRED'); }
  if (payload.purpose !== 'mfa') throw unauthorized('Your verification step expired. Please sign in again.', 'MFA_EXPIRED');
  const db = getDb();
  const user = await users.findById(db, payload.sub);
  if (!user || user.status === 'locked' || user.status === 'rejected') throw unauthorized('Your verification step expired. Please sign in again.', 'MFA_EXPIRED');
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw tooMany('Too many attempts. Please try again later.');

  const ok = code ? await mfa.verifyAndConsumeTotp(user, code) : await mfa.consumeRecoveryCode(user, recoveryCode);
  if (!ok) {
    const count = user.failed_login_count + 1;
    const lock = count >= config.auth.maxFailedLogins;
    await users.update(db, user.id, { failed_login_count: lock ? 0 : count, locked_until: lock ? new Date(Date.now() + config.auth.lockMinutes * 60_000) : user.locked_until });
    await logLogin(db, { user, identifier: user.email, success: false, method: 'mfa', reason: 'bad_mfa_code', ctx });
    if (lock) await security.record(db, { userId: user.id, type: 'multiple_failed_logins', severity: 'medium', summary: 'Sign-in paused after repeated failed verification codes', ip: ctx.ip });
    throw unauthorized('That code is not valid.', 'INVALID_MFA_CODE');
  }
  if (recoveryCode) await security.record(db, { userId: user.id, type: 'suspicious_session', severity: 'low', summary: 'A recovery code was used to sign in', ip: ctx.ip });
  return completeLogin(ctx, user, { method: 'password_mfa', mfaVerified: true, deviceCookie, trustDevice: !!trustDevice && !isStaff(user) });
}

/** Shared by password, MFA and passkey flows: creates the session and sends the right notifications. */
export async function completeLogin(ctx, user, { method, mfaVerified, deviceCookie, trustDevice = false, reason }) {
  const db = getDb();
  const { device, isNew } = await sessions.touchDevice(db, user.id, deviceCookie, ctx);
  if (trustDevice) await db.query('UPDATE devices SET trusted_until=$2 WHERE id=$1', [device.id, new Date(Date.now() + config.auth.trustedDeviceDays * 86_400_000)]);
  // Administrators must have MFA. Without it the session is "limited" to MFA enrolment only.
  const limited = isStaff(user) && !user.mfa_enabled;
  const issued = await sessions.issueSession({ user, ctx, device, method, mfaVerified, limited });
  await users.update(db, user.id, { failed_login_count: 0, locked_until: null, last_login_at: new Date() });
  await logLogin(db, { user, identifier: user.email, success: true, method, reason, ctx, deviceId: device.id });
  await audit.record(db, ctx, { actorId: user.id, actorRole: user.role, action: 'auth.login', targetType: 'user', targetId: user.id, metadata: { method, newDevice: isNew } });

  const time = new Date().toUTCString();
  const base = { firstName: user.first_name, time, ip: ctx.ip, device: device.label, method: method === 'passkey' ? 'Passkey' : mfaVerified ? 'Password + MFA' : 'Password' };
  if (isNew) {
    await security.record(db, { userId: user.id, type: 'new_device_login', severity: 'low', summary: `Sign-in from a new device (${device.label})`, ip: ctx.ip, sessionId: issued.session.id });
    await notify(user.id, { category: 'security', title: 'New device sign-in', body: `Your account was accessed from ${device.label}.`, link: '/app/security', email: { template: 'new_device_login', data: base } });
  } else {
    await notify(user.id, { category: 'security', title: 'Sign-in', body: `Signed in from ${device.label}.`, email: { template: 'login_notification', data: base } });
  }
  return { status: 'ok', user, ...issued, isNewDevice: isNew };
}

export async function logout(sessionId) {
  await sessions.revoke(sessionId, 'user_logout');
}

// ───────── passwords ─────────
export async function forgotPassword(email, ctx) {
  const db = getDb();
  const u = await users.findByEmail(db, email);
  if (u && u.status !== 'rejected') {
    const token = await issueToken(db, u.id, 'password_reset', config.auth.resetTokenMinutes);
    await sendEmail({ to: u.email, userId: u.id, template: 'password_reset', data: { firstName: u.first_name, url: `${config.appUrl}/reset-password?token=${token}` } });
    await audit.record(db, ctx, { actorId: u.id, action: 'auth.password_reset_requested', targetType: 'user', targetId: u.id });
  }
}

export async function resetPassword(ctx, { token, password }) {
  const db = getDb();
  const peek = await db.query('SELECT u.* FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.purpose=$2 AND t.used_at IS NULL AND t.expires_at > now()', [sha256(String(token)), 'password_reset']);
  if (!peek.rows[0]) throw badRequest('This link is invalid or has expired. Please request a new one.');
  const problems = passwordProblems(password, { email: peek.rows[0].email });
  if (problems.length) throw validationError({ password: [`Password needs ${problems.join(', ')}.`] });
  const passwordHash = await hashPassword(password);
  const user = await db.tx(async (t) => {
    const uid = await consumeToken(t, token, 'password_reset');
    const u = await users.update(t, uid, { password_hash: passwordHash, password_changed_at: new Date(), failed_login_count: 0, locked_until: null, email_verified_at: peek.rows[0].email_verified_at ?? new Date() });
    await sessions.revokeAllForUser(t, uid, { reason: 'password_reset' });
    await audit.record(t, ctx, { actorId: uid, action: 'auth.password_reset', targetType: 'user', targetId: uid });
    return u;
  });
  await security.record(db, { userId: user.id, type: 'password_changed', severity: 'low', summary: 'Password was reset using an emailed link', ip: ctx.ip });
  await notify(user.id, { category: 'security', title: 'Password changed', body: 'Your password was reset and all sessions were signed out.', email: { template: 'password_changed', data: { firstName: user.first_name, time: new Date().toUTCString(), ip: ctx.ip } } });
}

export async function changePassword(ctx, user, { currentPassword, newPassword }) {
  if (!(await verifyPassword(user.password_hash, currentPassword))) throw unauthorized('Your current password is incorrect.', 'INVALID_CREDENTIALS');
  const problems = passwordProblems(newPassword, { email: user.email });
  if (problems.length) throw validationError({ newPassword: [`Password needs ${problems.join(', ')}.`] });
  if (await verifyPassword(user.password_hash, newPassword)) throw validationError({ newPassword: ['Choose a password you have not used just now.'] });
  const passwordHash = await hashPassword(newPassword);
  const db = getDb();
  await db.tx(async (t) => {
    await users.update(t, user.id, { password_hash: passwordHash, password_changed_at: new Date() });
    await sessions.revokeAllForUser(t, user.id, { exceptSessionId: ctx.sessionId, reason: 'password_changed' });
    await audit.record(t, ctx, { action: 'auth.password_changed', targetType: 'user', targetId: user.id });
  });
  await security.record(db, { userId: user.id, type: 'password_changed', severity: 'low', summary: 'Password was changed', ip: ctx.ip, sessionId: ctx.sessionId });
  await notify(user.id, { category: 'security', title: 'Password changed', body: 'Your password was changed. Other sessions were signed out.', email: { template: 'password_changed', data: { firstName: user.first_name, time: new Date().toUTCString(), ip: ctx.ip } } });
}

export { isStaff, AppError, issueToken };
