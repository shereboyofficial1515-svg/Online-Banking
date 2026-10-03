// Thin fetch client. Cookies carry the session (HttpOnly, so JS never sees tokens). A double-submit CSRF
// token is echoed in a header for every state-changing request. A 401 triggers one silent refresh + retry.
export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message);
    this.status = status; this.code = code; this.details = details; this.requestId = requestId;
  }
}

let csrf = null;
async function ensureCsrf() {
  if (csrf) return csrf;
  const m = document.cookie.match(/(?:^|; )ewb_csrf=([^;]+)/);
  if (m) { csrf = decodeURIComponent(m[1]); return csrf; }
  const r = await fetch('/api/auth/csrf', { credentials: 'include' });
  csrf = (await r.json()).csrfToken;
  return csrf;
}

let refreshing = null;
const NO_REFRESH = ['/api/auth/login', '/api/auth/refresh', '/api/auth/register', '/api/auth/logout', '/api/auth/passkey', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email', '/api/auth/resend-verification', '/api/auth/login/mfa', '/api/auth/csrf', '/api/auth/config'];

async function raw(path, { method = 'GET', body, formData, signal } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  return fetch(path, { method, headers, body: payload, credentials: 'include', signal });
}

async function parse(res) {
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (res.ok) return data;
  const e = data?.error;
  throw new ApiError(res.status, e?.code || 'ERROR', e?.message || 'Something went wrong. Please try again.', e?.details, e?.requestId);
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
    const clone = res.clone();
    const body = await clone.json().catch(() => null);
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
