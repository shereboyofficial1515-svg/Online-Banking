import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from './config/index.js';
import { requestContext } from './middleware/context.js';
import { csrfProtect } from './middleware/csrf.js';
import { globalLimiter, authLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { asyncHandler } from './utils/asyncHandler.js';
import authRoutes from './routes/auth.js';
import * as customer from './routes/customer.js';
import * as staff from './routes/staff.js';
import * as verification from './services/verificationService.js';
import { getDb } from './db/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  }));
  app.use((req, res, next) => {
    // Passkeys are allowed for this origin only; powerful features we do not use are disabled.
    res.setHeader('Permissions-Policy', 'publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  app.use(cors({ origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token'] }));
  app.use(requestContext);

  // Signed identity-provider webhook: raw body is required for HMAC verification, so it is mounted before the JSON parser.
  app.post('/api/verification/webhook', authLimiter, express.raw({ type: '*/*', limit: '100kb' }), asyncHandler(async (req, res) => {
    res.json(await verification.handleWebhook(req.body, req.headers));
  }));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', globalLimiter, csrfProtect);

  app.get('/api/health', asyncHandler(async (req, res) => {
    await getDb().query('SELECT 1');
    res.json({ status: 'ok', ledgerMode: config.ledger.mode });
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', customer.users);
  app.use('/api/accounts', customer.accounts);
  app.use('/api/transactions', customer.transactions);
  app.use('/api/withdrawals', customer.withdrawals);
  app.use('/api/verification', customer.verification);
  app.use('/api/notifications', customer.notifications);
  app.use('/api/support', customer.support);
  app.use('/api/security', customer.security);
  app.use('/api/ledger', staff.ledger);
  app.use('/api/admin', staff.admin);
  app.use('/api/audit', staff.audit);
  app.use('/api', notFoundHandler);

  // Optionally serve the built SPA from the same origin (simplest, most secure cookie setup in production).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
