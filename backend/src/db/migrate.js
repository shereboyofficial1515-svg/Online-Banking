import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initDb, closeDb } from './index.js';
import { assertConfig, ConfigError } from '../config/index.js';
import { logger } from '../utils/logger.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const files = () => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

/**
 * Detects a database whose schema was applied by hand (e.g. pasted into the Supabase SQL editor) so the
 * tracking table is missing. Only when the matching objects are really there do we *record* a migration as
 * applied; nothing is re-run and nothing is dropped.
 */
async function detectBaseline(db) {
  const q = async (sql) => (await db.query(sql)).rows[0];
  const base = [];
  const hasUsers = (await q("SELECT to_regclass('public.users') IS NOT NULL AS ok")).ok;
  const hasTriggers = (await q("SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('ledger_entries_immutable','audit_logs_append_only','transactions_guard_trg','ledger_entries_guard')")).n === 4;
  if (hasUsers && hasTriggers) base.push('001_schema.sql');
  const rls = (await q("SELECT bool_or(rowsecurity) AS ok FROM pg_tables WHERE schemaname='public' AND tablename='users'")).ok;
  if (base.length && rls) base.push('002_rls.sql');
  return base;
}

export async function status(db) {
  const hasTracker = (await db.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok")).rows[0].ok;
  const applied = hasTracker ? (await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name) : [];
  const baseline = !applied.length ? await detectBaseline(db) : [];
  return { hasTracker, applied, baselineCandidates: baseline, pending: files().filter((f) => !applied.includes(f) && !baseline.includes(f)) };
}

export async function migrate(db, { baseline = true } = {}) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  if (!done.size && baseline) {
    for (const f of await detectBaseline(db)) {
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
      done.add(f);
      logger.info('migration recorded as already applied (schema found in database)', { file: f });
    }
  }
  const applied = [];
  for (const f of files()) {
    if (done.has(f)) continue;
    await db.exec(`BEGIN;\n${readFileSync(path.join(dir, f), 'utf8')}\nINSERT INTO schema_migrations (name) VALUES ('${f}');\nCOMMIT;`);
    applied.push(f);
    logger.info('migration applied', { file: f });
  }
  return applied;
}

// CLI:  npm run migrate            apply pending migrations (additive; never drops or truncates)
//       npm run migrate:status     read-only report, changes nothing
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { assertConfig(); } catch (e) { if (e instanceof ConfigError) { console.error(`\n${e.message}\n`); process.exit(1); } throw e; }
  const db = await initDb();
  try {
    if (process.argv.includes('--status')) {
      const s = await status(db);
      console.log(`Database driver: ${db.driver}`);
      console.log(`Tracking table: ${s.hasTracker ? 'present' : 'absent'}`);
      console.log(`Applied: ${s.applied.join(', ') || 'none'}`);
      if (s.baselineCandidates.length) console.log(`Schema already present (will be recorded, not re-run): ${s.baselineCandidates.join(', ')}`);
      console.log(`Pending (would be applied): ${s.pending.join(', ') || 'none'}`);
    } else {
      const applied = await migrate(db);
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
    }
  } finally { await closeDb(); }
}
