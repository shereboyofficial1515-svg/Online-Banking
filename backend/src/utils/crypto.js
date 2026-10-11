import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
export const hmacSha256Hex = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

// Alphabet without ambiguous characters (no I, L, O, U, 0, 1).
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export const newReference = (prefix = 'EWB') => `${prefix}-${randomCode(4)}${randomCode(4)}${randomCode(4)}`;
// EWB Bank account numbers are exactly 12 digits: the fixed bank code 605 followed by 9 random digits.
export const BANK_CODE = '605';
export const ACCOUNT_NUMBER_RE = /^605\d{9}$/;
export const LEGACY_ACCOUNT_NUMBER_RE = /^EWB\d{10}$/; // numbers issued before the standard; still resolvable, never generated
export const isValidAccountNumber = (v) => typeof v === 'string' && ACCOUNT_NUMBER_RE.test(v);
export function newAccountNumber() {
  return `${BANK_CODE}${String(crypto.randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
}

// Encrypt-at-rest for TOTP secrets (AES-256-GCM, key derived from a server secret).
export function encryptSecret(plain, keyMaterial) {
  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export function decryptSecret(blob, keyMaterial) {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
