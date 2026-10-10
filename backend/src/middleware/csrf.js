// CSRF defence for cookie-based sessions, layered:
//  1. SameSite=Strict on the session cookies
//  2. Origin header must match an allowed origin when present
//  3. Double-submit token: the X-CSRF-Token header must equal the (JS-readable) ewb_csrf cookie
// The signed webhook endpoint is exempt because it carries no cookies and authenticates by HMAC signature.
import config from '../config/index.js';
import { randomToken, safeEqual } from '../utils/crypto.js';
import { forbidden } from '../utils/errors.js';

export const CSRF_COOKIE = 'ewb_csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfCookieOptions() {
  return { httpOnly: false, sameSite: config.auth.cookieSameSite, secure: config.auth.cookieSecure, path: '/', domain: config.auth.cookieDomain, maxAge: 7 * 86_400_000 };
}

export function issueCsrfToken(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || token.length < 32) {
    token = randomToken(32);
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  }
  return token;
}

export function csrfProtect(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.originalUrl.split('?')[0] === '/api/verification/webhook') return next();
  const origin = req.get('origin');
  if (origin && !config.corsOrigins.includes(origin)) return next(forbidden('Cross-origin request blocked.', 'CSRF_ORIGIN'));
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) return next(forbidden('Security token missing or invalid. Please refresh the page and try again.', 'CSRF_INVALID'));
  next();
}
