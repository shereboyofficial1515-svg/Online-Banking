// Thin fetch client. Cookies carry the session (HttpOnly, so JS never sees tokens). A double-submit CSRF
// token is echoed in a header for every state-changing request. A 401 triggers one silent refresh + retry.
//
// API location:
//   * default            -> same-origin "/api" (Vite dev proxy, or a Vercel rewrite to the backend). Cookies stay first-party.
//   * VITE_API_BASE_URL  -> absolute API base, e.g. https://YOUR-BACKEND.onrender.com/api (direct cross-site mode;
//                           the backend must then set COOKIE_SAMESITE=none and list this site in APP_URL/CORS_ORIGINS).
// Only VITE_-prefixed variables are ever bundled by Vite, and this one is public by nature (it is a URL).
export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message);
    this.status = status; this.code = code; this.details = details; this.requestId = requestId;
  }
}

const BASE = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const TIMEOUT_MS = 20_000;

/** Maps an internal "/api/..." path to the configured API base. Use for <img src> and <a href> too. */
export const apiUrl = (path) => BASE + path.replace(/^\/api(?=\/|$)/, '');

let csrf = null;
async function ensureCsrf() {
  if (csrf) return csrf;
  const m = document.cookie.match(/(?:^|; )ewb_csrf=([^;]+)/); // readable only when the API is same-origin
  if (m) { csrf = decodeURIComponent(m[1]); return csrf; }
  const r = await fetchWithTimeout(apiUrl('/api/auth/csrf'), { credentials: 'include' });
  csrf = (await r.json()).csrfToken;
  return csrf;
}

/** fetch with a timeout; network failures and timeouts become friendly ApiErrors instead of raw TypeErrors. */
async function fetchWithTimeout(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const outer = init.signal;
  if (outer) outer.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (outer?.aborted) throw e; // caller cancelled on purpose
    const timedOut = e?.name === 'AbortError';
    throw new ApiError(0, timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      timedOut ? 'EWB Bank took too long to respond. Please try again.' : 'We couldn’t reach EWB Bank. Check your connection and try again.');
  } finally { clearTimeout(timer); }
}

let refreshing = null;
const NO_REFRESH = ['/api/auth/login', '/api/auth/refresh', '/api/auth/register', '/api/auth/logout', '/api/auth/passkey', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email', '/api/auth/resend-verification', '/api/auth/login/mfa', '/api/auth/csrf', '/api/auth/config', '/api/auth/session'];

async function raw(path, { method = 'GET', body, formData, signal } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  return fetchWithTimeout(apiUrl(path), { method, headers, body: payload, credentials: 'include', signal });
}

async function parse(res) {
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (res.ok) return data;
  const e = data?.error;
  // Non-JSON error pages (e.g. a hosting 502/504 while the backend wakes up) still get a clear message.
  const fallback = res.status >= 500 ? 'EWB Bank is temporarily unavailable. Please try again in a moment.' : 'Something went wrong. Please try again.';
  throw new ApiError(res.status, e?.code || 'ERROR', e?.message || fallback, e?.details, e?.requestId);
}

export async function request(path, opts = {}) {
  let res = await raw(path, opts);
  if (res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    refreshing ||= raw('/api/auth/refresh', { method: 'POST' }).finally(() => { setTimeout(() => { refreshing = null; }, 0); });
    const r = await refreshing;
    if (r.ok) res = await raw(path, opts);
    else window.dispatchEvent(new CustomEvent('ewb:session-expired'));
  }
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if (body?.error?.code === 'CSRF_INVALID') { csrf = null; document.cookie = 'ewb_csrf=; Max-Age=0; path=/'; }
  }
  return parse(res);
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (path, params, signal) => request(path + qs(params), { signal }),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', formData }),
};

/** Map a 422 error's details ({field: [msgs]}) to {field: 'first message'} for forms. */
export const fieldErrors = (err) => {
  if (!err?.details) return {};
  return Object.fromEntries(Object.entries(err.details).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));
};

/** True when the API could not be reached at all (offline, timeout, or the host's 502/503/504 while the backend starts). */
export const isNetworkError = (e) => e?.code === 'NETWORK_ERROR' || e?.code === 'TIMEOUT' || [502, 503, 504].includes(e?.status);
