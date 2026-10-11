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
| `/users` | `GET/PATCH me` (changing the phone number needs `currentPassword`), `POST/GET me/photo`, `GET/PUT me/preferences` (theme, text size, contrast, motion, language, timezone, date/time/number formats, dashboard), `POST me/email-change` (`{ newEmail, password }` → code sent to the new address) and `POST me/email-change/confirm` (`{ code }`), `POST me/feedback`, `GET me/legal-acceptances` |
| `/accounts` | `GET /`, `POST /` (open extra), `GET /:id`, `PATCH /:id` (`{ name }`), `GET /:id/summary` (chart data), `GET|POST|DELETE /:id/closure` (request / cancel closing an account; needs password; balance must be zero) |
| `/transactions` | `GET /` (q, type, status, from, to, accountId, limit, offset), `GET /:id`, `POST /transfers` (needs `idempotencyKey`) |
| `/withdrawals` | `GET /`, `POST /`, `GET /:id`, `POST /:id/cancel` |
| `/verification` | `GET status`, `POST start`, `POST documents` (multipart), `POST submit`, `POST webhook` (HMAC signed, no cookies) |
| `/notifications` | `GET /`, `POST /:id/read`, `POST read-all`, `GET/PUT preferences` |
| `/support` | `GET /`, `POST /` (multipart), `GET /:id`, `POST /:id/replies`, `POST /:id/close`, `GET attachments/:id` |
| `/security` | `GET overview`, `POST password`, `POST mfa/setup|enable|disable|recovery-codes`, passkeys `GET /passkeys`, `POST passkeys/options|register`, `PATCH|DELETE passkeys/:id`, `POST sessions/revoke-others`, `DELETE sessions/:id`, `DELETE devices/:id` |

## Public website content (no login)
`GET /api/public/site` (published branding + content; falls back to built-in defaults) · `GET /api/public/assets/:id` (image, only while referenced by the published site) · `GET /api/public/legal` · `GET /api/public/legal/:slug` (`terms|privacy|cookies|security|accessibility`). Responses use `Cache-Control: public, no-cache` so a publish is visible immediately.

## Staff (RBAC-enforced; see `config/permissions.js`)
| Area | Endpoints (permission) |
|---|---|
| `/admin` | `GET dashboard`, customers (`customers.read`; `POST customers/:id/actions` → `accounts.review` / `customers.status` / `sessions.reset` per action), withdrawals (`withdrawals.read|note|review|decide`), verification (`verification.review`), support (`support.read|manage`), `security-events` (`security.read|manage`), `staff` (`staff.manage`) |
| `/admin/site` | `site.manage`: `GET /` (editor state), `PUT draft`, `DELETE draft`, `POST publish`, `GET versions`, `POST restore`, `POST assets` (multipart: `kind` = `logo_light|logo_dark|favicon|hero`, `file`), `GET assets/:id` (draft preview) |
| `/admin/legal` | `legal.edit`: `GET /`, `GET /:slug`, `GET /:slug/versions/:versionId`, `PUT /:slug/draft`, `DELETE /:slug/draft`; `legal.publish` + MFA step-up: `POST /:slug/publish`, `POST /:slug/restore` |
| `/admin/account-closures` | `accounts.review`: `GET /`, `POST /:id` (`{ decision: complete|decline, note }`) |
| `/ledger` | `POST adjustments` (`ledger.adjust` + MFA step-up), `POST reversals` (`ledger.reverse` + MFA), `GET accounts/:id` (`ledger.read`, includes integrity check) |
| `/audit` | `GET /` (`audit.read`) — append-only log |

Roles: Super Admin (all) · Compliance/Admin · Support Agent · Finance Operator · Security Administrator.

## Rate limits
Global 600 / 15 min / IP; auth endpoints 30; money-adjacent 60; uploads 40 / hour. Login also locks an account for
15 minutes after 5 failures (uniform responses to avoid account enumeration).
