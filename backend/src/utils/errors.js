// Application errors carry a safe, user-presentable message and a stable code.
// Anything that is not an AppError is reported as a generic 500.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m = 'The request could not be processed.', d) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication is required.', code = 'UNAUTHORIZED') => new AppError(401, code, m);
export const forbidden = (m = 'You do not have permission to perform this action.', code = 'FORBIDDEN') => new AppError(403, code, m);
export const notFound = (m = 'The requested resource was not found.') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m = 'The request conflicts with the current state.', code = 'CONFLICT') => new AppError(409, code, m);
export const validationError = (details, m = 'Some of the information provided is not valid.') => new AppError(422, 'VALIDATION_ERROR', m, details);
export const tooMany = (m = 'Too many requests. Please try again later.') => new AppError(429, 'TOO_MANY_REQUESTS', m);
