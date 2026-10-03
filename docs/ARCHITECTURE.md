# Architecture

## Layers (backend)

```
routes/        URL → middleware chain → controller        (no business logic)
controllers/   HTTP ⇄ service translation                 (identity comes ONLY from req.auth)
services/      business rules, transactions, audit        (ledger, auth, withdrawals, …)
repositories/  SQL primitives (users, ledger)
providers/     replaceable integrations (email, storage, identity, payment, banking, sms, fraud)
middleware/    authenticate, RBAC, CSRF, rate limit, validation (zod), upload, errors
db/            pg / PGlite adapter, migrations, seeds
```

## The ledger

* Money is `BIGINT` minor units. Floats never touch balances.
* `ledger_entries` are **append-only** (DB trigger rejects UPDATE/DELETE). Each entry has a gapless per-account `seq`
  and `balance_after`. The authoritative balance is `SUM(credit) − SUM(debit)`; `verifyIntegrity()` reconciles
  running balances and sequence numbers.
* Double entry: staff funding posts customer ⇄ an internal *funding* system account (which may go negative);
  transfers post debit/credit between two customer accounts. A DB trigger refuses to drive a customer account negative
  even if application code were bypassed.
* `transactions` financial fields are frozen by trigger; `status` may only advance along allowed transitions
  (`pending→completed|failed|blocked|cancelled`, `blocked→pending|cancelled`, `completed→reversed`).
* Corrections are **new** entries: `reverse()` appends compensating entries and marks the original `reversed`.
* Concurrency: accounts are row-locked (`FOR UPDATE`, in id order) before posting; idempotency keys prevent
  double-posting on retries.
* **Available balance** = ledger balance − funds held by open withdrawal requests. Requests reserve availability but
  never create ledger entries.

## Withdrawals

`POST /api/withdrawals` validates auth, account status, ownership, amount and (for verification) identity status, then
records a request (+ a `pending`/`blocked` transaction with **no ledger entries**). Staff workflow:
`requested → under_review → additional_verification_required | customer_support_required → approved | rejected`.
`approved` means *approved in the internal test workflow*; every API response, email and screen says no external
transfer occurred. Nothing in `ledgerService`, `withdrawalService` or `accountService` can reach a payment/banking
provider (asserted by a test). Approval requires `withdrawals.decide`, a fresh TOTP code, a verified customer, and
cannot be self-approved.

## Identity, sessions and devices

* Passwords: Argon2id. Reset/verify tokens: random, hashed at rest, single-use, short-lived.
* Access token (JWT, 15 min / 10 min staff, HttpOnly cookie) + rotating refresh token (separate secret). The server
  stores only a hash of the refresh `jti`; replaying an old refresh token revokes the session.
* Role/status are re-read from the DB on every request. Staff sessions without MFA are *limited* to MFA enrolment.
* Devices are tracked by an opaque cookie → new-device detection, trusted devices (customers only), per-device revoke.
* Passkeys (WebAuthn): server stores credential id + public key + counter only. Customers only.
* TOTP secrets are AES-256-GCM encrypted; accepted time-steps cannot be replayed; recovery codes are hashed, single-use.

## Provider abstractions (future regulated integrations)

| Interface | Shipped implementation | To go live |
|---|---|---|
| `EmailProvider` | Resend (REST) / console (dev) | verify sending domain |
| `StorageProvider` | Supabase Storage (private) / local / memory | create buckets (migration 003) |
| `IdentityVerificationProvider` | manual review, signed-webhook adapter | contract a KYC vendor, map its webhook |
| `PaymentProvider`, `BankingProvider` | **Null — throw 501** | licensed partner + reconciliation job |
| `SmsProvider`, `FraudProvider` | Null / internal rules | choose vendors |

`LEDGER_MODE=live` is refused at startup unless real Payment and Banking providers are registered.

## Frontend

React + React Router, code-split per area (public / customer / admin). Design tokens in `styles/base.css`; reusable
primitives in `components/ui` (Field, Modal, Drawer, DataTable, Toast, Skeleton, charts…). GSAP animates entrances,
dialogs and transaction expansion and is fully disabled under `prefers-reduced-motion`. The UI hides actions by
permission as a convenience only — every privilege is enforced again on the API.
