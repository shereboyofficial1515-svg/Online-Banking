// "Away" tracking and session locking. The browser reports when the page is hidden/shown; the SERVER keeps the clock.
//  * away   : page hidden. Records away_since (first report wins).
//  * back   : page visible again. If the user was away for at least AWAY_LOCK_SECONDS the session becomes locked,
//             otherwise away_since is cleared and nothing changes for the user.
//  * lock   : the browser measured the time away itself (timers are suspended in background tabs, so it uses timestamps) and
//             asks the server to lock now. Locking can only ever make the session stricter.
//  * unlock : password (and authenticator code if the account has MFA) or a passkey belonging to this user.
// While locked, sessions.authenticate() flags the session and requireAuth() refuses it with 403 SESSION_LOCKED, so a stolen or
// stale token gets nothing. Wrong passwords are counted; after MAX_UNLOCK_FAILURES the session is ended entirely.
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as audit from './auditService.js';
import * as sessions from './sessionService.js';
import * as mfa from './mfaService.js';
import * as passkeys from './passkeyService.js';
import * as pins from './pinService.js';
import { verifyPassword } from '../utils/passwords.js';
import { forbidden, unauthorized, validationError } from '../utils/errors.js';

const passkeyAllowed = (user) => user?.role === 'customer'; // staff always use password + authenticator code
const awayMs = () => config.auth.awayLockSeconds * 1000;

export async function markAway(session) {
  if (session.locked_at) return { locked: true };
  await getDb().query('UPDATE sessions SET away_since=COALESCE(away_since, now()) WHERE id=$1', [session.id]);
  return { locked: false };
}

export async function markBack(ctx, session) {
  if (session.locked_at) return { locked: true };
  const db = getDb();
  if (session.away_since && Date.now() - new Date(session.away_since).getTime() >= awayMs()) {
    await lock(ctx, session, 'away_timeout');
    return { locked: true };
  }
  // "back" is only sent while the person is actually using the page, so it doubles as the activity heartbeat the server's idle lock relies on.
  await db.query('UPDATE sessions SET away_since=NULL, activity_at=now() WHERE id=$1', [session.id]);
  return { locked: false };
}

export async function lock(ctx, session, reason = 'client_timeout') {
  if (session.locked_at) return { locked: true };
  const db = getDb();
  const r = await db.query('UPDATE sessions SET locked_at=now(), away_since=NULL WHERE id=$1 AND locked_at IS NULL RETURNING id', [session.id]);
  if (r.rows[0]) await audit.record(db, ctx, { action: 'session.lock', targetType: 'session', targetId: session.id, metadata: { reason } });
  return { locked: true };
}

async function release(ctx, session, method) {
  const db = getDb();
  await db.query('UPDATE sessions SET locked_at=NULL, away_since=NULL, activity_at=now(), unlock_failures=0, last_seen_at=now() WHERE id=$1', [session.id]);
  await audit.record(db, ctx, { action: 'session.unlock', targetType: 'session', targetId: session.id, metadata: { method } });
  return { locked: false };
}

async function failure(ctx, session) {
  const db = getDb();
  const { rows } = await db.query('UPDATE sessions SET unlock_failures = unlock_failures + 1 WHERE id=$1 RETURNING unlock_failures', [session.id]);
  await audit.record(db, ctx, { action: 'session.unlock_failed', targetType: 'session', targetId: session.id });
  if (rows[0].unlock_failures >= config.auth.maxUnlockFailures) {
    await sessions.revoke(session.id, 'too_many_unlock_failures');
    throw unauthorized('Too many incorrect attempts. For your security you have been signed out.', 'SESSION_ENDED');
  }
}

const isCustomer = (u) => u.role === 'customer';

/** Customers unlock with their six-digit PIN. */
export async function unlockWithPin(ctx, user, session, { pin }) {
  if (!session.locked_at) return { locked: false };
  if (!isCustomer(user)) throw forbidden('Use your password and authenticator code to unlock.', 'PIN_NOT_FOR_STAFF');
  const r = await pins.verifyForUnlock(ctx, user, pin);
  if (!r.ok) {
    await failure(ctx, session);
    if (r.endSession) { await sessions.revoke(session.id, 'too_many_pin_failures'); throw unauthorized('Too many incorrect PIN attempts. For your security you have been signed out.', 'SESSION_ENDED'); }
    throw validationError({ pin: ['That PIN is incorrect.'] });
  }
  return release(ctx, session, 'pin');
}

/**
 * Password unlock. Staff always use this (password + authenticator code). A customer who forgot their PIN may use it only together
 * with a NEW PIN, which replaces the old one (the recovery path), so the password is never a silent everyday alternative.
 */
export async function unlockWithPassword(ctx, user, session, { password, code, newPin }) {
  if (!session.locked_at) return { locked: false };
  if (isCustomer(user)) {
    if (!newPin) throw validationError({ newPin: ['Enter a new 6-digit PIN to continue.'] });
    // setPin verifies the password (and authenticator code if MFA is on) exactly once, then stores the new PIN.
    try { await pins.setPin(ctx, user, { pin: newPin, password, code }); } catch (e) { if (e?.details?.password || e?.code === 'MFA_STEP_UP_FAILED') await failure(ctx, session); throw e; }
    return release(ctx, session, 'password_pin_reset');
  }
  if (!(await verifyPassword(user.password_hash, password))) {
    await failure(ctx, session);
    throw validationError({ password: ['That password is incorrect.'] });
  }
  if (user.mfa_enabled) {
    try { await mfa.requireStepUp(user, code); } catch (e) { await failure(ctx, session); throw e; }
  }
  return release(ctx, session, 'password');
}

export async function passkeyOptions(user) {
  if (user.unlock_passkey_enabled === false) throw forbidden('Passkey unlock is turned off in your security settings.', 'PASSKEY_UNLOCK_OFF');
  if (!passkeyAllowed(user)) throw forbidden('Passkeys are not available for this account.', 'PASSKEY_NOT_ALLOWED');
  return passkeys.unlockOptions(user);
}

export async function unlockWithPasskey(ctx, user, session, { response }) {
  if (!session.locked_at) return { locked: false };
  if (user.unlock_passkey_enabled === false) throw forbidden('Passkey unlock is turned off in your security settings.', 'PASSKEY_UNLOCK_OFF');
  if (!passkeyAllowed(user)) throw forbidden('Passkeys are not available for this account.', 'PASSKEY_NOT_ALLOWED');
  try { await passkeys.verifyForUser(user, response); } catch (e) { await failure(ctx, session); throw e; }
  return release(ctx, session, 'passkey');
}
