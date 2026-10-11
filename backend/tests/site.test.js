import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer, makeStaff, loginStaff, freshCode, registrationBody } from './helpers.js';
import { DEFAULT_SITE_CONFIG } from '../src/content/siteDefaults.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

// Minimal well-formed PNG header (identification reads dimensions from IHDR only).
const png = (w, h) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const upload = async (c, kind, buf, name = 'pic.png') => c.agent.post('/api/admin/site/assets').set('X-CSRF-Token', await c.csrfToken()).field('kind', kind).attach('file', buf, name);
const clone = () => structuredClone(DEFAULT_SITE_CONFIG);

describe('public website content', () => {
  test('serves built-in defaults when nothing has been published, without logging in', async () => {
    const r = await client(app).get('/api/public/site');
    assert.equal(r.status, 200);
    assert.equal(r.body.config.brand.siteName, 'EWB Bank');
    assert.equal(r.body.fallback, true);
  });

  test('falls back to defaults if the stored configuration is corrupt (the public site never errors)', async () => {
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    const cfg = clone(); cfg.brand.siteName = 'Corrupt Test Bank';
    await admin.put('/api/admin/site/draft', { config: cfg });
    assert.equal((await admin.post('/api/admin/site/publish', {})).status, 200);
    assert.equal((await client(app).get('/api/public/site')).body.config.brand.siteName, 'Corrupt Test Bank');
    // Simulate damage by bypassing the app: a row that no longer satisfies the schema.
    await db.query('ALTER TABLE site_config_versions DISABLE TRIGGER site_config_frozen_trg');
    await db.query(`UPDATE site_config_versions SET config='{"brand":{"siteName":"x","colors":{"primary":"red"}}}'::jsonb WHERE status='published'`);
    await db.query('ALTER TABLE site_config_versions ENABLE TRIGGER site_config_frozen_trg');
    const r = await client(app).get('/api/public/site');
    assert.equal(r.status, 200);
    assert.equal(r.body.fallback, true);
    assert.equal(r.body.config.brand.siteName, 'EWB Bank');
  });
});

describe('admin website editor', () => {
  test('draft is invisible to visitors until published; publish creates numbered versions; restore goes via the draft', async () => {
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    const before = (await client(app).get('/api/public/site')).body.version;
    const cfg = clone(); cfg.home.headline = 'A brand new headline'; cfg.contact.email = 'hello@example.test';
    const saved = await admin.put('/api/admin/site/draft', { config: cfg });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.hasDraft, true);
    assert.notEqual((await client(app).get('/api/public/site')).body.config.home.headline, 'A brand new headline', 'drafts are not public');

    const pub = await admin.post('/api/admin/site/publish', { note: 'New headline' });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    const live = (await client(app).get('/api/public/site')).body;
    assert.equal(live.config.home.headline, 'A brand new headline');
    assert.ok(live.version > before);
    assert.equal((await admin.post('/api/admin/site/publish', {})).status, 409, 'nothing to publish');

    const cfg2 = clone(); cfg2.home.headline = 'Second headline';
    await admin.put('/api/admin/site/draft', { config: cfg2 }); await admin.post('/api/admin/site/publish', {});
    const versions = (await admin.get('/api/admin/site/versions')).body.items;
    assert.ok(versions.length >= 2 && versions[0].version > versions[1].version);
    const old = versions.find((v) => v.status === 'archived');
    const rest = await admin.post('/api/admin/site/restore', { versionId: old.id });
    assert.equal(rest.status, 200);
    assert.equal(rest.body.hasDraft, true);
    assert.equal((await client(app).get('/api/public/site')).body.config.home.headline, 'Second headline', 'restore does not go live by itself');
    assert.equal((await admin.delete('/api/admin/site/draft')).status, 200);
  });

  test('every change is audited and published versions cannot be edited or deleted', async () => {
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    await admin.put('/api/admin/site/draft', { config: clone() }); await admin.post('/api/admin/site/publish', {});
    for (const a of ['site.draft_save', 'site.publish']) assert.ok((await db.query('SELECT 1 FROM audit_logs WHERE action=$1', [a])).rows[0], a);
    await assert.rejects(db.query(`UPDATE site_config_versions SET config='{}'::jsonb WHERE status='published'`), /immutable/);
    await assert.rejects(db.query(`DELETE FROM site_config_versions WHERE status='published'`), /cannot be deleted/);
  });

  test('validation: colours, links, HTML, lengths and unknown asset ids are rejected', async () => {
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    const put = async (mut) => { const c = clone(); mut(c); return admin.put('/api/admin/site/draft', { config: c }); };
    const cases = [
      (c) => { c.brand.colors.primary = 'navy'; },
      (c) => { c.brand.colors.accent = '#FFFF99'; }, // fails contrast with white text
      (c) => { c.home.primaryButton.to = 'javascript:alert(1)'; },
      (c) => { c.home.primaryButton.to = '//evil.example'; },
      (c) => { c.home.headline = '<img src=x onerror=alert(1)>'; },
      (c) => { c.brand.siteName = 'x'; },
      (c) => { c.contact.email = 'not-an-email'; },
      (c) => { c.social = [{ label: 'X', url: 'http://insecure.example' }]; },
      (c) => { c.home.services.items[0].icon = 'not-an-icon'; },
      (c) => { c.brand.faviconAssetId = '00000000-0000-4000-8000-000000000000'; },
    ];
    for (const [i, mut] of cases.entries()) assert.equal((await put(mut)).status, 422, `case ${i} should be rejected`);
  });

  test('image upload: identified from the bytes, size/kind limited, and assets only go public once published', async () => {
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    assert.equal((await upload(admin, 'hero', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(100)), 'hero.png')).status, 422, 'SVG renamed to .png');
    assert.equal((await upload(admin, 'hero', png(400, 300))).status, 422, 'hero too small');
    assert.equal((await upload(admin, 'favicon', png(5000, 5000))).status, 422, 'favicon too large');
    const ok = await upload(admin, 'hero', png(1920, 1080));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((await client(app).get(`/api/public/assets/${ok.body.id}`)).status, 404, 'unpublished asset is not public');

    const cfg = clone(); cfg.home.heroImageAssetId = ok.body.id;
    assert.equal((await admin.put('/api/admin/site/draft', { config: cfg })).status, 200);
    assert.equal((await admin.get(`/api/admin/site/assets/${ok.body.id}`)).status, 200, 'preview works for admins');
    await admin.post('/api/admin/site/publish', {});
    const img = await client(app).get(`/api/public/assets/${ok.body.id}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(img.headers['x-content-type-options'], 'nosniff');
    // a hero id cannot be used as a logo
    const bad = clone(); bad.brand.logoLightAssetId = ok.body.id;
    assert.equal((await admin.put('/api/admin/site/draft', { config: bad })).status, 422);
  });

  test('permissions: customers, anonymous users and other staff roles cannot edit the website', async () => {
    const cust = await makeCustomer(); const cc = client(app); await login(cc, cust.email);
    for (const c of [client(app), cc, await loginStaff(app, await makeStaff('support_agent')), await loginStaff(app, await makeStaff('compliance_admin')), await loginStaff(app, await makeStaff('finance_operator'))]) {
      assert.ok([401, 403].includes((await c.put('/api/admin/site/draft', { config: clone() })).status));
      assert.ok([401, 403].includes((await c.post('/api/admin/site/publish', {})).status));
      assert.ok([401, 403].includes((await c.get('/api/admin/site')).status));
    }
  });
});

describe('legal documents', () => {
  const doc = (over = {}) => ({ title: 'Terms of Service', body: '## 1. Scope\nThese are the updated terms of service for the platform. See the [Privacy Policy](/privacy).', effectiveDate: '2026-11-01', ...over });

  test('built-in text is public, versioned and flagged as not legally reviewed', async () => {
    const list = await client(app).get('/api/public/legal');
    assert.deepEqual(list.body.items.map((i) => i.slug).sort(), ['accessibility', 'cookies', 'privacy', 'security', 'terms']);
    const t = await client(app).get('/api/public/legal/terms');
    assert.equal(t.status, 200);
    assert.ok(t.body.version >= 1 && t.body.body.length > 200);
    assert.equal((await client(app).get('/api/public/legal/unknown')).status, 422);
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    const ed = await admin.get('/api/admin/legal/privacy');
    assert.equal(ed.body.published.needsReview, true);
  });

  test('draft -> publish needs MFA step-up, bumps the version, archives the old one and is audited', async () => {
    const sa = await makeStaff('super_admin'); const admin = await loginStaff(app, sa);
    const v0 = (await admin.get('/api/admin/legal/cookies')).body.published.version;
    const d = await admin.put('/api/admin/legal/cookies/draft', doc({ title: 'Cookie Policy' }));
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal((await client(app).get('/api/public/legal/cookies')).body.version, v0, 'draft is not public');
    assert.equal((await admin.post('/api/admin/legal/cookies/publish', { mfaCode: '000000' })).status, 403);
    const p = await admin.post('/api/admin/legal/cookies/publish', { mfaCode: await freshCode(sa) });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const live = (await client(app).get('/api/public/legal/cookies')).body;
    assert.equal(live.version, v0 + 1);
    assert.equal(live.effectiveDate, '2026-11-01');
    assert.equal(live.needsReview, false);
    assert.equal(p.body.versions.find((v) => v.version === v0).status, 'archived');
    assert.ok((await db.query(`SELECT 1 FROM audit_logs WHERE action='legal.publish' AND target_id='cookies'`)).rows[0]);
    // restore an old version into the draft; going live again needs another publish
    const old = p.body.versions.find((v) => v.version === v0);
    const r = await admin.post('/api/admin/legal/cookies/restore', { versionId: old.id, mfaCode: await freshCode(sa) });
    assert.equal(r.status, 200);
    assert.ok(r.body.draft.changeNote.includes(`version ${v0}`));
    assert.equal((await client(app).get('/api/public/legal/cookies')).body.version, v0 + 1);
  });

  test('unsafe markup is refused: raw HTML and non-http(s)/mailto links', async () => {
    const admin = await loginStaff(app, await makeStaff('super_admin'));
    const pad = ' padding padding padding padding padding padding padding';
    for (const body of [`<script>alert(1)</script>${pad}`, `Click [here](javascript:alert(1))${pad}`, `See [x](data:text/html;base64,AAAA)${pad}`]) {
      assert.equal((await admin.put('/api/admin/legal/security/draft', doc({ body }))).status, 422);
    }
    assert.equal((await admin.put('/api/admin/legal/security/draft', doc({ effectiveDate: '2026-13-45' }))).status, 422);
  });

  test('compliance admins can draft but not publish; support and customers cannot edit', async () => {
    const comp = await loginStaff(app, await makeStaff('compliance_admin'));
    assert.equal((await comp.put('/api/admin/legal/accessibility/draft', doc({ title: 'Accessibility Statement' }))).status, 200);
    assert.equal((await comp.post('/api/admin/legal/accessibility/publish', { mfaCode: '123456' })).status, 403);
    const sup = await loginStaff(app, await makeStaff('support_agent'));
    assert.equal((await sup.get('/api/admin/legal')).status, 403);
    const cust = await makeCustomer(); const cc = client(app); await login(cc, cust.email);
    assert.equal((await cc.put('/api/admin/legal/terms/draft', doc())).status, 403);
  });

  test('registration requires acceptance and records the exact versions accepted; later publishes never rewrite it', async () => {
    const c = client(app);
    const no = await c.post('/api/auth/register', registrationBody({ acceptedTerms: false }));
    assert.equal(no.status, 422);
    const body = registrationBody();
    assert.equal((await c.post('/api/auth/register', body)).status, 202);
    const u = (await db.query('SELECT id FROM users WHERE email=$1', [body.email.toLowerCase()])).rows[0];
    const rows = (await db.query('SELECT a.slug, v.version FROM legal_acceptances a JOIN legal_document_versions v ON v.id=a.version_id WHERE a.user_id=$1 ORDER BY a.slug', [u.id])).rows;
    assert.deepEqual(rows.map((r) => r.slug), ['privacy', 'terms']);

    const sa = await makeStaff('super_admin'); const admin = await loginStaff(app, sa);
    await admin.put('/api/admin/legal/terms/draft', doc());
    await admin.post('/api/admin/legal/terms/publish', { mfaCode: await freshCode(sa) });
    const after = (await db.query(`SELECT v.version FROM legal_acceptances a JOIN legal_document_versions v ON v.id=a.version_id WHERE a.user_id=$1 AND a.slug='terms'`, [u.id])).rows;
    assert.equal(after.length, 1);
    assert.equal(after[0].version, rows.find((r) => r.slug === 'terms').version, 'acceptance still points at the old version');
    await assert.rejects(db.query('UPDATE legal_acceptances SET accepted_at=now() WHERE user_id=$1', [u.id]));
    await assert.rejects(db.query('DELETE FROM legal_acceptances WHERE user_id=$1', [u.id]));
  });
});
