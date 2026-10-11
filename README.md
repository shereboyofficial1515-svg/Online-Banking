# EWB Bank

A security-first digital banking web platform with an **internal software ledger**.

> **What this is — and is not.** EWB Bank is an original, independent brand for this software project. It is not
> affiliated with, and does not use any branding, assets or copy from, any existing financial institution. Today the
> platform runs a **simulated internal ledger**: balances are ledger records, *not* deposits; withdrawals are
> *requests for staff review* that never move money externally; and EWB Bank makes **no** claim to be a licensed,
> regulated or insured institution. The code is structured so that regulated rails can be added later behind provider
> interfaces — but only after the legal/compliance steps in [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

```
Online Banking/
├── backend/    Node.js · Express · Supabase PostgreSQL (pg) · REST API       → npm test (183 tests)
├── frontend/   React 19 · Vite · React Router · GSAP · hand-written CSS      → npm test (83 tests)
├── docs/       Architecture, API, security audit, compliance, Supabase setup
├── DEPLOYMENT.md   Vercel (frontend) + Render (backend) + Supabase, step by step
└── render.yaml     Render Blueprint for the API
```

## Quick start (zero configuration)

Requires Node.js ≥ 22.9.

```bash
cd backend  && npm install
cd ../frontend && npm install && npm run build      # the API serves frontend/dist on the same origin
cd ../backend
npm run seed:dev                                     # optional: staff + demo customers → .data/dev-credentials.json (git-ignored)
APP_URL=http://localhost:4000 npm start              # http://localhost:4000
```

**Environment file:** put it at `backend/.env` or the repository root `.env` (found from any directory; see `.env.example`, placeholders only). Production uses host variables instead — see [DEPLOYMENT.md](DEPLOYMENT.md). Development defaults without a file: embedded PostgreSQL ([PGlite](https://pglite.dev)) in `backend/.data`, emails printed to the
console (recorded as `logged_only`, never as delivered), and random JWT secrets generated once into `.data/`.
For hot reload run `npm run dev` in `backend/` and `npm run dev` in `frontend/` (Vite proxies `/api`; open
`http://localhost:5173`, which is the default `APP_URL`).

Create your first Super Admin (password comes from the environment, never from source):

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-Str0ng!password' npm run seed:admin
```
Staff must enrol an authenticator app (MFA) on first sign-in before any admin page is reachable.

## Production / Supabase

1. Create a Supabase project. Run `npm run migrate` with `DATABASE_URL` set to its connection string
   (migrations create the schema, RLS, immutability triggers and private Storage buckets).
2. Copy `.env.production.example` → `backend/.env`; set Supabase, JWT, Resend and URL values. The API **refuses to
   start** with missing/weak secrets, non-HTTPS URLs, or `LEDGER_MODE=live`.
3. `npm run seed:admin`, then deploy the API (it serves the built SPA). Details: [docs/SUPABASE.md](docs/SUPABASE.md).

## Testing

| Command (in `backend/`) | What it covers |
|---|---|
| `npm test` | 183 tests on a real Postgres engine (never reads `.env`): environment loading/validation, migrations, auth, 12-digit account numbers, display preferences, admin website/branding CMS and legal documents (publish, versions, acceptance, uploads, permissions), settings (email change, closure), MFA, lockout, CSRF, rate limiting, sessions, ledger math & immutability, concurrency, withdrawals, verification + signed webhook, support, notifications, RBAC matrix, the "normal user must never…" matrix, error handling, headers, emails |
| `npm run test:pg` | Re-runs suites through the production `pg` driver over the Postgres wire protocol with a 1-connection pool (catches transaction deadlocks) |
| `npm test` (in `frontend/`) | 83 tests: WCAG contrast computed from the real design tokens (light, dark, high-contrast), theme/preferences, settings pages, safe Markdown rendering, branding and fallback, accessibility wiring, modal focus-trap, tables, error boundary, API client (CSRF, refresh-once, timeouts, network errors, configurable base URL), customer-facing wording and unsupported-claim checks |

## Status and honest limitations

Verified in this repository: the test suites above; a production build; and manual browser checks of sign-in with
TOTP, the admin ledger-credit flow (MFA step-up) and every customer route on desktop and phone widths.

**Not verified / not built — please read:**
- **Not tested against a live Supabase project or live Resend account** (no credentials were available). The `pg` and
  Resend code paths are covered by wire-protocol and mocked-HTTP tests respectively; do a smoke test in staging.
- **WebAuthn**: option generation, challenge single-use, and rejection paths are tested; a full registration/sign-in
  ceremony needs a real authenticator and is untested here.
- **Phone verification / SMS** is not implemented (`SmsProvider` is a stub); the UI says so.
- **Identity verification** ships with manual document review and a signed-webhook adapter; no commercial KYC vendor
  is connected. **No real-money rails exist** (`PaymentProvider`/`BankingProvider` throw `PROVIDER_NOT_CONFIGURED`).
- Staff sign in with password + TOTP only; passkey sign-in is intentionally limited to customers.
- No automated accessibility audit (axe/Lighthouse) was run; WCAG work is by construction and manual review.
- Terms/Privacy text is a sensible draft, **not legal advice** — have counsel review before launch.

## More documentation
[docs/WEBSITE_CMS.md](docs/WEBSITE_CMS.md) (admin-editable website, branding, legal documents) · [docs/ACCOUNT_NUMBERS.md](docs/ACCOUNT_NUMBERS.md) (12-digit numbers, migration plan, rollback) · [docs/HERO_IMAGE.md](docs/HERO_IMAGE.md) (image source and licence) · [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) · [docs/API.md](docs/API.md) · [DEPLOYMENT.md](DEPLOYMENT.md)
