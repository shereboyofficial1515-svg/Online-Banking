import config from '../config/index.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = levels[config.logLevel] ?? 20;
const SENSITIVE = /(password|secret|token|authorization|cookie|api[_-]?key|otp|code)/i;

// Strip anything that looks like a credential before it can reach logs.
function scrub(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[redacted]' : scrub(v, depth + 1);
    return out;
  }
  return value;
}

function emit(level, msg, meta) {
  if (levels[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(meta ? { meta: scrub(meta) } : {}) });
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
