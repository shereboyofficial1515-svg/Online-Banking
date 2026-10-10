import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, registrationBody, PASSWORD, login, makeCustomer, latestEmail, tokenFromEmail, codeFromEmail, uniqueEmail } from './helpers.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

describe('registration & email verification', () => {
  test('registers, requires the emailed code, then allows sign-in', async () => {
    const c = client(app);
    const body = registrationBody();
    const reg = await c.post('/api/auth/register', body);
    assert.equal(reg.status, 202);

    const blocked = await login(c, body.email);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(blocked.body.error.details.email, body.email, 'sign-in tells the (password-verified) user which address to verify');

    const mail = await latestEmail(db, body.email, 'email_verification');
    assert.ok(mail, 'verification email recorded');
    const code = codeFromEmail(mail);
    assert.match(code, /^\d{6}$/);
    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code })).status, 200);
    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code })).status, 400, 'code is single use');

    const ok = await login(c, body.email);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, body.email);
    assert.equal(ok.body.user.role, 'customer');
    assert.doesNotMatch(JSON.stringify(ok.body), /argon2|password_?hash|mfa_?secret/i, 'no credential material in response');
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
  });

  test('the verification email is professional: one message, code + button, no code in any URL, no negative wording', async () => {
    const body = registrationBody();
    await client(app).post('/api/auth/register', body);
    const all = await db.query('SELECT template, subject, body_html FROM email_outbox WHERE to_email=$1', [body.email]);
    assert.deepEqual(all.rows.map((r) => r.template), ['email_verification'], 'registration sends a single email');
    const { subject, body_html: html } = all.rows[0];
    assert.equal(subject, 'Your EWB Bank verification code');
    const code = codeFromEmail(all.rows[0]);
    assert.match(html, /Verify my email/);
    assert.match(html, /valid for 15 minutes/);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(links.some((l) => /\/verify-email$/.test(l)), 'button opens the verification page');
    assert.ok(links.every((l) => !l.includes(code) && !/token=|code=/.test(l)), 'the code never appears in a URL');
    assert.doesNotMatch(html, /not currently|not insured|will never|not (a|an) |licen[cs]e|did not expect|secure your account|unauthori[sz]ed|fraud|warning/i);
  });

  test('wrong codes are counted; five misses invalidate the code and a fresh one works', async () => {
    const c = client(app);
    const body = registrationBody();
    await c.post('/api/auth/register', body);
    const good = codeFromEmail(await latestEmail(db, body.email, 'email_verification'));
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: bad })).status, 400);
    const fifth = await c.post('/api/auth/verify-email', { email: body.email, code: bad });
    assert.match(fifth.body.error.message, /Too many incorrect attempts/);
    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: good })).status, 400, 'even the right code is dead after 5 misses');

    await db.query("UPDATE auth_tokens SET created_at = now() - interval '5 minutes' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [body.email]); // clear the resend cooldown
    await c.post('/api/auth/resend-verification', { email: body.email });
    const fresh = codeFromEmail(await latestEmail(db, body.email, 'email_verification'));
    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: fresh })).status, 200);
  });

  test('codes expire after 15 minutes, resending replaces the old code, and resends are rate-limited per address', async () => {
    const c = client(app);
    const body = registrationBody();
    await c.post('/api/auth/register', body);
    const first = codeFromEmail(await latestEmail(db, body.email, 'email_verification'));
    const uid = (await db.query('SELECT id FROM users WHERE email=$1', [body.email])).rows[0].id;

    await c.post('/api/auth/resend-verification', { email: body.email });
    assert.equal((await db.query("SELECT count(*)::int n FROM email_outbox WHERE to_email=$1 AND template='email_verification'", [body.email])).rows[0].n, 1, 'cooldown suppresses an immediate resend');

    await db.query("UPDATE auth_tokens SET created_at = now() - interval '2 minutes' WHERE user_id=$1", [uid]);
    await c.post('/api/auth/resend-verification', { email: body.email });
    const second = codeFromEmail(await latestEmail(db, body.email, 'email_verification'));
    if (second !== first) assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: first })).status, 400, 'the previous code stops working');

    await db.query("UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE user_id=$1", [uid]);
    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: second })).status, 400, 'expired code is rejected');
  });

  test('codes are stored only as keyed hashes, and the endpoint reveals nothing about accounts', async () => {
    const c = client(app);
    const body = registrationBody();
    await c.post('/api/auth/register', body);
    const code = codeFromEmail(await latestEmail(db, body.email, 'email_verification'));
    const rows = (await db.query("SELECT token_hash FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE u.email=$1", [body.email])).rows;
    assert.ok(rows.every((r) => r.token_hash !== code && !r.token_hash.includes(code) && /^[0-9a-f]{64}$/.test(r.token_hash)));

    const known = await c.post('/api/auth/verify-email', { email: body.email, code: code === '000000' ? '111111' : '000000' });
    const unknown = await c.post('/api/auth/verify-email', { email: uniqueEmail('ghost'), code: '123456' });
    const verified = await makeCustomer();
    const already = await c.post('/api/auth/verify-email', { email: verified.email, code: '123456' });
    for (const r of [known, unknown, already]) assert.equal(r.status, 400);
    assert.equal(known.body.error.message, unknown.body.error.message);
    assert.equal(unknown.body.error.message, already.body.error.message);

    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: '12ab56' })).status, 422, 'format is validated');
    assert.equal((await c.post('/api/auth/verify-email', { email: body.email, code: '12345' })).status, 422);
  });

  test('creates a pending-review account and stores only an argon2id hash', async () => {
    const body = registrationBody();
    await client(app).post('/api/auth/register', body);
    const { rows } = await db.query('SELECT id, password_hash FROM users WHERE email=$1', [body.email]);
    assert.match(rows[0].password_hash, /^\$argon2id\$/);
    assert.ok(!rows[0].password_hash.includes(body.password));
    const acct = await db.query('SELECT status, kind FROM accounts WHERE user_id=$1', [rows[0].id]);
    assert.equal(acct.rows[0].status, 'pending_review');
  });

  test('duplicate registration does not reveal that the email exists', async () => {
    const body = registrationBody();
    const first = await client(app).post('/api/auth/register', body);
    const second = await client(app).post('/api/auth/register', body);
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.deepEqual(first.body, second.body);
  });

  test('rejects weak passwords, underage users and invalid input with 422', async () => {
    const c = client(app);
    const weak = await c.post('/api/auth/register', registrationBody({ password: 'short' }));
    assert.equal(weak.status, 422);
    const common = await c.post('/api/auth/register', registrationBody({ password: 'Password123456!' }));
    assert.equal(common.status, 422);
    const minor = await c.post('/api/auth/register', registrationBody({ dateOfBirth: `${new Date().getFullYear() - 10}-01-01` }));
    assert.equal(minor.status, 422);
    assert.ok(minor.body.error.details.dateOfBirth);
    const bad = await c.post('/api/auth/register', registrationBody({ email: 'nope', firstName: '<script>' }));
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.details.email && bad.body.error.details.firstName);
  });
});

describe('login security', () => {
  test('wrong password and unknown user return the same generic 401', async () => {
    const { email } = await makeCustomer();
    const c = client(app);
    const a = await login(c, email, 'Wrong!Passw0rd#1');
    const b = await login(c, uniqueEmail('ghost'), 'Wrong!Passw0rd#1');
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  test('locks sign-in after repeated failures, records a security event, and blocks even the right password', async () => {
    const { email, user } = await makeCustomer();
    const c = client(app);
    for (let i = 0; i < 5; i++) assert.equal((await login(c, email, 'Wrong!Passw0rd#1')).status, 401);
    const locked = await login(c, email);
    assert.equal(locked.status, 429);
    const ev = await db.query("SELECT * FROM security_events WHERE user_id=$1 AND type='multiple_failed_logins'", [user.id]);
    assert.equal(ev.rows.length, 1);
  });

  test('CSRF: state-changing requests without the token are rejected', async () => {
    const { email } = await makeCustomer();
    const c = client(app);
    const raw = await c.agent.post('/api/auth/login').send({ identifier: email, password: PASSWORD });
    assert.equal(raw.status, 403);
    assert.equal(raw.body.error.code, 'CSRF_INVALID');
    const evil = await c.agent.post('/api/auth/login').set('Origin', 'https://evil.example').send({ identifier: email, password: PASSWORD });
    assert.equal(evil.status, 403);
  });

  test('session cookies are HttpOnly and SameSite=Strict', async () => {
    const { email } = await makeCustomer();
    const c = client(app);
    const r = await login(c, email);
    const cookies = r.headers['set-cookie'];
    const at = cookies.find((x) => x.startsWith('ewb_at='));
    const rt = cookies.find((x) => x.startsWith('ewb_rt='));
    for (const ck of [at, rt]) { assert.match(ck, /HttpOnly/i); assert.match(ck, /SameSite=Strict/i); }
  });

  test('refresh rotates tokens; replaying an old refresh token kills the session', async () => {
    const { email } = await makeCustomer();
    const c = client(app);
    const r = await login(c, email);
    const oldRt = r.headers['set-cookie'].find((x) => x.startsWith('ewb_rt=')).split(';')[0];
    assert.equal((await c.post('/api/auth/refresh')).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 200);
    // attacker replays the stale token
    const attacker = client(app);
    const replay = await attacker.post('/api/auth/refresh', undefined, { Cookie: oldRt });
    assert.equal(replay.status, 401);
    // legitimate session is revoked as a precaution
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 401);
  });

  test('logout ends the session server-side', async () => {
    const { email } = await makeCustomer();
    const c = client(app);
    await login(c, email);
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  test('a new-device sign-in produces a notification email and security event', async () => {
    const { email, user } = await makeCustomer();
    await login(client(app), email);
    assert.ok(await latestEmail(db, email, 'new_device_login'));
    const ev = await db.query("SELECT 1 FROM security_events WHERE user_id=$1 AND type='new_device_login'", [user.id]);
    assert.equal(ev.rows.length, 1);
  });
});

describe('password reset', () => {
  test('reset flow: single-use token, revokes sessions, notifies', async () => {
    const { email } = await makeCustomer();
    const c = client(app);
    await login(c, email);
    const gen = await c.post('/api/auth/forgot-password', { email });
    assert.equal(gen.status, 202);
    const unknown = await c.post('/api/auth/forgot-password', { email: uniqueEmail('none') });
    assert.deepEqual(gen.body, unknown.body);
    const token = tokenFromEmail(await latestEmail(db, email, 'password_reset'));
    const weak = await c.post('/api/auth/reset-password', { token, password: 'weak' });
    assert.equal(weak.status, 422);
    const NEW = 'An0ther!Str0ng#Pass';
    assert.equal((await c.post('/api/auth/reset-password', { token, password: NEW })).status, 200);
    assert.equal((await c.post('/api/auth/reset-password', { token, password: NEW })).status, 400);
    assert.equal((await c.get('/api/auth/me')).status, 401, 'old session revoked');
    assert.equal((await login(client(app), email, NEW)).status, 200);
    assert.equal((await login(client(app), email, PASSWORD)).status, 401);
    assert.ok(await latestEmail(db, email, 'password_changed'));
  });
});

describe('customer MFA (TOTP)', () => {
  test('enrol, sign in with code, reject replayed code, recovery code works once', async () => {
    const OTPAuth = await import('otpauth');
    const { email } = await makeCustomer();
    const c = client(app);
    await login(c, email);
    const setup = await c.post('/api/security/mfa/setup');
    assert.equal(setup.status, 200);
    assert.ok(setup.body.qrDataUrl.startsWith('data:image/png'));
    const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(setup.body.manualKey) });
    assert.equal((await c.post('/api/security/mfa/enable', { code: '000000' })).status, 401);
    const en = await c.post('/api/security/mfa/enable', { code: totp.generate() });
    assert.equal(en.status, 200);
    assert.equal(en.body.recoveryCodes.length, 10);

    const c2 = client(app);
    const step1 = await login(c2, email);
    assert.equal(step1.body.mfaRequired, true);
    assert.equal(step1.headers['set-cookie']?.some((x) => x.startsWith('ewb_at=')) ?? false, false, 'no session before MFA');
    // the enrolment consumed the current time-step, so replaying it must fail
    const replay = await c2.post('/api/auth/login/mfa', { mfaToken: step1.body.mfaToken, code: totp.generate() });
    assert.equal(replay.status, 401);
    const rec = await c2.post('/api/auth/login/mfa', { mfaToken: step1.body.mfaToken, recoveryCode: en.body.recoveryCodes[0] });
    assert.equal(rec.status, 200);
    const c3 = client(app);
    const s3 = await login(c3, email);
    assert.equal((await c3.post('/api/auth/login/mfa', { mfaToken: s3.body.mfaToken, recoveryCode: en.body.recoveryCodes[0] })).status, 401, 'recovery code is single use');
  });
});
