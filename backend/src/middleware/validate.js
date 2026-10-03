import { validationError } from '../utils/errors.js';

/** Validate (and strip unknown keys from) body/query/params against a zod schema. */
export const validate = (schema, part = 'body') => (req, res, next) => {
  const parsed = schema.safeParse(req[part] ?? {});
  if (!parsed.success) {
    const details = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ||= []).push(issue.message);
    }
    return next(validationError(details));
  }
  if (part === 'query') Object.defineProperty(req, 'query', { value: parsed.data, writable: true, configurable: true });
  else req[part] = parsed.data;
  next();
};
