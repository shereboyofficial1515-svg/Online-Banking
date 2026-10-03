// Runs the integration suite through the production `pg` driver (node-postgres) over the real PostgreSQL wire
// protocol, instead of the embedded PGlite adapter. A PGlite instance is exposed on a local TCP port, so the
// code path (Pool, BEGIN/COMMIT, type parsers, connection handling) is exactly what runs against Supabase.
// DB_POOL_MAX=1 on purpose: any code that opens a second connection inside a transaction would deadlock.
//
//   npm run test:pg
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = 55432;
const db = new PGlite();
await db.waitReady;
await db.exec("SET TIME ZONE 'UTC'");
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 4 });
await server.start();

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/ledger.test.js', 'tests/withdrawals.test.js', 'tests/auth.test.js'];
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', DB_DRIVER: 'pg', DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, DB_POOL_MAX: '1' },
});
child.on('exit', async (code) => { await server.stop(); await db.close(); process.exit(code ?? 1); });
