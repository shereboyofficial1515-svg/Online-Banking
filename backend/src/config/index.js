// Central configuration. Environment-specific defaults live here; secrets only
// ever come from process.env and are never sent to the frontend.

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
  env,
  isProd,
  isTest: env === 'test',
  port: int(process.env.PORT, 4000),
  appUrl,
  corsOrigins: (process.env.CORS_ORIGINS || appUrl).split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: bool(process.env.TRUST_PROXY, isProd),
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
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || '',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
    accessTtlSec: int(process.env.ACCESS_TOKEN_TTL_SEC, 15 * 60),
    adminAccessTtlSec: int(process.env.ADMIN_ACCESS_TOKEN_TTL_SEC, 10 * 60),
    customerSessionDays: int(process.env.CUSTOMER_SESSION_DAYS, 14),
    adminIdleMinutes: int(process.env.ADMIN_IDLE_MINUTES, 30),
    adminSessionHours: int(process.env.ADMIN_SESSION_HOURS, 8),
    maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 5),
    lockMinutes: int(process.env.LOCK_MINUTES, 15),
    cookieSecure: bool(process.env.COOKIE_SECURE, perEnv.cookieSecure),
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

export function assertConfig() {
  const problems = [];
  const weak = (s) => !s || s.length < 32;
  if (weak(config.auth.jwtSecret)) problems.push('JWT_SECRET must be set (32+ chars)');
  if (weak(config.auth.jwtRefreshSecret)) problems.push('JWT_REFRESH_SECRET must be set (32+ chars)');
  if (config.auth.jwtSecret === config.auth.jwtRefreshSecret) problems.push('JWT secrets must differ');
  if (config.isProd) {
    if (config.db.driver !== 'pg') problems.push('Production requires DB_DRIVER=pg with a Supabase DATABASE_URL');
    if (!config.auth.cookieSecure) problems.push('COOKIE_SECURE must be true in production');
    if (!config.appUrl.startsWith('https://')) problems.push('APP_URL must be https in production');
    if (config.email.provider !== 'resend') problems.push('RESEND_API_KEY is required in production');
  }
  if (!['simulated', 'live'].includes(config.ledger.mode)) problems.push('LEDGER_MODE must be simulated or live');
  if (problems.length) throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
}

export default config;
