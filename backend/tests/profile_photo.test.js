import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, login, makeCustomer } from './helpers.js';
import { providers } from '../src/providers/index.js';

let app; let db;
before(async () => { ({ app, db } = await boot()); });
after(shutdown);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);
const send = async (c, buf, name = 'p.png', type = 'image/png') =>
  c.agent.post('/api/users/me/photo').set('X-CSRF-Token', await c.csrfToken()).attach('photo', buf, { filename: name, contentType: type });
const signedIn = async () => { const cust = await makeCustomer(); const c = client(app); await login(c, cust.email); return { cust, c }; };

describe('profile photo upload', () => {
  test('real images are stored, persist across sessions, and the profile reports it', async () => {
    const { cust, c } = await signedIn();
    assert.equal((await c.get('/api/users/me')).body.user.hasProfilePhoto, false);
    assert.equal((await send(c, PNG)).status, 200);
    const c2 = client(app); await login(c2, cust.email);
    assert.equal((await c2.get('/api/users/me')).body.user.hasProfilePhoto, true);
    const img = await c2.agent.get('/api/users/me/photo');
    assert.equal(img.status, 200);
    assert.deepEqual(Buffer.from(img.body), PNG);
    assert.match(img.headers['cache-control'], /private/);
  });

  test('the file contents decide, not the name or declared type', async () => {
    const { c } = await signedIn();
    assert.equal((await send(c, Buffer.from('MZ\x90\x00 executable'), 'photo.jpg', 'image/jpeg')).status, 400, 'executable renamed .jpg');
    assert.equal((await send(c, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'a.png', 'image/png')).status, 400, 'SVG');
    assert.equal((await send(c, Buffer.from('%PDF-1.7 fake'), 'a.png', 'image/png')).status, 400, 'PDF is not a photo');
    assert.equal((await send(c, Buffer.from('<html><script>alert(1)</script></html>'), 'a.jpg', 'image/jpeg')).status, 400, 'HTML');
    assert.equal((await send(c, JPG, 'real.exe', 'text/html')).status, 200, 'a genuine JPEG is accepted whatever it is called');
  });

  test('files over the size limit are refused with a clear message and nothing is stored', async () => {
    const { cust, c } = await signedIn();
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const r = await send(c, big);
    assert.ok([400, 413, 422].includes(r.status), String(r.status));
    assert.match(r.body.error.message, /large|size|limit|MB/i);
    assert.equal((await db.query('SELECT profile_photo_path FROM users WHERE id=$1', [cust.user.id])).rows[0].profile_photo_path, null);
  });

  test('signed-out requests are rejected and a customer can only change their own photo', async () => {
    const a = await signedIn(); const b = await signedIn();
    const anon = client(app);
    const tok = await anon.csrfToken();
    const r = await anon.agent.post('/api/users/me/photo').set('X-CSRF-Token', tok);
    assert.equal(r.status, 401);
    await send(a.c, PNG);
    assert.equal((await b.c.agent.get('/api/users/me/photo')).status, 404, 'B has no photo; A\'s upload did not touch B');
    // there is no endpoint that accepts another user's id
    const atok = await a.c.csrfToken();
    assert.equal((await a.c.agent.post(`/api/users/${b.cust.user.id}/photo`).set('X-CSRF-Token', atok)).status, 404);
    assert.equal((await db.query('SELECT profile_photo_path FROM users WHERE id=$1', [b.cust.user.id])).rows[0].profile_photo_path, null);
  });

  test('the confirmed response carries the new profile; the photo version changes with each photo, so caches cannot mask it', async () => {
    const { cust, c } = await signedIn();
    const first = await send(c, PNG);
    assert.equal(first.body.user.hasProfilePhoto, true);
    assert.ok(first.body.user.profilePhotoVersion);
    const second = await send(c, JPG, 'b.jpg', 'image/jpeg');
    assert.notEqual(second.body.user.profilePhotoVersion, first.body.user.profilePhotoVersion);
    assert.equal(JSON.stringify(second.body).includes(cust.user.id + '/'), false, 'storage path is never exposed');
    const me = (await c.get('/api/users/me')).body.user;
    assert.equal(me.profilePhotoVersion, second.body.user.profilePhotoVersion, 'a reload sees the same version');
    assert.deepEqual(Buffer.from((await c.agent.get('/api/users/me/photo')).body), JPG);
    // the replaced object was removed from storage
    const files = [...providers().storage.files.keys()].filter((k) => k.includes(cust.user.id));
    assert.equal(files.length, 1);
  });

  test('if saving the reference fails, the old photo is kept and the new object is not left behind', async () => {
    const { cust, c } = await signedIn();
    await send(c, PNG);
    const before = (await db.query('SELECT profile_photo_path p FROM users WHERE id=$1', [cust.user.id])).rows[0].p;
    await db.query("CREATE OR REPLACE FUNCTION test_block_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'blocked for test'; END $$");
    await db.query('CREATE TRIGGER test_block_photo_trg BEFORE UPDATE OF profile_photo_path ON users FOR EACH ROW EXECUTE FUNCTION test_block_photo()');
    try {
      const r = await send(c, JPG, 'b.jpg', 'image/jpeg');
      assert.ok(r.status >= 400, String(r.status));
      assert.notEqual(r.body.ok, true, 'no success is reported');
    } finally {
      await db.query('DROP TRIGGER test_block_photo_trg ON users');
    }
    assert.equal((await db.query('SELECT profile_photo_path p FROM users WHERE id=$1', [cust.user.id])).rows[0].p, before, 'reference unchanged');
    assert.deepEqual(Buffer.from((await c.agent.get('/api/users/me/photo')).body), PNG, 'old photo still served');
    assert.equal([...providers().storage.files.keys()].filter((k) => k.includes(cust.user.id)).length, 1, 'no orphaned file');
  });

  test('a storage failure leaves the existing photo untouched and reports an error', async () => {
    const { cust, c } = await signedIn();
    await send(c, PNG);
    const storage = providers().storage; const put = storage.put;
    storage.put = async () => { throw new Error('storage down'); };
    try {
      const r = await send(c, JPG, 'b.jpg', 'image/jpeg');
      assert.ok(r.status >= 500, String(r.status));
    } finally { storage.put = put; }
    assert.deepEqual(Buffer.from((await c.agent.get('/api/users/me/photo')).body), PNG);
    assert.equal((await db.query('SELECT profile_photo_path p FROM users WHERE id=$1', [cust.user.id])).rows[0].p !== null, true);
  });
});
