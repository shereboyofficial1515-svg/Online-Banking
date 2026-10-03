import { hash, verify } from '@node-rs/argon2';

// Argon2id (algorithm 2) with OWASP-minimum parameters.
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw) => hash(pw, OPTS);
export const verifyPassword = (hashed, pw) => verify(hashed, pw).catch(() => false);

const COMMON = ['password', 'qwerty', '123456', 'letmein', 'welcome', 'iloveyou', 'admin123'];
export function passwordProblems(pw, context = {}) {
  const p = [];
  if (typeof pw !== 'string' || pw.length < 12) p.push('at least 12 characters');
  if (typeof pw === 'string' && pw.length > 128) p.push('no more than 128 characters');
  if (!/[a-z]/.test(pw)) p.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) p.push('an uppercase letter');
  if (!/\d/.test(pw)) p.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) p.push('a symbol');
  const lower = String(pw).toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) p.push('no common words such as "password"');
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) p.push('no part of your email address');
  return p;
}
