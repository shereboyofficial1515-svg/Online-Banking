// Passkeys via WebAuthn. The server only ever receives and stores a public key + credential id +
// signature counter. Fingerprint / face / device-PIN checks happen entirely inside the user's authenticator;
// no biometric data (raw or templated) ever reaches EWB Bank.
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as users from '../repositories/users.js';
import * as auth from './authService.js';
import * as audit from './auditService.js';
import * as security from './securityEventService.js';
import { notify } from './notificationService.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../utils/errors.js';

const { rpId, rpName, origins } = config.webauthn;
const b64 = (u8) => Buffer.from(u8).toString('base64url');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

async function saveChallenge(userId, purpose, challenge) {
  await getDb().query('INSERT INTO webauthn_challenges (user_id, purpose, challenge, expires_at) VALUES ($1,$2,$3,$4)', [userId, purpose, challenge, new Date(Date.now() + 5 * 60_000)]);
}
/** Single-use challenge lookup keyed on the challenge echoed inside clientDataJSON. */
async function consumeChallenge(response, purpose, userId) {
  let challenge;
  try { challenge = JSON.parse(Buffer.from(response?.response?.clientDataJSON ?? '', 'base64url').toString('utf8')).challenge; } catch { /* handled below */ }
  if (!challenge) throw badRequest('Invalid passkey response.');
  const { rows } = await getDb().query(
    `UPDATE webauthn_challenges SET used_at=now() WHERE challenge=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now() AND ($3::uuid IS NULL OR user_id = $3::uuid) RETURNING challenge`,
    [challenge, purpose, userId ?? null]);
  if (!rows[0]) throw unauthorized('The passkey request expired. Please try again.', 'PASSKEY_CHALLENGE_INVALID');
  return rows[0].challenge;
}

const dto = (p) => ({ id: p.id, name: p.name, deviceType: p.device_type, backedUp: p.backed_up, createdAt: p.created_at, lastUsedAt: p.last_used_at });

export async function hasAny(userId) {
  return (await getDb().query('SELECT 1 FROM passkeys WHERE user_id=$1 LIMIT 1', [userId])).rows.length > 0;
}

export async function list(userId) {
  const { rows } = await getDb().query('SELECT * FROM passkeys WHERE user_id=$1 ORDER BY created_at', [userId]);
  return rows.map(dto);
}

export async function registrationOptions(user) {
  const existing = (await getDb().query('SELECT credential_id, transports FROM passkeys WHERE user_id=$1', [user.id])).rows;
  const options = await generateRegistrationOptions({
    rpName, rpID: rpId, userName: user.email, userDisplayName: `${user.first_name} ${user.last_name}`,
    userID: new TextEncoder().encode(user.id), attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    // "required" => the device must verify the user (fingerprint, face, or device PIN as the fallback).
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  await saveChallenge(user.id, 'register', options.challenge);
  return options;
}

export async function verifyRegistration(ctx, user, { response, name }) {
  const expectedChallenge = await consumeChallenge(response, 'register', user.id);
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true });
  } catch { throw badRequest('We could not verify that passkey. Please try again.'); }
  if (!result.verified || !result.registrationInfo) throw badRequest('We could not verify that passkey. Please try again.');
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  const db = getDb();
  if ((await db.query('SELECT 1 FROM passkeys WHERE credential_id=$1', [credential.id])).rows[0]) throw conflict('This passkey is already registered.');
  const label = String(name || '').trim().slice(0, 60) || 'My passkey';
  const row = await db.tx(async (t) => {
    const { rows } = await t.query(
      'INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *',
      [user.id, credential.id, b64(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), credentialDeviceType, credentialBackedUp, label]);
    await audit.record(t, ctx, { action: 'passkey.register', targetType: 'passkey', targetId: rows[0].id });
    return rows[0];
  });
  await security.record(db, { userId: user.id, type: 'passkey_registered', severity: 'info', summary: `Passkey "${label}" was registered`, ip: ctx.ip, sessionId: ctx.sessionId });
  await notify(user.id, { category: 'security', title: 'Passkey registered', body: `A passkey named "${label}" was added to your account.`, link: '/app/security', email: { template: 'security_alert', data: { firstName: user.first_name, title: 'A passkey was added to your account', message: `A passkey named "${label}" was registered. If you did not do this, secure your account immediately.`, time: new Date().toUTCString(), ip: ctx.ip } } });
  return dto(row);
}

export async function rename(ctx, userId, id, name) {
  const { rows } = await getDb().query('UPDATE passkeys SET name=$3 WHERE id=$1 AND user_id=$2 RETURNING *', [id, userId, name]);
  if (!rows[0]) throw notFound('Passkey not found.');
  return dto(rows[0]);
}

export async function remove(ctx, user, id) {
  const db = getDb();
  const { rows } = await db.query('DELETE FROM passkeys WHERE id=$1 AND user_id=$2 RETURNING name', [id, user.id]);
  if (!rows[0]) throw notFound('Passkey not found.');
  await audit.record(db, ctx, { action: 'passkey.remove', targetType: 'passkey', targetId: id });
  await security.record(db, { userId: user.id, type: 'passkey_removed', severity: 'low', summary: `Passkey "${rows[0].name}" was removed`, ip: ctx.ip, sessionId: ctx.sessionId });
  await notify(user.id, { category: 'security', title: 'Passkey removed', body: `The passkey "${rows[0].name}" was removed.`, link: '/app/security' });
}

// ───────── passwordless sign-in ─────────
/**
 * Passwordless sign-in always uses discoverable credentials (no allowCredentials list), so the response is
 * identical whether or not an account exists and cannot be used to enumerate customers.
 */
export async function authenticationOptions() {
  const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required' });
  await saveChallenge(null, 'authenticate', options.challenge);
  return options;
}

export async function authenticate(ctx, { response }, deviceCookie) {
  const expectedChallenge = await consumeChallenge(response, 'authenticate', null);
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM passkeys WHERE credential_id=$1', [response?.id ?? '']);
  const pk = rows[0];
  if (!pk) throw unauthorized('We could not sign you in with that passkey.', 'INVALID_CREDENTIALS');
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: fromB64(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
    });
  } catch { throw unauthorized('We could not sign you in with that passkey.', 'INVALID_CREDENTIALS'); }
  if (!result.verified) throw unauthorized('We could not sign you in with that passkey.', 'INVALID_CREDENTIALS');
  await db.query('UPDATE passkeys SET counter=$2, last_used_at=now() WHERE id=$1', [pk.id, result.authenticationInfo.newCounter]);

  const user = await users.findById(db, pk.user_id);
  if (auth.isStaff(user)) throw forbidden('Administrator accounts must sign in with a password and authenticator code.', 'PASSKEY_NOT_ALLOWED_FOR_STAFF');
  if (user.status === 'locked') throw forbidden('Your account is locked. Please contact EWB Bank Customer Support.', 'ACCOUNT_LOCKED');
  if (user.status === 'rejected') throw forbidden('Your application was not approved.', 'ACCOUNT_REJECTED');
  if (!user.email_verified_at) throw forbidden('Please verify your email address before signing in.', 'EMAIL_NOT_VERIFIED');
  // A verified passkey with user verification is itself multi-factor (possession + biometric/PIN).
  return auth.completeLogin(ctx, user, { method: 'passkey', mfaVerified: true, deviceCookie });
}


// ───────── re-authentication of an already signed-in user (session unlock) ─────────
/** Options limited to this user's own credentials. */
export async function unlockOptions(user) {
  const { rows } = await getDb().query('SELECT credential_id, transports FROM passkeys WHERE user_id=$1', [user.id]);
  if (!rows.length) throw badRequest('You have no passkeys registered.');
  const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required', allowCredentials: rows.map((r) => ({ id: r.credential_id, transports: r.transports || undefined })) });
  await saveChallenge(user.id, 'authenticate', options.challenge);
  return options;
}

/** Verifies a WebAuthn assertion for one of THIS user's passkeys (signature, origin, RP ID, user verification, counter). */
export async function verifyForUser(user, response) {
  const expectedChallenge = await consumeChallenge(response, 'authenticate', user.id);
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM passkeys WHERE credential_id=$1 AND user_id=$2', [response?.id ?? '', user.id]);
  const pk = rows[0];
  if (!pk) throw unauthorized('We could not verify that passkey.', 'INVALID_CREDENTIALS');
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: fromB64(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
    });
  } catch { throw unauthorized('We could not verify that passkey.', 'INVALID_CREDENTIALS'); }
  if (!result.verified) throw unauthorized('We could not verify that passkey.', 'INVALID_CREDENTIALS');
  await db.query('UPDATE passkeys SET counter=$2, last_used_at=now() WHERE id=$1', [pk.id, result.authenticationInfo.newCounter]);
}
