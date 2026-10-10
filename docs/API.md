# API reference

Base path `/api`. JSON in/out. Auth is cookie-based (`ewb_at` access, `ewb_rt` refresh, both HttpOnly + SameSite=Strict).
Every non-GET request needs `X-CSRF-Token` equal to the `ewb_csrf` cookie (`GET /api/auth/csrf` issues it) and an allowed
`Origin`. Errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "field": ["…"] }, "requestId": "…" } }
```
Statuses: 400 bad request · 401 unauthenticated · 403 forbidden (incl. `CSRF_INVALID`, `MFA_ENROLLMENT_REQUIRED`) ·
404 · 409 conflict (e.g. `INSUFFICIENT_FUNDS`, `VERIFICATION_REQUIRED`) · 422 validation · 429 rate limit · 500 generic.

> **Ledger mode:** all money endpoints operate on the internal software ledger. No endpoint transfers funds externally.

## Public / auth — `/api/auth`
`GET csrf` · `GET config` · `GET session` · `POST register` · `POST verify-email` (`{ email, code }`, 6-digit emailed code: valid 15 min, 5 attempts, per-address resend cooldown) · `POST resend-verification` ·
`POST login` (→ `mfaRequired` + `mfaToken`) · `POST login/mfa` · `POST refresh` · `POST logout` · `GET me` ·
`POST forgot-password` · `POST reset-password` · `POST passkey/options` · `POST passkey/verify`

## Customer
| Area | Endpoints |
|---|---|
| `/users` | `GET/PATCH me`, `POST/GET me/photo` |
| `/accounts` | `GET /`, `POST /` (open extra), `GET /:id`, `GET /:id/summary` (chart data) |
| `/transactions` | `GET /` (q, type, status, from, to, accountId, limit, offset), `GET /:id`, `POST /transfers` (needs `idempotencyKey`) |
| `/withdrawals` | `GET /`, `POST /`, `GET /:id`, `POST /:id/cancel` |
| `/verification` | `GET status`, `POST start`, `POST documents` (multipart), `POST submit`, `POST webhook` (HMAC signed, no cookies) |
| `/notifications` | `GET /`, `POST /:id/read`, `POST read-all`, `GET/PUT preferences` |
| `/support` | `GET /`, `POST /` (multipart), `GET /:id`, `POST /:id/replies`, `POST /:id/close`, `GET attachments/:id` |
| `/security` | `GET overview`, `POST password`, `POST mfa/setup|enable|disable|recovery-codes`, passkeys `GET /passkeys`, `POST passkeys/options|register`, `PATCH|DELETE passkeys/:id`, `POST sessions/revoke-others`, `DELETE sessions/:id`, `DELETE devices/:id` |

## Staff (RBAC-enforced; see `config/permissions.js`)
| Area | Endpoints (permission) |
|---|---|
| `/admin` | `GET dashboard`, customers (`customers.read`; `POST customers/:id/actions` → `accounts.review` / `customers.status` / `sessions.reset` per action), withdrawals (`withdrawals.read|note|review|decide`), verification (`verification.review`), support (`support.read|manage`), `security-events` (`security.read|manage`), `staff` (`staff.manage`) |
| `/ledger` | `POST adjustments` (`ledger.adjust` + MFA step-up), `POST reversals` (`ledger.reverse` + MFA), `GET accounts/:id` (`ledger.read`, includes integrity check) |
| `/audit` | `GET /` (`audit.read`) — append-only log |

Roles: Super Admin (all) · Compliance/Admin · Support Agent · Finance Operator · Security Administrator.

## Rate limits
Global 600 / 15 min / IP; auth endpoints 30; money-adjacent 60; uploads 40 / hour. Login also locks an account for
15 minutes after 5 failures (uniform responses to avoid account enumeration).
