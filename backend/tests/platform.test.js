import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, fund, latestEmail, PASSWORD, uniqueEmail } from './helpers.js';
import config from '../src/config/index.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const upload = async (c, url, fields, files) => {
  let r = c.agent.post(url).set('X-CSRF-Token', await c.csrfToken());
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  for (const f of files) r = r.attach(f.field, f.buffer, { filename: f.name, contentType: f.type || 'application/octet-stream' });
  return r;
};

describe('identity verification', () => {
  test('manual-review flow: start -> upload -> submit -> compliance verifies -> status + email + audit', async () => {
    const cust = await makeCustomer();
    const c = client(app);
    await login(c, cust.email);
    assert.equal((await c.get('/api/verification/status')).body.status, 'not_started');
    const start = await c.post('/api/verification/start');
    assert.equal(start.status, 201);
    assert.equal(start.body.status, 'verification_required');

    assert.equal((await c.post('/api/verification/submit')).status, 400, 'documents required first');
    const bad = await upload(c, '/api/verification/documents', { kind: 'id_front' }, [{ field: 'file', buffer: Buffer.from('not an image'), name: 'x.png', type: 'image/png' }]);
    assert.equal(bad.status, 400, 'content sniffing rejects disguised files');
    assert.equal((await upload(c, '/api/verification/documents', { kind: 'id_front' }, [{ field: 'file', buffer: PNG, name: 'id.png', type: 'image/png' }])).status, 200);
    assert.equal((await upload(c, '/api/verification/documents', { kind: 'selfie' }, [{ field: 'file', buffer: PNG, name: 'me.png', type: 'image/png' }])).status, 200);
    const sub = await c.post('/api/verification/submit');
    assert.equal(sub.body.status, 'manual_review');

    const comp = await makeStaff('compliance_admin');
    const cc = await loginStaff(app, comp);
    const queue = await cc.get('/api/admin/verification?status=manual_review');
    const item = queue.body.items.find((i) => i.userId === cust.user.id);
    assert.ok(item);
    const detail = await cc.get(`/api/admin/verification/${item.id}`);
    assert.equal(detail.body.verification.documents.length, 2);
    const doc = await cc.agent.get(`/api/admin/verification/documents/${detail.body.verification.documents[0].id}`);
    assert.equal(doc.status, 200);
    assert.equal(doc.headers['content-type'], 'image/png');
    assert.equal((await db.query("SELECT 1 FROM audit_logs WHERE action='verification.document_view'")).rows.length > 0, true, 'viewing a KYC document is audited');
    // the customer cannot fetch the staff document route
    assert.equal((await c.get(`/api/admin/verification/documents/${detail.body.verification.documents[0].id}`)).status, 403);

    const rv = await cc.post(`/api/admin/verification/${item.id}/review`, { decision: 'verified', reason: 'Documents match profile' });
    assert.equal(rv.status, 200);
    assert.equal((await c.get('/api/verification/status')).body.status, 'verified');
    assert.equal((await db.query('SELECT verification_status FROM users WHERE id=$1', [cust.user.id])).rows[0].verification_status, 'verified');
    assert.ok(await latestEmail(db, cust.email, 'identity_status'));
    assert.equal((await c.post('/api/verification/start')).status, 409);
  });

  test('provider webhook: signature + timestamp enforced; valid event updates status', async () => {
    const cust = await makeCustomer();
    const { rows: [v] } = await db.query("INSERT INTO identity_verifications (user_id, provider, provider_session_id, status) VALUES ($1,'signed_webhook','idv_test_1','pending') RETURNING id", [cust.user.id]);
    await db.query("UPDATE users SET verification_status='pending' WHERE id=$1", [cust.user.id]);
    const body = JSON.stringify({ sessionId: 'idv_test_1', status: 'verified', reason: 'Vendor approved' });
    const sign = (ts, b = body, secret = config.identity.webhookSecret) => crypto.createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex');
    const send = (headers, b = body) => client(app).agent.post('/api/verification/webhook').set('Content-Type', 'application/json').set(headers).send(b);
    const ts = Math.floor(Date.now() / 1000);

    assert.equal((await send({})).status, 401);
    assert.equal((await send({ 'x-ewb-timestamp': ts, 'x-ewb-signature': 'sha256=deadbeef' })).status, 401);
    assert.equal((await send({ 'x-ewb-timestamp': ts, 'x-ewb-signature': `sha256=${sign(ts, body, 'wrong-secret')}` })).status, 401);
    assert.equal((await send({ 'x-ewb-timestamp': ts - 3600, 'x-ewb-signature': `sha256=${sign(ts - 3600)}` })).status, 401, 'stale timestamps (replay) rejected');
    assert.equal((await db.query('SELECT status FROM identity_verifications WHERE id=$1', [v.id])).rows[0].status, 'pending');

    const ok = await send({ 'x-ewb-timestamp': ts, 'x-ewb-signature': `sha256=${sign(ts)}` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await db.query('SELECT verification_status FROM users WHERE id=$1', [cust.user.id])).rows[0].verification_status, 'verified');
    assert.equal((await send({ 'x-ewb-timestamp': ts, 'x-ewb-signature': `sha256=${sign(ts)}` })).body.duplicate, true);
    const tampered = JSON.stringify({ sessionId: 'idv_test_1', status: 'failed' });
    assert.equal((await send({ 'x-ewb-timestamp': ts, 'x-ewb-signature': `sha256=${sign(ts)}` }, tampered)).status, 401, 'body tampering detected');
  });
});

describe('customer support', () => {
  test('ticket lifecycle with attachments, staff replies, internal notes hidden from customers, emails and ownership', async () => {
    const cust = await makeCustomer();
    const c = client(app);
    await login(c, cust.email);
    const created = await upload(c, '/api/support', { category: 'account', subject: 'Need help with profile', message: 'Please update my details' }, [{ field: 'attachments', buffer: PNG, name: 'proof.png', type: 'image/png' }]);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.ticket.id;
    assert.equal(created.body.ticket.status, 'open');
    assert.ok(await latestEmail(db, cust.email, 'support_notification'));

    const evil = await upload(c, '/api/support', { category: 'other', subject: 'Malware test', message: 'Sending an executable' }, [{ field: 'attachments', buffer: Buffer.from('MZ\x90\x00 executable'), name: 'a.pdf', type: 'application/pdf' }]);
    assert.equal(evil.status, 400);

    const agent = await makeStaff('support_agent');
    const sc = await loginStaff(app, agent);
    const reply = await upload(sc, `/api/admin/support/${id}/replies`, { message: 'Internal: check KYC first', internal: 'true' }, []);
    assert.equal(reply.status, 201);
    const pub = await upload(sc, `/api/admin/support/${id}/replies`, { message: 'We have updated your profile.' }, []);
    assert.equal(pub.body.ticket.status, 'waiting_for_customer');

    const view = await c.get(`/api/support/${id}`);
    assert.equal(view.body.ticket.messages.length, 2, 'internal note hidden from customer');
    assert.ok(!JSON.stringify(view.body).includes('check KYC'));
    const attachment = view.body.ticket.messages[0].attachments[0];
    const dl = await c.agent.get(`/api/support/attachments/${attachment.id}`);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    const other = client(app);
    await login(other, (await makeCustomer()).email);
    assert.equal((await other.agent.get(`/api/support/attachments/${attachment.id}`)).status, 404);

    assert.equal((await c.post(`/api/support/${id}/replies`, { message: 'Thank you!' })).status, 201);
    assert.equal((await c.get(`/api/support/${id}`)).body.ticket.status, 'open', 'customer reply reopens a waiting ticket');
    assert.equal((await sc.post(`/api/admin/support/${id}/status`, { status: 'resolved' })).body.ticket.status, 'resolved');
    assert.equal((await c.post(`/api/support/${id}/close`)).body.ticket.status, 'closed');
    assert.equal((await c.post(`/api/support/${id}/replies`, { message: 'one more thing' })).status, 409);
  });
});

describe('notifications', () => {
  test('list, mark read, preferences (security cannot be disabled) and delivery respects preferences', async () => {
    const a = await makeCustomer({ verified: true });
    const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '100');
    const bc = client(app);
    await login(bc, b.email);
    const prefs = await bc.put('/api/notifications/preferences', { preferences: [{ category: 'transaction', inApp: false, email: false }, { category: 'security', inApp: false, email: false }] });
    assert.equal(prefs.status, 200);
    const sec = prefs.body.preferences.find((p) => p.category === 'security');
    assert.deepEqual([sec.inApp, sec.email, sec.locked], [true, true, true]);
    const ac = client(app);
    await login(ac, a.email);
    const emailsBefore = (await db.query("SELECT count(*)::bigint n FROM email_outbox WHERE to_email=$1 AND template='transfer_receipt'", [b.email])).rows[0].n;
    await ac.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '10', idempotencyKey: 'prefs-test-001' });
    const list = await bc.get('/api/notifications');
    assert.equal(list.body.items.filter((n) => n.category === 'transaction').length, 0, 'in-app transaction notification suppressed');
    assert.equal((await db.query("SELECT count(*)::bigint n FROM email_outbox WHERE to_email=$1 AND template='transfer_receipt'", [b.email])).rows[0].n, emailsBefore);
    const sender = await ac.get('/api/notifications?category=transaction');
    assert.ok(sender.body.items.length >= 1 && sender.body.unread >= 1);
    assert.equal((await ac.post(`/api/notifications/${sender.body.items[0].id}/read`)).status, 200);
    assert.equal((await ac.post('/api/notifications/read-all')).status, 200);
    assert.equal((await ac.get('/api/notifications?unreadOnly=true')).body.items.length, 0);
  });
});

describe('security center', () => {
  test('overview, session revocation, device removal and password change', async () => {
    const cust = await makeCustomer();
    const c1 = client(app); await login(c1, cust.email);
    const c2 = client(app); await login(c2, cust.email);
    const ov = await c1.get('/api/security/overview');
    assert.equal(ov.status, 200);
    assert.equal(ov.body.sessions.length, 2);
    assert.equal(ov.body.sessions.filter((s) => s.current).length, 1);
    assert.equal(ov.body.emailVerified, true);
    assert.ok(ov.body.recentActivity.length >= 2);
    assert.equal(ov.body.mfa.enabled, false);

    const other = ov.body.sessions.find((s) => !s.current);
    assert.equal((await c1.delete(`/api/security/sessions/${other.id}`)).status, 200);
    assert.equal((await c2.get('/api/auth/me')).status, 401);

    const c3 = client(app); await login(c3, cust.email);
    const NEW = 'Br4nd!New#Passw0rd';
    assert.equal((await c1.post('/api/security/password', { currentPassword: 'wrong', newPassword: NEW })).status, 401);
    assert.equal((await c1.post('/api/security/password', { currentPassword: PASSWORD, newPassword: 'weak' })).status, 422);
    assert.equal((await c1.post('/api/security/password', { currentPassword: PASSWORD, newPassword: NEW })).status, 200);
    assert.equal((await c3.get('/api/auth/me')).status, 401, 'other sessions revoked after password change');
    assert.equal((await c1.get('/api/auth/me')).status, 200, 'current session survives');
    assert.equal((await login(client(app), cust.email, NEW)).status, 200);

    const devices = (await c1.get('/api/security/overview')).body.trustedDevices;
    assert.ok(devices.length >= 1);
    assert.equal((await c1.delete(`/api/security/devices/${devices[0].id}`)).status, 200);
    assert.equal((await c1.delete(`/api/security/devices/${devices[0].id}`)).status, 404);
  });

  test('MFA can be disabled by customers only with password + code; staff cannot disable', async () => {
    const OTPAuth = await import('otpauth');
    const cust = await makeCustomer();
    const c = client(app); await login(c, cust.email);
    const setup = await c.post('/api/security/mfa/setup');
    const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(setup.body.manualKey) });
    await c.post('/api/security/mfa/enable', { code: totp.generate() });
    assert.equal((await c.post('/api/security/mfa/disable', { password: 'bad', code: '123456' })).status, 401);
    await db.query('UPDATE users SET mfa_last_step=0 WHERE id=$1', [cust.user.id]);
    assert.equal((await c.post('/api/security/mfa/disable', { password: PASSWORD, code: totp.generate() })).status, 200);
    const staff = await makeStaff('super_admin');
    const sc = await loginStaff(app, staff);
    assert.equal((await sc.post('/api/security/mfa/disable', { password: PASSWORD, code: '123456' })).status, 403);
  });
});

describe('passkeys (WebAuthn)', () => {
  test('registration options require auth, use required user verification, and bogus attestations are rejected', async () => {
    const cust = await makeCustomer();
    assert.equal((await client(app).post('/api/security/passkeys/options')).status, 401);
    const c = client(app); await login(c, cust.email);
    const opts = await c.post('/api/security/passkeys/options');
    assert.equal(opts.status, 200);
    assert.equal(opts.body.rp.id, config.webauthn.rpId);
    assert.equal(opts.body.authenticatorSelection.userVerification, 'required');
    assert.ok(opts.body.challenge.length >= 16);
    const bogus = await c.post('/api/security/passkeys/register', { response: { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: opts.body.challenge, origin: 'https://evil.example', type: 'webauthn.create' })).toString('base64url'), attestationObject: 'AAAA' }, clientExtensionResults: {} } });
    assert.equal(bogus.status, 400);
    const replay = await c.post('/api/security/passkeys/register', { response: { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: opts.body.challenge })).toString('base64url'), attestationObject: 'AAAA' }, clientExtensionResults: {} } });
    assert.equal(replay.status, 401, 'challenge is single use');
    assert.equal((await c.get('/api/security/passkeys')).body.passkeys.length, 0);
  });

  test('list / rename / remove are scoped to the owner; sign-in options are public and uniform; unknown credentials rejected', async () => {
    const a = await makeCustomer(); const b = await makeCustomer();
    await db.query("INSERT INTO passkeys (user_id, credential_id, public_key, name) VALUES ($1,'cred-a-1','pk','Laptop')", [a.user.id]);
    const ac = client(app); await login(ac, a.email);
    const bc = client(app); await login(bc, b.email);
    const list = await ac.get('/api/security/passkeys');
    assert.equal(list.body.passkeys[0].name, 'Laptop');
    assert.ok(!JSON.stringify(list.body).includes('"pk"'), 'public key material not exposed');
    const id = list.body.passkeys[0].id;
    assert.equal((await bc.patch(`/api/security/passkeys/${id}`, { name: 'Stolen' })).status, 404);
    assert.equal((await bc.delete(`/api/security/passkeys/${id}`)).status, 404);
    assert.equal((await ac.patch(`/api/security/passkeys/${id}`, { name: 'Work phone' })).body.passkey.name, 'Work phone');

    const pub = client(app);
    const known = await pub.post('/api/auth/passkey/options', { email: a.email });
    const unknown = await pub.post('/api/auth/passkey/options', { email: uniqueEmail('ghost') });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(Object.keys(known.body).sort(), Object.keys(unknown.body).sort(), 'identical shape: no account enumeration');
    assert.equal(known.body.allowCredentials, undefined);
    assert.equal(known.body.userVerification, 'required');
    const forged = await pub.post('/api/auth/passkey/verify', { response: { id: 'nope', response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: known.body.challenge })).toString('base64url') } } });
    assert.equal(forged.status, 401);
    assert.equal((await ac.delete(`/api/security/passkeys/${id}`)).status, 200);
    assert.ok(await db.query("SELECT 1 FROM security_events WHERE user_id=$1 AND type='passkey_removed'", [a.user.id]));
  });
});

describe('profile & misc', () => {
  test('profile photo accepts real images only and is served back privately', async () => {
    const cust = await makeCustomer();
    const c = client(app); await login(c, cust.email);
    assert.equal((await upload(c, '/api/users/me/photo', {}, [{ field: 'photo', buffer: Buffer.from('<svg onload=alert(1)>'), name: 'a.png', type: 'image/png' }])).status, 400);
    assert.equal((await upload(c, '/api/users/me/photo', {}, [{ field: 'photo', buffer: PNG, name: 'a.png', type: 'image/png' }])).status, 200);
    const img = await c.agent.get('/api/users/me/photo');
    assert.equal(img.status, 200);
    assert.match(img.headers['cache-control'], /private/);
  });

  test('account summary exposes chart data derived from ledger entries only', async () => {
    const cust = await makeCustomer();
    await fund(app, db, cust.accountId, '120.00');
    const c = client(app); await login(c, cust.email);
    const s = await c.get(`/api/accounts/${cust.accountId}/summary`);
    assert.equal(s.status, 200);
    assert.deepEqual(s.body.history.map((h) => h.balance), [12000]);
    assert.equal(s.body.account.availableBalance, 12000);
    assert.equal(s.body.account.balance, 12000, 'customer API exposes "balance"');
    assert.equal(s.body.account.ledgerBalance, undefined, 'no ledger terminology in the customer API');
    assert.equal(s.body.monthly.at(-1).in, 12000);
  });

  test('transaction list supports search, filters and pagination', async () => {
    const a = await makeCustomer({ verified: true }); const b = await makeCustomer({ verified: true });
    await fund(app, db, a.accountId, '200');
    const c = client(app); await login(c, a.email);
    for (let i = 0; i < 3; i++) await c.post('/api/transactions/transfers', { fromAccountId: a.accountId, toAccountNumber: b.accountNumber, amount: '1', description: `Coffee ${i}`, idempotencyKey: `list-key-${i}-xxxx` });
    assert.equal((await c.get('/api/transactions')).body.total, 4);
    assert.equal((await c.get('/api/transactions?q=Coffee%201')).body.items.length, 1);
    assert.equal((await c.get('/api/transactions?type=transfer&limit=2')).body.items.length, 2);
    assert.equal((await c.get('/api/transactions?type=ledger_credit')).body.items.length, 1);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await c.get(`/api/transactions?from=${today}&to=${today}`)).body.total, 4);
    assert.equal((await c.get('/api/transactions?from=2000-01-01&to=2000-01-02')).body.total, 0);
    assert.equal((await c.get('/api/transactions?limit=abc')).status, 422);
    const sql = await c.get(`/api/transactions?q=${encodeURIComponent("'; DROP TABLE transactions;--")}`);
    assert.equal(sql.status, 200);
    assert.equal(sql.body.items.length, 0);
  });
});

describe('error handling & hardening', () => {
  test('404 and malformed JSON return clean JSON errors without internals', async () => {
    const c = client(app);
    const nf = await c.get('/api/does-not-exist');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    assert.ok(nf.body.error.requestId);
    assert.ok(!JSON.stringify(nf.body).match(/stack|node_modules|at .*\(/));
    const token = await c.csrfToken();
    const bad = await c.agent.post('/api/auth/login').set('X-CSRF-Token', token).set('Content-Type', 'application/json').send('{"identifier": ');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'BAD_REQUEST');
    const big = await c.agent.post('/api/auth/login').set('X-CSRF-Token', token).send({ identifier: 'x'.repeat(200_000), password: 'y' });
    assert.equal(big.status, 400);
  });

  test('unexpected errors are logged server-side and returned as a generic 500', async () => {
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    let out;
    const res = { status(s) { out = { status: s }; return this; }, json(b) { out.body = b; } };
    const err = Object.assign(new Error('connection to server at "db.internal" failed: password authentication failed for user "postgres"'), { code: '28P01' });
    errorHandler(err, { ctx: { requestId: 'r1' }, originalUrl: '/x', method: 'GET' }, res, () => {});
    assert.equal(out.status, 500);
    assert.equal(out.body.error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(out.body).match(/postgres|password authentication|db\.internal|28P01/i));
    assert.equal(out.body.error.requestId, 'r1');
  });

  test('security headers: CSP, no sniffing, framing denied, no x-powered-by, API responses uncached', async () => {
    const r = await client(app).get('/api/health');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.doesNotMatch(r.headers['content-security-policy'], /unsafe-eval/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-powered-by'], undefined);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['permissions-policy'], /camera=\(\)/);
  });

  test('rate limiter returns 429 with the standard error shape when enabled', async () => {
    const express = (await import('express')).default;
    const rateLimit = (await import('express-rate-limit')).default;
    const { tooMany } = await import('../src/utils/errors.js');
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    const supertest = (await import('supertest')).default;
    const mini = express();
    mini.use((req, res, next) => { req.ctx = { requestId: 'rl' }; next(); });
    mini.use(rateLimit({ windowMs: 60_000, limit: 3, handler: (req, res, next) => next(tooMany()) }));
    mini.get('/', (req, res) => res.json({ ok: true }));
    mini.use(errorHandler);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await supertest(mini).get('/')).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });
});
