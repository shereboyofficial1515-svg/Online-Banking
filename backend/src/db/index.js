// Database adapter. Exposes a tiny, driver-neutral surface:
//   db.query(sql, params)  -> { rows, rowCount }
//   db.tx(async (t) => ...)  -> runs fn in a transaction; t.query has the same shape
// Production uses node-postgres against Supabase PostgreSQL. PGlite (real Postgres compiled to
// WASM) backs local development and the automated tests, so SQL, triggers and constraints are
// exercised for real rather than mocked.
import config from '../config/index.js';

let instance = null;

async function createPg() {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT minor units fit safely in a double
  pg.types.setTypeParser(1082, (v) => v); // DATE stays 'YYYY-MM-DD' (no timezone shifting)
  const host = new URL(config.db.url).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  // Safety net: automated tests must never touch a remote database, even if a real DATABASE_URL leaks into the environment.
  if (config.isTest && !local) throw new Error('Refusing to run tests against a non-local database.');
  const pool = new pg.Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    // Supabase requires TLS: enabled for every non-local host (dev, staging, production) unless DB_SSL=false.
    // With DB_SSL_CA (PEM text of the Supabase root CA, newlines may be written as \n) the server certificate is fully
    // verified. Without it the connection is encrypted but the certificate is not verified (Supabase poolers use a private CA).
    ssl: local || process.env.DB_SSL === 'false'
      ? undefined
      : process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });
  const wrap = (c) => ({
    query: async (sql, params = []) => {
      const r = await c.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
  });
  return {
    driver: 'pg',
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
  };
}

async function createPglite() {
  const { PGlite, types } = await import('@electric-sql/pglite');
  if (config.db.pgliteDir !== 'memory://') {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(config.db.pgliteDir, { recursive: true });
  }
  const lite = new PGlite(config.db.pgliteDir, { parsers: { [types.INT8]: (v) => Number(v), [types.DATE]: (v) => v } });
  await lite.waitReady;
  await lite.exec("SET TIME ZONE 'UTC'"); // do not inherit the host timezone
  const wrap = (c) => ({
    query: async (sql, params = []) => {
      const r = await c.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    driver: 'pglite',
    ...wrap(lite),
    tx: (fn) => lite.transaction(async (t) => fn(wrap(t))),
    exec: (sql) => lite.exec(sql),
    close: () => lite.close(),
  };
}

export async function initDb() {
  if (instance) return instance;
  instance = config.db.driver === 'pg' ? await createPg() : await createPglite();
  return instance;
}

export function getDb() {
  if (!instance) throw new Error('Database not initialised');
  return instance;
}

export async function closeDb() {
  if (instance) await instance.close();
  instance = null;
}
