import config from '../config/index.js';
import * as auth from '../services/authService.js';
import * as sessions from '../services/sessionService.js';
import * as passkeys from '../services/passkeyService.js';
import * as users from '../repositories/users.js';
import { permissionsFor } from '../config/permissions.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE } from '../middleware/authenticate.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { randomToken } from '../utils/crypto.js';
import { unauthorized } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const cookieBase = { httpOnly: true, sameSite: config.auth.cookieSameSite, secure: config.auth.cookieSecure, domain: config.auth.cookieDomain };

function setSessionCookies(res, { accessToken, refreshToken }, role) {
  const staff = role !== 'customer';
  const accessTtl = (staff ? config.auth.adminAccessTtlSec : config.auth.accessTtlSec) * 1000;
  res.cookie(ACCESS_COOKIE, accessToken, { ...cookieBase, path: '/api', maxAge: accessTtl });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieBase, path: '/api/auth', maxAge: (staff ? config.auth.adminIdleMinutes * 60 : config.auth.customerSessionDays * 86_400) * 1000 });
}
export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase, path: '/api/auth' });
}
/** Opaque per-browser id used for new-device detection and trusted devices. */
function deviceCookie(req, res) {
  let v = req.cookies?.[DEVICE_COOKIE];
  if (!v || v.length < 20) {
    v = randomToken(32);
    res.cookie(DEVICE_COOKIE, v, { ...cookieBase, path: '/', maxAge: 365 * 86_400_000 });
  }
  return v;
}

export const sessionPayload = (user, session) => ({
  user: users.toPublic(user),
  permissions: permissionsFor(user.role),
  mfaEnrollmentRequired: !!session?.limited,
});

function loginResponse(req, res, result) {
  if (result.status === 'mfa_required') return res.json({ mfaRequired: true, mfaToken: result.mfaToken });
  setSessionCookies(res, result, result.user.role);
  issueCsrfToken(req, res);
  return res.json({ mfaRequired: false, ...sessionPayload(result.user, result.session), newDevice: result.isNewDevice });
}

export const csrf = (req, res) => res.json({ csrfToken: issueCsrfToken(req, res) });

export const publicConfig = (req, res) => res.json({
  ledgerMode: config.ledger.mode,
  currencies: config.ledger.currencies,
  defaultCurrency: config.ledger.defaultCurrency,
  identityProvider: config.identity.provider,
  supportEmail: config.email.supportEmail.endsWith('.invalid') ? null : config.email.supportEmail,
  maxUploadBytes: config.upload.maxBytes,
});

export const register = asyncHandler(async (req, res) => {
  await auth.register(req.ctx, req.body);
  // Identical response whether or not the email already existed (prevents account enumeration).
  res.status(202).json({ message: 'Thank you. Please check your email to verify your address and complete your registration.' });
});
export const verifyEmail = asyncHandler(async (req, res) => { await auth.verifyEmail(req.ctx, req.body); res.json({ ok: true }); });
export const resendVerification = asyncHandler(async (req, res) => {
  await auth.resendVerification(req.body.email);
  res.status(202).json({ message: 'If that address needs verification, a new code is on its way.' });
});

export const login = asyncHandler(async (req, res) => {
  const result = await auth.login(req.ctx, req.body, deviceCookie(req, res));
  loginResponse(req, res, result);
});
export const loginMfa = asyncHandler(async (req, res) => {
  const result = await auth.loginMfa(req.ctx, req.body, deviceCookie(req, res));
  loginResponse(req, res, result);
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  try {
    const out = await sessions.refresh(token, req.ctx);
    setSessionCookies(res, out, out.role);
    res.json({ ok: true });
  } catch (e) {
    clearSessionCookies(res);
    throw e;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await auth.logout(req.auth.session.id);
  clearSessionCookies(res);
  res.json({ ok: true });
});

/**
 * Bootstrap endpoint for the SPA: always 200. Tells the client whether it is signed in, or whether a refresh cookie
 * exists so it can try one silent refresh (the cookie is HttpOnly, so JS cannot check this itself).
 */
export const session = asyncHandler(async (req, res) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (token) {
    try {
      const { session: s, user } = await sessions.authenticate(token);
      return res.json({ authenticated: true, ...sessionPayload(user, s) });
    } catch { /* fall through: expired or revoked */ }
  }
  res.json({ authenticated: false, user: null, permissions: [], canRefresh: !!req.cookies?.[REFRESH_COOKIE] });
});

export const me = (req, res) => res.json(sessionPayload(req.auth.user, req.auth.session));

export const forgotPassword = asyncHandler(async (req, res) => {
  await auth.forgotPassword(req.body.email, req.ctx);
  res.status(202).json({ message: 'If an account exists for that email, a reset link has been sent.' });
});
export const resetPassword = asyncHandler(async (req, res) => { await auth.resetPassword(req.ctx, req.body); res.json({ ok: true }); });

export const passkeyOptions = asyncHandler(async (req, res) => res.json(await passkeys.authenticationOptions()));
export const passkeyVerify = asyncHandler(async (req, res) => {
  const result = await passkeys.authenticate(req.ctx, req.body, deviceCookie(req, res));
  loginResponse(req, res, result);
});
