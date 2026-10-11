import './env.js';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db/index.js';
import { migrate, status } from '../src/db/migrate.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const sql = (f) => readFileSync(path.join(dir, f), 'utf8');
const ALL = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
after(closeDb);

describe('migrations', () => {
  test('fresh database: applies everything once, then is a no-op', async () => {
    const db = await initDb();
    assert.deepEqual((await status(db)).pending, ALL);
    assert.deepEqual(await migrate(db), ALL);
    assert.deepEqual(await migrate(db), []);
    assert.deepEqual((await status(db)).pending, []);
  });

  test('schema applied by hand (no tracking table) is recognised, never re-run or dropped', async () => {
    await closeDb();
    const db = await initDb(); // brand-new empty database
    await db.exec(sql('001_schema.sql'));
    await db.exec(sql('002_rls.sql'));
    await db.query("INSERT INTO users (email, password_hash, first_name, last_name) VALUES ('keep@example.test','x','Keep','Me')");

    const before = await status(db);
    assert.equal(before.hasTracker, false);
    assert.deepEqual(before.baselineCandidates, ['001_schema.sql', '002_rls.sql']);
    assert.deepEqual(before.pending, ALL.slice(2));

    const applied = await migrate(db); // would throw "relation already exists" without baselining
    assert.deepEqual(applied, ALL.slice(2));
    assert.equal((await db.query('SELECT count(*)::int n FROM users')).rows[0].n, 1, 'existing data untouched');
    assert.deepEqual((await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name), ALL);
  });

  test('status() is read-only', async () => {
    await closeDb();
    const db = await initDb();
    await status(db);
    assert.equal((await db.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok")).rows[0].ok, false, 'status did not create the tracking table');
  });
});
