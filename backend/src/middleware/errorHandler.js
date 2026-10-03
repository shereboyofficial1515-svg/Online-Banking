import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

/**
 * Centralised error responses. Only AppError messages (written to be user-safe) reach the client. Anything
 * else - database errors, stack traces, library errors - is logged server-side with the request id and replaced
 * by a generic 500, so no internal detail ever leaks.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const requestId = req.ctx?.requestId;
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again in a moment.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err?.code === 'LIMIT_FILE_SIZE') {
    status = 400; code = 'FILE_TOO_LARGE'; message = 'That file is too large.';
  } else if (err?.name === 'MulterError') {
    status = 400; code = 'BAD_UPLOAD'; message = 'The upload could not be processed.';
  } else if (err?.type === 'entity.too.large') {
    status = 400; code = 'BAD_REQUEST'; message = 'The request is too large.';
  } else if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    status = 400; code = 'BAD_REQUEST'; message = 'The request body is not valid JSON.';
  } else if (err?.code === '23505') {
    status = 409; code = 'CONFLICT'; message = 'That record already exists.';
  } else if (err?.code === '23514' && /insufficient funds/i.test(err.message)) {
    status = 409; code = 'INSUFFICIENT_FUNDS'; message = 'Insufficient funds.';
  } else if (err?.code === '23000' || err?.code === '23503') {
    status = 409; code = 'CONFLICT'; message = 'The request conflicts with existing data.';
  }

  if (status >= 500) logger.error('unhandled error', { requestId, path: req.originalUrl, method: req.method, error: err });
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId } });
}
