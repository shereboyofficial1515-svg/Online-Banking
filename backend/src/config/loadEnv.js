// Single place where a local environment file is read. It runs before config/index.js evaluates (ES module
// imports execute first), so every other module sees the final process.env.
//
// Why this exists: the old `node --env-file-if-exists=.env` flag resolves ".env" relative to the *current working
// directory*. The backend runs from backend/, but the project's .env lived at the repository root, so it was
// silently skipped ("Continuing without it") and the app fell back to development defaults. Here the search is
// anchored to this file's location instead, so it works from any directory.
//
// Rules:
//  * Real process environment always wins (Render/Vercel/CI variables are never overridden by a file).
//  * A file is optional. Production deployments configure variables in the host dashboard and need no file.
//  * Auto-discovery happens in development only. In staging/production a stray developer .env must never fill gaps
//    silently; set ENV_FILE explicitly if you really want a file there.
//  * Never read in tests, so an automated test run can never pick up real credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(backendRoot, '..');

/** Result is exported for a startup log line (paths only, never values). */
export const envSource = { file: null, searched: [], skipped: null };

const nodeEnv = process.env.NODE_ENV;
const explicit = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : null;

if (nodeEnv === 'test') {
  envSource.skipped = 'test environment';
} else if ((nodeEnv === 'production' || nodeEnv === 'staging') && !explicit) {
  envSource.skipped = `${nodeEnv}: variables come from the host environment (set ENV_FILE to load a file)`;
} else {
  const candidates = explicit ? [explicit] : [path.join(backendRoot, '.env'), path.join(repoRoot, '.env')];
  envSource.searched = candidates;
  const found = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (found) {
    process.loadEnvFile(found); // does not overwrite variables that are already set
    envSource.file = found;
  }
}
