import config, { assertConfig, ConfigError } from './config/index.js';
import { initDb, closeDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { initProviders } from './providers/index.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

try {
  assertConfig();
} catch (e) {
  if (e instanceof ConfigError) { console.error(`\nEWB Bank API cannot start.\n${e.message}\n`); process.exit(1); }
  throw e;
}
const db = await initDb();
if (config.db.driver === 'pglite') await migrate(db); // embedded dev database self-migrates; production runs `npm run migrate` explicitly
initProviders();

const app = createApp();
const server = app.listen(config.port, '0.0.0.0', () => { // all interfaces: required by Render's router
  logger.info(config.envSource.file ? 'environment file loaded' : 'no environment file used; variables come from the process environment', { file: config.envSource.file });
  logger.info('EWB Bank API listening', { port: config.port, env: config.env, ledgerMode: config.ledger.mode, db: db.driver, email: config.email.provider });
});

const shutdown = async (signal) => {
  logger.info('shutting down', { signal });
  server.close(async () => { await closeDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => logger.error('unhandled rejection', { error: e }));
