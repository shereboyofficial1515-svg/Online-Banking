import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import { tooMany } from '../utils/errors.js';

const make = (windowMs, limit) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  handler: (req, res, next) => next(tooMany()),
});

export const globalLimiter = make(15 * 60_000, 600);
export const authLimiter = make(15 * 60_000, 30);      // login, register, reset, MFA, passkey endpoints
export const sensitiveLimiter = make(15 * 60_000, 60); // money-adjacent endpoints
export const uploadLimiter = make(60 * 60_000, 40);
