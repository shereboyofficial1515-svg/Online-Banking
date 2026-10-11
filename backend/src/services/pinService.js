// Six-digit session PIN. It only UNLOCKS a session that is already signed in; it can never sign in a new device.
// Storage: Argon2id( HMAC-SHA256(server secret, userId:pin) ). The keyed step means a copy of the database alone cannot be used to
// test PIN guesses offline. The hash is never returned by any endpoint.
// Guessing is limited three ways: a progressive per-user delay (3rd wrong PIN 15 s, 4th 60 s), the 5th wrong PIN ends the session
// (a full sign-in is then needed), and the sign-in/unlock endpoints are rate limited.
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as audit from './auditService.js';
import * as mfa from './mfaService.js';
import { notify } from './notificationService.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { hmacSha256Hex } from '../utils/crypto.js';
import { validationError, tooMany } from '../utils/errors.js';

export const PIN_RE = /^\d{6}$/;
const material = (userId, pin) => hmacSha256Hex(`${config.auth.jwtRefreshSecret}:session-pin`, `${userId}:${pin}`);

/** Obvious PINs are refused: all one digit, straight runs (123456, 654321) and 121212-style repeats. */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) return 'Your PIN must be exactly 6 digits.';
  if (/^(\d)\1{5}$/.test(pin)) return 'Choose a PIN that is not the same digit repeated.';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Choose a PIN that is not a simple run of digits.';
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return 'Choose a PIN without an obvious repeating pattern.';
  return null;
}

export const hashPin = (userId, pin) => hashPassword(material(userId, pin));
export const checkPin = (user, pin) => (user.session_pin_hash ? verifyPassword(user.session_pin_hash, material(user.id, pin)) : Promise.resolve(false));

/** Sets or replaces the PIN. Always requires the account password (and the authenticator code when MFA is on): initial setup, change and "forgot PIN" are the same safe path. */
export async function setPin(ctx, user, { pin, password, code }) {
  const bad = pinProblem(pin);
  if (bad) throw validationError({ pin: [bad] });
  if (!(await verifyPassword(user.password_hash, password))) throw validationError({ password: ['Your password is incorrect.'] });
  if (user.mfa_enabled) await mfa.requireStepUp(user, code);
  const had = !!user.session_pin_hash;
  const db = getDb();
  await db.tx(async (t) => {
    await t.query('UPDATE users SET session_pin_hash=$2, session_pin_set_at=now(), pin_failed_count=0, pin_locked_until=NULL WHERE id=$1', [user.id, await hashPin(user.id, pin)]);
    await audit.record(t, ctx, { action: had ? 'pin.change' : 'pin.set', targetType: 'user', targetId: user.id });
  });
  await notify(user.id, { category: 'security', title: had ? 'Session PIN changed' : 'Session PIN set', body: had ? 'Your six-digit session PIN was changed.' : 'A six-digit session PIN was set for your profile.', link: '/app/settings/security',
    email: { template: 'security_alert', data: { firstName: user.first_name, title: had ? 'Your session PIN was changed' : 'A session PIN was set', message: 'If this was not you, sign in and change your password, then contact customer support.', time: new Date().toUTCString(), ip: ctx.ip } } });
  return { pinSet: true };
}

/**
 * Verifies a PIN for an unlock attempt. Returns on success; throws 422 on a wrong PIN, 429 during a delay, and reports
 * `endSession: true` through the error details when the limit is reached (the caller revokes the session).
 */
export async function verifyForUnlock(ctx, user, pin) {
  if (!user.session_pin_hash) throw validationError({ pin: ['Set up your session PIN first.'] });
  const db = getDb();
  const fresh = (await db.query('SELECT pin_failed_count, pin_locked_until FROM users WHERE id=$1', [user.id])).rows[0];
  if (fresh.pin_locked_until && new Date(fresh.pin_locked_until) > new Date()) {
    const secs = Math.ceil((new Date(fresh.pin_locked_until) - Date.now()) / 1000);
    throw tooMany(`Too many incorrect PIN attempts. Try again in ${secs} seconds.`);
  }
  if (typeof pin === 'string' && PIN_RE.test(pin) && (await checkPin(user, pin))) {
    await db.query('UPDATE users SET pin_failed_count=0, pin_locked_until=NULL WHERE id=$1', [user.id]);
    return { ok: true };
  }
  const count = fresh.pin_failed_count + 1;
  const delay = count >= 5 ? 0 : count === 4 ? 60 : count === 3 ? 15 : 0;
  await db.query('UPDATE users SET pin_failed_count=$2, pin_locked_until=CASE WHEN $3::int > 0 THEN now() + make_interval(secs => $3::int) ELSE NULL END WHERE id=$1', [user.id, count >= 5 ? 0 : count, delay]);
  await audit.record(db, ctx, { action: 'pin.unlock_failed', targetType: 'user', targetId: user.id, metadata: { attempt: count } });
  return { ok: false, endSession: count >= 5, attempt: count };
}
