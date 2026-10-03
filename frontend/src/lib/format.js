export const money = (minor, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(minor ?? 0) / 100);

export const dateTime = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');
export const date = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso)) : '—');

export function relativeTime(iso, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400]];
  let out = 'just now';
  for (const [name, size] of units) if (s >= size) { const n = Math.floor(s / size); out = `${n} ${name}${n > 1 ? 's' : ''} ago`; }
  return s >= 86400 * 30 ? date(iso) : out;
}

export const mask = (n) => (n ? `••••${String(n).slice(-4)}` : '');
export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const initials = (u) => `${u?.firstName?.[0] ?? ''}${u?.lastName?.[0] ?? ''}`.toUpperCase() || 'EW';

// Mirrors the server password policy so users get instant feedback; the server remains the authority.
export function passwordChecks(pw, email = '') {
  const local = email.split('@')[0]?.toLowerCase();
  return [
    { id: 'len', label: 'At least 12 characters', ok: pw.length >= 12 },
    { id: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(pw) },
    { id: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(pw) },
    { id: 'num', label: 'A number', ok: /\d/.test(pw) },
    { id: 'sym', label: 'A symbol', ok: /[^A-Za-z0-9]/.test(pw) },
    { id: 'common', label: 'No common words or your email name', ok: pw.length > 0 && !/password|qwerty|123456|letmein|welcome|iloveyou/i.test(pw) && !(local && local.length >= 4 && pw.toLowerCase().includes(local)) },
  ];
}
export const passwordScore = (pw, email) => passwordChecks(pw, email).filter((c) => c.ok).length;

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
