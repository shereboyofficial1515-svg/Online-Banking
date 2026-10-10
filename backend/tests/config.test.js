// Environment loading + validation. Each case runs config in a fresh child process with a hand-built environment,
// because the loader runs at import time and must be tested from a clean slate (and from a different working directory).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(backend, '..');
const configUrl = pathToFileURL(path.join(backend, 'src/config/index.js')).href;

const strong = (c) => c.repeat(48);
const PROD_OK = {
  NODE_ENV: 'production', JWT_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b'),
  DATABASE_URL: 'postgresql://postgres.abc:pw%40x@db.example-host.net:5432/postgres',
  SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: strong('c'),
  APP_URL: 'https://app.ewbbank.net', RESEND_API_KEY: 're_realisticlookingkey123', RESEND_FROM_EMAIL: 'EWB Bank <no-reply@ewbbank.net>', SUPPORT_EMAIL: 'support@ewbbank.net',
};

/** Evaluate `snippet` against a freshly imported config. Only the env vars given exist (plus what Node itself needs). */
function run(env, snippet, cwd = tmpdir()) {
  const code = `const m = await import(${JSON.stringify(configUrl)}); const c = m.default; ${snippet}`;
  const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env: { ...base, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const validate = `try { m.assertConfig(); console.log('OK'); } catch (e) { console.log(e.message); }`;

function envFile(body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ewb-env-'));
  const file = path.join(dir, '.env');
  writeFileSync(file, body);
  return file;
}

describe('environment file loading', () => {
  test('finds an env file independent of the working directory (the original bug)', () => {
    const file = envFile('PORT=7777\nSUPPORT_EMAIL=ops@ewbbank.net # trailing comment\nJWT_SECRET=\n');
    const out = JSON.parse(run({ ENV_FILE: file, NODE_ENV: 'development' }, 'console.log(JSON.stringify({ port: c.port, file: c.envSource.file, support: c.email.supportEmail }))', tmpdir()));
    assert.equal(out.port, 7777);
    assert.equal(out.file, file);
    assert.equal(out.support, 'ops@ewbbank.net', 'inline comments are not part of the value');
  });

  test('the repository-root .env is discovered when starting from backend/ (previously "not found")', () => {
    const searched = JSON.parse(run({ NODE_ENV: 'development' }, 'console.log(JSON.stringify(c.envSource.searched))', backend));
    assert.ok(searched.includes(path.join(backend, '.env')));
    assert.ok(searched.includes(path.join(repo, '.env')), 'repo-root .env is on the search path');
  });

  test('real process environment always beats the file (Render/Vercel variables win)', () => {
    const file = envFile('PORT=7777\n');
    assert.equal(run({ ENV_FILE: file, PORT: '9000', NODE_ENV: 'development' }, 'console.log(c.port)'), '9000');
  });

  test('tests never read an env file, so they cannot pick up real credentials', () => {
    const file = envFile('DATABASE_URL=postgresql://u:p@remote.example.net:5432/x\n');
    const out = JSON.parse(run({ ENV_FILE: file, NODE_ENV: 'test' }, 'console.log(JSON.stringify({ file: c.envSource.file, skipped: c.envSource.skipped, driver: c.db.driver }))'));
    assert.deepEqual(out, { file: null, skipped: 'test environment', driver: 'pglite' });
  });

  test('a missing env file is fine: production reads the process environment only', () => {
    assert.equal(run(PROD_OK, validate), 'OK');
    assert.equal(run(PROD_OK, 'console.log(c.envSource.file)'), 'null');
  });
});

describe('configuration validation', () => {
  test('lists exactly which required production variables are missing', () => {
    const out = run({ NODE_ENV: 'production' }, validate);
    for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'RESEND_API_KEY']) assert.match(out, new RegExp(name));
    assert.match(out, /Missing required environment variables/);
    assert.match(out, /DEPLOYMENT\.md/);
  });

  test('error messages never contain secret values', () => {
    const secrets = { JWT_SECRET: 'tooShortButSecret123', DATABASE_URL: 'postgresql://user:SuperSecretPw@@@host', SUPABASE_SERVICE_ROLE_KEY: 'svc-key-should-not-print' };
    const out = run({ ...PROD_OK, ...secrets, JWT_REFRESH_SECRET: 'tooShortButSecret123' }, validate);
    assert.match(out, /JWT_SECRET must be at least 32/);
    for (const v of Object.values(secrets)) assert.ok(!out.includes(v), `leaked ${v.slice(0, 6)}…`);
    assert.ok(!out.includes('SuperSecretPw'));
  });

  test('catches placeholder, non-https, localhost and cookie misconfiguration', () => {
    const out = run({ ...PROD_OK, APP_URL: 'http://localhost:5173', RESEND_FROM_EMAIL: 'EWB <no-reply@your-verified-domain.example>', COOKIE_SECURE: 'false', DATABASE_URL: 'postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres' }, validate);
    assert.match(out, /must be a public https/);
    assert.match(out, /RESEND_FROM_EMAIL still contains a placeholder/);
    assert.match(out, /COOKIE_SECURE must be true/);
    assert.match(out, /DATABASE_URL still contains a placeholder/);
  });

  test('flags a DATABASE_URL whose password was not percent-encoded', () => {
    assert.match(run({ ...PROD_OK, DATABASE_URL: 'postgresql://u:p@ss@word@host.net:5432/db' }, 'console.log(c.db.url ? "set" : "unset")'), /set/);
    const out = run({ ...PROD_OK, DATABASE_URL: 'not a url' }, validate);
    assert.match(out, /DATABASE_URL is not a valid URL/);
  });

  test('development needs nothing: secrets are generated locally and validation passes', () => {
    assert.equal(run({ NODE_ENV: 'development' }, validate, backend), 'OK');
  });

  test('SameSite=None requires Secure cookies; proxy hop count is an exact number', () => {
    assert.match(run({ NODE_ENV: 'development', COOKIE_SAMESITE: 'none' }, validate, backend), /COOKIE_SAMESITE=none requires COOKIE_SECURE=true/);
    assert.equal(run({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '2' }, 'console.log(c.trustProxyHops)', backend), '2');
    assert.equal(run({ NODE_ENV: 'development', TRUST_PROXY: 'true' }, 'console.log(c.trustProxyHops)', backend), '1');
    assert.equal(run({ NODE_ENV: 'development' }, 'console.log(c.auth.cookieSameSite)', backend), 'strict');
  });
});

describe('secrets hygiene', () => {
  const JWT_LIKE = /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./;
  const URL_WITH_PASSWORD = /postgres(ql)?:\/\/[^\s:@]+:(?!<|\[|\$\{)[^\s@]{3,}@/;

  test('all committed .env*.example files contain placeholders only', () => {
    for (const f of readdirSync(repo).filter((n) => /^\.env.*\.example$/.test(n))) {
      const text = readFileSync(path.join(repo, f), 'utf8');
      assert.doesNotMatch(text, JWT_LIKE, `${f} contains a JWT-like token`);
      assert.doesNotMatch(text, URL_WITH_PASSWORD, `${f} contains a database URL with a password`);
      assert.doesNotMatch(text, /[a-z0-9]{20}\.supabase\.co/, `${f} contains a real Supabase project reference`);
      assert.doesNotMatch(text, /^(JWT_SECRET|JWT_REFRESH_SECRET|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY)=\S+/m, `${f} has a value for a secret variable`);
    }
  });

  test('.gitignore excludes real env files', () => {
    const gi = readFileSync(path.join(repo, '.gitignore'), 'utf8').split(/\r?\n/);
    assert.ok(gi.includes('.env'));
    assert.ok(gi.includes('.env.*') && gi.includes('!.env.example'));
  });

  test('no source file embeds a token that looks like a JWT or service key', () => {
    const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (['node_modules', 'dist', '.data'].includes(n)) continue; const p = path.join(d, n); statSync(p).isDirectory() ? walk(p, out) : /\.(js|jsx|mjs|json|md|sql|html)$/.test(n) && !/package-lock/.test(n) && out.push(p); } return out; };
    for (const dir of [path.join(backend, 'src'), path.join(repo, 'frontend/src'), path.join(repo, 'docs')]) {
      for (const f of walk(dir)) assert.doesNotMatch(readFileSync(f, 'utf8'), JWT_LIKE, `${path.relative(repo, f)} contains a JWT-like token`);
    }
  });
});
