import './env.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToMinor, formatMinor } from '../src/utils/money.js';
import { passwordProblems, hashPassword, verifyPassword } from '../src/utils/passwords.js';
import { encryptSecret, decryptSecret, newReference, newAccountNumber, safeEqual } from '../src/utils/crypto.js';
import { can, ROLE_PERMISSIONS, STAFF_ROLES } from '../src/config/permissions.js';
import { renderTemplate, TEMPLATE_NAMES } from '../src/emails/templates.js';
import { sniffMime } from '../src/providers/storage.js';
import { buildProviders } from '../src/providers/index.js';
import { NullPaymentProvider, NullBankingProvider } from '../src/providers/regulated.js';
import config from '../src/config/index.js';
import { ResendEmailProvider, ConsoleEmailProvider } from '../src/providers/email.js';

describe('money', () => {
  test('parses to integer minor units without float error', () => {
    assert.equal(parseAmountToMinor('0.10'), 10);
    assert.equal(parseAmountToMinor('0.2'), 20);
    assert.equal(parseAmountToMinor('19.99'), 1999);
    assert.equal(parseAmountToMinor(1234.5), 123450);
    assert.equal(parseAmountToMinor('999999999999.99'), 99999999999999);
  });
  test('rejects invalid amounts', () => {
    for (const bad of ['0', '0.00', '-1', '1.234', 'abc', '', '1e5', '1,000', ' ', '12345678901234']) assert.throws(() => parseAmountToMinor(bad), /amount/i, bad);
  });
  test('formats', () => assert.equal(formatMinor(123456, 'USD'), '$1,234.56'));
});

describe('passwords', () => {
  test('policy', () => {
    assert.deepEqual(passwordProblems('Str0ng!Passw0rd#42'), []);
    assert.ok(passwordProblems('short1!A').length);
    assert.ok(passwordProblems('alllowercase123!').some((p) => /uppercase/.test(p)));
    assert.ok(passwordProblems('NoSymbolsHere1234').some((p) => /symbol/.test(p)));
    assert.ok(passwordProblems('MyPassword!2024xyz').some((p) => /common/.test(p)));
    assert.ok(passwordProblems('jordanlee!Aa1234567', { email: 'jordanlee@example.com' }).some((p) => /email/.test(p)));
    assert.ok(passwordProblems('A1!' + 'x'.repeat(200)).some((p) => /128/.test(p)));
  });
  test('argon2id hashing verifies and salts uniquely', async () => {
    const a = await hashPassword('Str0ng!Passw0rd#42');
    const b = await hashPassword('Str0ng!Passw0rd#42');
    assert.notEqual(a, b);
    assert.match(a, /^\$argon2id\$/);
    assert.equal(await verifyPassword(a, 'Str0ng!Passw0rd#42'), true);
    assert.equal(await verifyPassword(a, 'wrong'), false);
    assert.equal(await verifyPassword('garbage', 'x'), false);
  });
});

describe('crypto helpers', () => {
  test('secret encryption round-trips and detects tampering', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP', 'key-material');
    assert.equal(decryptSecret(blob, 'key-material'), 'JBSWY3DPEHPK3PXP');
    assert.throws(() => decryptSecret(blob, 'other-key'));
    const [iv, tag, enc] = blob.split('.');
    assert.throws(() => decryptSecret(`${iv}.${tag}.${Buffer.from('tampered').toString('base64')}`, 'key-material'));
    assert.ok(!blob.includes('JBSWY3DPEHPK3PXP'));
  });
  test('references and account numbers have the expected shape', () => {
    assert.match(newReference(), /^EWB-[A-Z2-9]{12}$/);
    assert.match(newAccountNumber(), /^605\d{9}$/);
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('RBAC matrix', () => {
  test('only super_admin has staff.manage; finance alone adjusts ledgers; customers have nothing', () => {
    assert.deepEqual(STAFF_ROLES.filter((r) => can(r, 'staff.manage')), ['super_admin']);
    assert.deepEqual(STAFF_ROLES.filter((r) => can(r, 'ledger.adjust')).sort(), ['finance_operator', 'super_admin']);
    assert.deepEqual(STAFF_ROLES.filter((r) => can(r, 'withdrawals.decide')).sort(), ['finance_operator', 'super_admin']);
    assert.equal(ROLE_PERMISSIONS.customer.length, 0);
    assert.equal(can('customer', 'dashboard.read'), false);
    assert.equal(can('nonexistent', 'dashboard.read'), false);
    assert.equal(can('support_agent', 'ledger.adjust'), false);
    assert.equal(can('security_admin', 'ledger.adjust'), false);
    assert.equal(can('compliance_admin', 'withdrawals.decide'), false);
  });
});

describe('email templates', () => {
  const sample = { firstName: 'Ana', url: 'https://app.example/x?token=abc', time: 'now', ip: '1.1.1.1', device: 'Chrome', method: 'Password', title: 'T', message: 'M', amount: 12345, currency: 'USD', reference: 'EWB-ABC', accountMasked: '••••1234', description: 'd', direction: 'credit', statusLabel: 'Verified', reason: 'r', role: 'sender', heading: 'H', subject: 'S', ticketId: 'id', severity: 'high', eventId: 'e', roleLabel: 'Support Agent', code: '482917', minutes: 15 };
  test('every required template renders with branding, security footer and support contact', () => {
    for (const name of ['welcome', 'email_verification', 'login_notification', 'password_reset', 'new_device_login', 'security_alert', 'account_approved', 'account_rejected', 'identity_status', 'withdrawal_received', 'withdrawal_blocked', 'support_notification', 'account_status', 'admin_security_alert']) {
      assert.ok(TEMPLATE_NAMES.includes(name), `missing template ${name}`);
      const { subject, html, text } = renderTemplate(name, sample);
      assert.ok(subject.length > 5, name);
      assert.match(html, /EWB/);
      assert.match(html, /Security tip/);
      assert.match(html, /keep your password and verification codes private/);
      assert.match(html, /mailto:/);
      assert.doesNotMatch(html, /licen[cs]e|technology platform|not insured/i, 'no negative disclaimer in the email footer');
      assert.doesNotMatch(html, /ledger/i, 'customer emails never use the word ledger');
      assert.match(html, /\/terms"/); // full terms one click away
      assert.ok(text.length > 40 && !/<[a-z]/.test(text), `${name} text part has markup`);
      assert.doesNotMatch(html, /East West/i);
    }
  });
  test('transaction-related templates carry the reference and timestamp', () => {
    for (const n of ['ledger_adjustment', 'withdrawal_received', 'withdrawal_update']) assert.match(renderTemplate(n, sample).html, /EWB-ABC/);
    assert.match(renderTemplate('ledger_adjustment', sample).html, /Posted \(UTC\)/);
  });
  test('all dynamic values are HTML-escaped', () => {
    const { html } = renderTemplate('security_alert', { ...sample, firstName: '<img src=x onerror=alert(1)>', title: '"><script>alert(1)</script>', message: '<b>x</b>' });
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;/);
  });
  test('withdrawal emails never claim funds were sent', () => {
    for (const n of ['withdrawal_received', 'withdrawal_blocked']) assert.match(renderTemplate(n, { ...sample, message: 'Held.' }).html, /No funds have been sent/);
    assert.doesNotMatch(renderTemplate('withdrawal_received', sample).html, /has been sent to your bank|transfer (is )?complete/i);
  });
  test('no template ever includes a password field', () => {
    for (const n of TEMPLATE_NAMES) assert.doesNotMatch(renderTemplate(n, sample).html, /Your password is|temporary password/i);
  });
});

describe('uploads & providers', () => {
  test('content sniffing trusts bytes, not names', () => {
    assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
    assert.equal(sniffMime(Buffer.from('%PDF-1.7 ...')), 'application/pdf');
    assert.equal(sniffMime(Buffer.from('<svg onload=alert(1)></svg>')), null);
    assert.equal(sniffMime(Buffer.from('MZ\x90\x00')), null);
    assert.equal(sniffMime(Buffer.from('#!/bin/sh\nrm -rf /')), null);
  });
  test('real-money providers are inert and fail loudly', async () => {
    await assert.rejects(new NullPaymentProvider().createPayout(), (e) => e.status === 501 && e.code === 'PROVIDER_NOT_CONFIGURED');
    await assert.rejects(new NullBankingProvider().initiateExternalTransfer(), (e) => e.status === 501);
  });
  test('LEDGER_MODE=live refuses to start without enabled payment + banking providers', () => {
    const original = config.ledger.mode;
    config.ledger.mode = 'live';
    try { assert.throws(() => buildProviders(), /requires enabled PaymentProvider and BankingProvider/); } finally { config.ledger.mode = original; }
    assert.doesNotThrow(() => buildProviders());
  });
  test('ledger service source has no path to payment or banking providers', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['ledgerService.js', 'withdrawalService.js', 'accountService.js']) {
      const src = readFileSync(new URL(`../src/services/${f}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /providers\(\)\.(payment|banking)/, f);
    }
  });
});

describe('email providers', () => {
  test('Resend provider calls the Resend API with bearer auth and returns the message id', async () => {
    const original = { fetch: globalThis.fetch, key: config.email.resendApiKey, from: config.email.from };
    let call;
    globalThis.fetch = async (url, init) => { call = { url, init }; return { ok: true, json: async () => ({ id: 'msg_123' }) }; };
    config.email.resendApiKey = 're_test_key'; config.email.from = 'EWB Bank <no-reply@example.test>';
    try {
      const out = await new ResendEmailProvider().send({ to: 'a@example.test', subject: 'Hi', html: '<p>x</p>', text: 'x' });
      assert.deepEqual(out, { id: 'msg_123', status: 'sent' });
      assert.equal(call.url, 'https://api.resend.com/emails');
      assert.equal(call.init.headers.Authorization, 'Bearer re_test_key');
      const body = JSON.parse(call.init.body);
      assert.deepEqual(body.to, ['a@example.test']);
      assert.equal(body.from, 'EWB Bank <no-reply@example.test>');
    } finally { globalThis.fetch = original.fetch; config.email.resendApiKey = original.key; config.email.from = original.from; }
  });
  test('Resend failures surface as errors (so the outbox records "failed", never "sent")', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'invalid from address' });
    try { await assert.rejects(new ResendEmailProvider().send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }), /Resend responded 422/); }
    finally { globalThis.fetch = original; }
  });
  test('console provider never claims delivery', async () => {
    assert.equal((await new ConsoleEmailProvider().send({ to: 'a@example.test', subject: 's', text: 't' })).status, 'logged_only');
  });
});
