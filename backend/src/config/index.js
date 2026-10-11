// Central configuration. Environment-specific defaults live here; secrets only
// ever come from process.env and are never sent to the frontend.

import { envSource } from './loadEnv.js'; // first import: populates process.env from a local file (if any) before anything below reads it
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env.NODE_ENV || 'development';
if (!['development', 'staging', 'production', 'test'].includes(env)) {
  throw new Error(`Unsupported NODE_ENV "${env}"`);
}
const isProd = env === 'production' || env === 'staging';

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

const perEnv = {
  development: { cookieSecure: false, logLevel: 'debug' },
  test: { cookieSecure: false, logLevel: 'silent' },
  staging: { cookieSecure: true, logLevel: 'info' },
  production: { cookieSecure: true, logLevel: 'info' },
}[env];

const config = {
  envSource,
  env,
  isProd,
  isTest: env === 'test',
  port: int(process.env.PORT, 4000),
  appUrl,
  corsOrigins: (process.env.CORS_ORIGINS || appUrl).split(',').map((s) => s.trim()).filter(Boolean),
  // Number of reverse proxies in front of the API. Render alone = 1; Vercel rewrite -> Render = 2. Needed so rate limits and
  // audit logs see the real client IP. TRUST_PROXY=true is kept as an alias for 1.
  trustProxyHops: process.env.TRUST_PROXY_HOPS ? int(process.env.TRUST_PROXY_HOPS, 0) : bool(process.env.TRUST_PROXY, isProd) ? 1 : 0,
  logLevel: process.env.LOG_LEVEL || perEnv.logLevel,

  db: {
    // 'pg' talks to Supabase PostgreSQL (DATABASE_URL = Supabase connection string).
    // 'pglite' is an embedded real Postgres used for local development and tests only.
    driver: process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'pg' : 'pglite'),
    url: process.env.DATABASE_URL || '',
    pgliteDir: process.env.PGLITE_DIR || (env === 'test' ? 'memory://' : './.data/pglite'),
    poolMax: int(process.env.DB_POOL_MAX, 10),
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '', // reserved; the API never needs it
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '', // server-side only
    bucketProfile: process.env.SUPABASE_BUCKET_PROFILE || 'profile-photos',
    bucketKyc: process.env.SUPABASE_BUCKET_KYC || 'kyc-documents',
    bucketSupport: process.env.SUPABASE_BUCKET_SUPPORT || 'support-attachments',
    bucketSite: process.env.SUPABASE_BUCKET_SITE || 'site-assets',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || '',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
    accessTtlSec: int(process.env.ACCESS_TOKEN_TTL_SEC, 15 * 60),
    adminAccessTtlSec: int(process.env.ADMIN_ACCESS_TOKEN_TTL_SEC, 10 * 60),
    customerSessionDays: int(process.env.CUSTOMER_SESSION_DAYS, 14),
    adminIdleMinutes: int(process.env.ADMIN_IDLE_MINUTES, 30),
    adminSessionHours: int(process.env.ADMIN_SESSION_HOURS, 8),
    // Time away from the site after which a session is locked on the server and needs the password (or a passkey) again.
    awayLockSeconds: Math.max(5, int(process.env.AWAY_LOCK_SECONDS, 60)),
    maxUnlockFailures: int(process.env.MAX_UNLOCK_FAILURES, 5),
    maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 5),
    lockMinutes: int(process.env.LOCK_MINUTES, 15),
    cookieSecure: bool(process.env.COOKIE_SECURE, perEnv.cookieSecure),
    // 'strict' when the browser reaches the API through the frontend's own domain (Vercel rewrite / dev proxy / same origin).
    // 'none' only for a direct cross-site API (requires Secure cookies; third-party-cookie blocking can break it).
    cookieSameSite: ['strict', 'lax', 'none'].includes(process.env.COOKIE_SAMESITE) ? process.env.COOKIE_SAMESITE : 'strict',
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    trustedDeviceDays: int(process.env.TRUSTED_DEVICE_DAYS, 30),
    emailTokenHours: 24,
    resetTokenMinutes: 30,
    totpIssuer: 'EWB Bank',
  },

  webauthn: {
    rpName: 'EWB Bank',
    rpId: process.env.WEBAUTHN_RP_ID || new URL(appUrl).hostname,
    origins: (process.env.WEBAUTHN_ORIGINS || appUrl).split(',').map((s) => s.trim()),
  },

  email: {
    provider: process.env.RESEND_API_KEY ? 'resend' : 'console',
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM_EMAIL || 'EWB Bank <no-reply@example.invalid>',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@example.invalid',
  },

  identity: {
    provider: process.env.IDENTITY_PROVIDER || 'manual', // manual | webhook
    webhookSecret: process.env.IDENTITY_WEBHOOK_SECRET || '',
    sessionTtlHours: 72,
  },

  ledger: {
    // 'simulated' = internal software ledger; no real funds move anywhere.
    // 'live' is refused unless regulated providers are wired in (providers/index.js).
    mode: process.env.LEDGER_MODE || 'simulated',
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'USD',
    currencies: (process.env.SUPPORTED_CURRENCIES || 'USD,EUR,GBP').split(','),
    largeAdjustmentMinor: int(process.env.LARGE_ADJUSTMENT_MINOR, 1_000_000_00),
    maxAdjustmentMinor: int(process.env.MAX_ADJUSTMENT_MINOR, 100_000_000_00),
    maxTransferMinor: int(process.env.MAX_TRANSFER_MINOR, 50_000_00),
    withdrawalAttemptAlertThreshold: 3,
  },

  upload: {
    maxBytes: int(process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
    localDir: process.env.LOCAL_UPLOAD_DIR || './.data/uploads',
  },
  rateLimit: { enabled: bool(process.env.RATE_LIMIT_ENABLED, env !== 'test') },
  seedEnabled: bool(process.env.ALLOW_SEED, !isProd),
};

// Zero-config local development: generate stable random secrets once and keep them in a git-ignored file.
// Never applies to staging/production, where missing secrets are a startup error (see assertConfig).
if (env === 'development' && (!config.auth.jwtSecret || !config.auth.jwtRefreshSecret)) {
  const file = path.resolve('.data/dev-secrets.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  if (!s.jwtSecret || !s.jwtRefreshSecret) {
    s = { jwtSecret: crypto.randomBytes(48).toString('base64url'), jwtRefreshSecret: crypto.randomBytes(48).toString('base64url') };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s));
  }
  config.auth.jwtSecret ||= s.jwtSecret;
  config.auth.jwtRefreshSecret ||= s.jwtRefreshSecret;
}

if (config.isTest) {
  config.auth.jwtSecret ||= 'test-only-jwt-secret-not-for-production-0123456789';
  config.auth.jwtRefreshSecret ||= 'test-only-refresh-secret-not-for-production-9876543210';
  config.identity.webhookSecret ||= 'test-webhook-secret';
}

const PLACEHOLDER = /your-|example\.invalid|example\.(com|org|test)\b|<(password|your[^>]*)>|\[YOUR/i;
const isLocalHost = (h) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h) || h.endsWith('.localhost');

/** Thrown for configuration problems. The message names variables only - never values - so it is safe to print. */
export class ConfigError extends Error {}

export function assertConfig() {
  const missing = [];
  const invalid = [];
  const need = (name, ok, hint) => { if (!ok) missing.push(hint ? `${name} (${hint})` : name); };
  const strong = (v) => !!v && v.length >= 32;

  // Always: secrets, when present, must be strong. (Development auto-generates them; staging/production never do.)
  if (config.auth.jwtSecret && config.auth.jwtSecret === config.auth.jwtRefreshSecret) invalid.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  if (config.auth.jwtSecret && !strong(config.auth.jwtSecret)) invalid.push('JWT_SECRET must be at least 32 characters');
  if (config.auth.jwtRefreshSecret && !strong(config.auth.jwtRefreshSecret)) invalid.push('JWT_REFRESH_SECRET must be at least 32 characters');

  if (config.db.url) {
    try {
      const u = new URL(config.db.url);
      if (!/^postgres(ql)?:$/.test(u.protocol)) invalid.push('DATABASE_URL must start with postgresql://');
      if (PLACEHOLDER.test(config.db.url)) invalid.push('DATABASE_URL still contains a placeholder (e.g. [YOUR-PASSWORD])');
    } catch { invalid.push('DATABASE_URL is not a valid URL (special characters in the password must be percent-encoded, e.g. @ as %40)'); }
  }
  if (!!config.supabase.url !== !!config.supabase.serviceRoleKey) invalid.push('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together');
  if (config.supabase.url && !/^https:\/\/.+/.test(config.supabase.url)) invalid.push('SUPABASE_URL must be an https:// URL');
  if (config.auth.cookieSameSite === 'none' && !config.auth.cookieSecure) invalid.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  if (!['simulated', 'live'].includes(config.ledger.mode)) invalid.push('LEDGER_MODE must be "simulated" or "live"');

  if (config.isProd) {
    need('JWT_SECRET', strong(config.auth.jwtSecret), 'min 32 chars; generate with: openssl rand -base64 48');
    need('JWT_REFRESH_SECRET', strong(config.auth.jwtRefreshSecret), 'min 32 chars, different from JWT_SECRET');
    need('DATABASE_URL', !!config.db.url, 'Supabase connection string');
    need('SUPABASE_URL', !!config.supabase.url, 'needed for private file storage; local disk is not persistent on Render');
    need('SUPABASE_SERVICE_ROLE_KEY', !!config.supabase.serviceRoleKey);
    need('APP_URL', !!process.env.APP_URL, 'public https origin of the frontend');
    need('RESEND_API_KEY', !!config.email.resendApiKey, 'transactional email');
    if (config.db.url && config.db.driver !== 'pg') invalid.push('DB_DRIVER must be "pg" in staging/production');
    if (!config.auth.cookieSecure) invalid.push('COOKIE_SECURE must be true in staging/production');
    for (const o of new Set([config.appUrl, ...config.corsOrigins])) {
      try {
        const u = new URL(o);
        if (u.protocol !== 'https:' || isLocalHost(u.hostname)) invalid.push(`Origin "${o}" must be a public https:// origin in staging/production (check APP_URL / CORS_ORIGINS)`);
      } catch { invalid.push(`Origin "${o}" is not a valid URL (check APP_URL / CORS_ORIGINS)`); }
    }
    if (PLACEHOLDER.test(config.email.from)) invalid.push('RESEND_FROM_EMAIL still contains a placeholder; use an address on your verified Resend domain');
    if (PLACEHOLDER.test(config.email.supportEmail)) invalid.push('SUPPORT_EMAIL still contains a placeholder');
    if (config.seedEnabled && env === 'production') invalid.push('ALLOW_SEED must not be true in production');
  }

  if (missing.length || invalid.length) {
    const lines = [];
    if (missing.length) lines.push(`Missing required environment variables:\n   - ${missing.join('\n   - ')}`);
    if (invalid.length) lines.push(`Invalid configuration:\n   - ${invalid.join('\n   - ')}`);
    const where = envSource.file
      ? `Variables were loaded from ${envSource.file}.`
      : `No .env file was used (${envSource.skipped || 'none found'}); only the process environment was read.${envSource.searched.length ? `\n   Searched: ${envSource.searched.join(', ')}` : ''}`;
    throw new ConfigError(`${lines.join('\n')}\n${where}\nSee .env.example and DEPLOYMENT.md.`);
  }
}

export default config;
