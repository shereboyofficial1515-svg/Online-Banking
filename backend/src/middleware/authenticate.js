import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import * as sessions from '../services/sessionService.js';
import { can, STAFF_ROLES } from '../config/permissions.js';

export const ACCESS_COOKIE = 'ewb_at';
export const REFRESH_COOKIE = 'ewb_rt';
export const DEVICE_COOKIE = 'ewb_did';

/**
 * Authentication: resolves the access cookie to a live session and the user's CURRENT role/status from the
 * database. Nothing the client sends (ids, roles, balances) is ever used as an authority.
 * `allowLimited` lets staff who have not enrolled MFA reach only the enrolment endpoints.
 */
export const requireAuth = ({ allowLimited = false, allowLocked = false } = {}) => asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) throw unauthorized();
  const { session, user } = await sessions.authenticate(token);
  if (session.limited && !allowLimited) throw forbidden('Multi-factor authentication must be set up before you can continue.', 'MFA_ENROLLMENT_REQUIRED');
  if (session.locked && !allowLocked) throw forbidden('Your session is locked. Please confirm it is you to continue.', 'SESSION_LOCKED');
  req.auth = { user, session };
  req.ctx.actor = { id: user.id, role: user.role };
  req.ctx.sessionId = session.id;
  req.ctx.deviceId = session.device_id;
  next();
});

export const requireCustomer = (req, res, next) =>
  req.auth?.user.role === 'customer' ? next() : next(forbidden('This area is for customers.'));

export const requireStaff = (req, res, next) => {
  const u = req.auth?.user;
  if (!u || !STAFF_ROLES.includes(u.role)) return next(forbidden());
  // Staff sessions must have completed MFA (limited sessions are already rejected by requireAuth).
  if (!u.mfa_enabled || !req.auth.session.mfa_verified_at) return next(forbidden('Multi-factor authentication is required.', 'MFA_ENROLLMENT_REQUIRED'));
  next();
};

/** Backend permission check. The frontend hides buttons, but this is the control that matters. */
export const requirePermission = (permission) => (req, res, next) =>
  can(req.auth?.user.role, permission) ? next() : next(forbidden('You do not have permission to perform this action.', 'FORBIDDEN'));

/** Customers must have a session PIN before they can use banking features (staff are exempt: they unlock with password + authenticator code). */
export const requirePinSet = (req, res, next) =>
  (req.auth?.user.role === 'customer' && !req.auth.user.session_pin_hash
    ? next(forbidden('Set up your six-digit session PIN to continue.', 'PIN_SETUP_REQUIRED'))
    : next());
