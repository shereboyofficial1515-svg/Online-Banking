// TOTP multi-factor authentication (RFC 6238) with single-use recovery codes.
// Secrets are encrypted at rest (AES-256-GCM). An accepted time-step can never be reused (replay protection).
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as users from '../repositories/users.js';
import * as security from './securityEventService.js';
import * as audit from './auditService.js';
import { encryptSecret, decryptSecret, randomCode, sha256 } from '../utils/crypto.js';
import { verifyPassword } from '../utils/passwords.js';
import { STAFF_ROLES } from '../config/permissions.js';
import { conflict, forbidden, unauthorized } from '../utils/errors.js';

const KEY = () => `${config.auth.jwtRefreshSecret}:totp`;
const makeTotp = (base32, label) => new OTPAuth.TOTP({ issuer: config.auth.totpIssuer, label, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(base32) });

function checkCode(base32, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const delta = makeTotp(base32, 'x').validate({ token: String(code), window: 1 });
  return delta === null ? null : Math.floor(Date.now() / 30_000) + delta;
}

/** Used only by development seed scripts to pre-enrol seeded staff with a known authenticator secret. */
export const encryptTotpSecret = (base32) => encryptSecret(base32, KEY());
export const currentTotpCode = (base32) => makeTotp(base32, 'seed').generate();

export async function beginSetup(user) {
  if (user.mfa_enabled) throw conflict('Multi-factor authentication is already enabled.');
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await users.update(getDb(), user.id, { mfa_pending_secret_enc: encryptSecret(secret, KEY()) });
  const uri = makeTotp(secret, user.email).toString();
  return { manualKey: secret, otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => { const c = randomCode(10); return `${c.slice(0, 5)}-${c.slice(5)}`; });
}
async function storeRecoveryCodes(q, userId, codes) {
  await q.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [userId]);
  for (const c of codes) await q.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)', [userId, sha256(c)]);
}

export async function confirmSetup(ctx, user, code) {
  if (!user.mfa_pending_secret_enc) throw conflict('Start MFA setup first.');
  const secret = decryptSecret(user.mfa_pending_secret_enc, KEY());
  const step = checkCode(secret, code);
  if (step === null) throw unauthorized('That code is not valid. Check your authenticator app and try again.', 'INVALID_MFA_CODE');
  const codes = newRecoveryCodes();
  const db = getDb();
  await db.tx(async (t) => {
    await users.update(t, user.id, { mfa_enabled: true, mfa_secret_enc: user.mfa_pending_secret_enc, mfa_pending_secret_enc: null, mfa_last_step: step });
    await storeRecoveryCodes(t, user.id, codes);
    await t.query('UPDATE sessions SET limited=false, mfa_verified_at=now() WHERE id=$1', [ctx.sessionId]);
    await audit.record(t, ctx, { action: 'mfa.enable', targetType: 'user', targetId: user.id });
  });
  await security.record(db, { userId: user.id, type: 'mfa_enabled', severity: 'info', summary: 'Multi-factor authentication was enabled', ip: ctx.ip, sessionId: ctx.sessionId });
  return { recoveryCodes: codes };
}

/** Verify a TOTP code and burn its time-step. Returns true/false; never throws on a wrong code. */
export async function verifyAndConsumeTotp(user, code) {
  if (!user.mfa_enabled || !user.mfa_secret_enc) return false;
  const step = checkCode(decryptSecret(user.mfa_secret_enc, KEY()), code);
  if (step === null) return false;
  const { rowCount } = await getDb().query('UPDATE users SET mfa_last_step=$2 WHERE id=$1 AND mfa_last_step < $2', [user.id, step]);
  return rowCount === 1;
}

export async function consumeRecoveryCode(user, code) {
  const norm = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(norm)) return false;
  const { rowCount } = await getDb().query('UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL', [user.id, sha256(norm)]);
  return rowCount === 1;
}

/** Fresh-code requirement for sensitive staff actions (e.g. ledger credits). Recovery codes are not accepted here. */
export async function requireStepUp(user, code) {
  if (!user.mfa_enabled) throw forbidden('Multi-factor authentication must be enabled to perform this action.', 'MFA_ENROLLMENT_REQUIRED');
  if (!(await verifyAndConsumeTotp(user, code))) throw forbidden('A valid, unused authenticator code is required to confirm this action.', 'MFA_STEP_UP_FAILED');
}

export async function disable(ctx, user, { password, code }) {
  if (STAFF_ROLES.includes(user.role)) throw forbidden('MFA cannot be disabled on administrator accounts.');
  if (!(await verifyPassword(user.password_hash, password))) throw unauthorized('Password is incorrect.', 'INVALID_CREDENTIALS');
  if (!(await verifyAndConsumeTotp(user, code))) throw unauthorized('That code is not valid.', 'INVALID_MFA_CODE');
  const db = getDb();
  await db.tx(async (t) => {
    await users.update(t, user.id, { mfa_enabled: false, mfa_secret_enc: null, mfa_pending_secret_enc: null });
    await t.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [user.id]);
    await t.query('UPDATE devices SET trusted_until=NULL WHERE user_id=$1', [user.id]);
    await audit.record(t, ctx, { action: 'mfa.disable', targetType: 'user', targetId: user.id });
  });
  await security.record(db, { userId: user.id, type: 'mfa_disabled', severity: 'medium', summary: 'Multi-factor authentication was disabled', ip: ctx.ip, sessionId: ctx.sessionId });
}

export async function regenerateRecoveryCodes(ctx, user, code) {
  if (!(await verifyAndConsumeTotp(user, code))) throw unauthorized('That code is not valid.', 'INVALID_MFA_CODE');
  const codes = newRecoveryCodes();
  const db = getDb();
  await db.tx(async (t) => {
    await storeRecoveryCodes(t, user.id, codes);
    await audit.record(t, ctx, { action: 'mfa.recovery_codes_regenerated', targetType: 'user', targetId: user.id });
  });
  return { recoveryCodes: codes };
}

export async function recoveryCodesRemaining(userId) {
  const { rows } = await getDb().query('SELECT count(*)::bigint n FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL', [userId]);
  return rows[0].n;
}
