import crypto from 'node:crypto';

// Per-request context handed to services (IP, UA, request id). The authenticated actor is attached by requireAuth.
export function requestContext(req, res, next) {
  const requestId = crypto.randomUUID();
  req.ctx = { requestId, ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300), actor: null, sessionId: null, deviceId: null };
  res.setHeader('X-Request-Id', requestId);
  next();
}
