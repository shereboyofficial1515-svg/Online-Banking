import './env.js';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { initDb, closeDb, getDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { initProviders } from '../src/providers/index.js';
import { createApp } from '../src/app.js';
import * as users from '../src/repositories/users.js';
import * as accountService from '../src/services/accountService.js';
import * as mfa from '../src/services/mfaService.js';
import { hashPassword } from '../src/utils/passwords.js';

export const PASSWORD = 'Str0ng!Passw0rd#42';
let seq = 0;

export async function boot() {
  const db = await initDb();
  await migrate(db);
  initProviders();
  return { app: createApp(), db };
}
export const shutdown = () => closeDb();

/** Cookie-aware API client that handles the CSRF double-submit automatically. */
export function client(app) {
  const agent = request.agent(app);
  let csrf = null;
  const ensure = async () => { if (!csrf) csrf = (await agent.get('/api/auth/csrf')).body.csrfToken; };
  const write = (method) => async (url, body, headers = {}) => {
    await ensure();
    let r = agent[method](url).set('X-CSRF-Token', csrf);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body === undefined ? r : r.send(body);
  };
  return {
    agent,
    get: (url) => agent.get(url),
    post: write('post'), put: write('put'), patch: write('patch'), delete: write('delete'),
    csrfToken: async () => { await ensure(); return csrf; },
  };
}

/** A valid, unique Nigerian mobile number (E.164). Tests need real numbers because the API validates them per country. */
let phoneSeq = Math.floor(Math.random() * 1_000_000);
export const uniquePhone = () => `+234803${String(1_000_000 + ((phoneSeq++ * 7919) % 8_999_999)).slice(0, 7)}`;
export const uniqueEmail = (p = 'user') => `${p}${Date.now()}${seq++}@example.test`;

export const registrationBody = (over = {}) => ({
  email: uniqueEmail(), password: PASSWORD, firstName: 'Taylor', lastName: 'Reed', phone: uniquePhone(), dateOfBirth: '1990-05-17',
  addressLine1: '12 Harbor Road', city: 'Boston', state: 'MA', postalCode: '02110', country: 'US', acceptedTerms: true, ...over,
});

/** Create a ready-to-use customer directly in the DB (verified email, active account). */
export async function makeCustomer({ verified = false, accountActive = true, over = {} } = {}) {
  const db = getDb();
  const email = over.email || uniqueEmail('cust');
  const u = await users.create(db, { email, firstName: 'Casey', lastName: 'Doe', passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), role: 'customer', status: 'active', ...over });
  const acct = await accountService.openDefaultAccount(db, u.id);
  if (accountActive) await db.query("UPDATE accounts SET status='active' WHERE id=$1", [acct.id]);
  if (verified) await users.update(db, u.id, { verification_status: 'verified' });
  return { user: u, email, accountId: acct.id, accountNumber: acct.account_number };
}

export async function login(c, email, password = PASSWORD) {
  return c.post('/api/auth/login', { identifier: email, password });
}

// ───────── staff helpers ─────────
const totp = (secret) => new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });

export async function makeStaff(role, { enrolled = true } = {}) {
  const db = getDb();
  const email = uniqueEmail(role);
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const u = await users.create(db, { email, firstName: 'Staff', lastName: role, passwordHash: await hashPassword(PASSWORD), role, status: 'active', emailVerifiedAt: new Date() });
  if (enrolled) await users.update(db, u.id, { mfa_enabled: true, mfa_secret_enc: mfa.encryptTotpSecret(secret) });
  return { user: u, email, secret };
}
/** A code that is valid now and has not been consumed (resets replay guard, which tests share across steps). */
export async function freshCode(staff) {
  await getDb().query('UPDATE users SET mfa_last_step=0 WHERE id=$1', [staff.user.id]);
  return totp(staff.secret).generate();
}
export async function loginStaff(app, staff) {
  const c = client(app);
  const r1 = await login(c, staff.email);
  if (r1.body.mfaRequired) {
    const r2 = await c.post('/api/auth/login/mfa', { mfaToken: r1.body.mfaToken, code: await freshCode(staff) });
    if (r2.status !== 200) throw new Error(`staff MFA login failed: ${r2.status} ${JSON.stringify(r2.body)}`);
  }
  return c;
}

export async function latestEmail(db, to, template) {
  const { rows } = await db.query('SELECT * FROM email_outbox WHERE to_email=$1 AND template=$2 ORDER BY created_at DESC LIMIT 1', [to, template]);
  return rows[0];
}
export const codeFromEmail = (row) => row.body_html.match(/>(\d{6})</)[1];
export const tokenFromEmail = (row, param = 'token') => row.body_html.match(new RegExp(`${param}=([\\w-]+)`))[1];

export async function fund(app, db, accountId, amount = '1000.00', currency = 'USD') {
  const finance = await makeStaff('finance_operator');
  const c = await loginStaff(app, finance);
  const r = await c.post('/api/ledger/adjustments', { accountId, direction: 'credit', amount, currency, reason: 'Test funding for automated tests', mfaCode: await freshCode(finance), idempotencyKey: `k-${Date.now()}-${seq++}` });
  if (r.status !== 201) throw new Error(`fund failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
