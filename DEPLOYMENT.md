# EWB Bank — Deployment guide

Architecture: **React/Vite SPA on Vercel** → (same-origin `/api` rewrite) → **Express API on Render** → **Supabase** (PostgreSQL + private Storage). Email via **Resend**.

```
Browser ──https──▶ Vercel (static SPA + /api rewrite) ──https──▶ Render web service ──▶ Supabase Postgres / Storage
                                                                         └──────────────▶ Resend
```

Why a rewrite instead of calling Render directly: session cookies are `HttpOnly; SameSite=Strict`, and `vercel.app` and `onrender.com` are different sites, so a browser would not send them on direct calls. With the rewrite the browser only talks to your Vercel domain, cookies stay first-party, there is no CORS surface, and CSRF protection stays strict. (A direct cross-site mode exists; see "Alternative: direct mode".)

---

## 1. Local development

**Prerequisites:** Node.js ≥ 22.9, npm ≥ 10. No local database needed (embedded PGlite) unless you point at Supabase.

```bash
cd backend  && npm ci
cd ../frontend && npm ci
```

**Environment (backend).** Copy `.env.example` to `backend/.env` (or the repository root as `.env`; both are discovered automatically in development, from any working directory) and fill in values. Real values are never committed (`.env` is git-ignored; `.env.example` holds placeholders only). With no file at all, development still starts: embedded database, console email, auto-generated dev secrets in `backend/.data/`.

> ⚠️ A `.env` containing `DATABASE_URL` makes local development use that database. Use a **separate Supabase project for development**, or set `DB_DRIVER=pglite` to stay on the embedded database.

**Database.**
```bash
cd backend
npm run migrate:status     # read-only report: what is applied / pending
npm run migrate            # applies pending migrations (additive; never drops or truncates)
npm run seed:admin         # first Super Admin: ADMIN_EMAIL / ADMIN_PASSWORD from the environment
npm run seed:dev           # optional demo staff + customers (refuses to run in production)
```
If the schema was applied by hand in the Supabase SQL editor (no `schema_migrations` table), `migrate` detects the existing objects, **records** them as applied, and runs only what is pending. Nothing is re-run or dropped.

**Run.**
```bash
cd backend  && npm run dev          # API on http://localhost:4000
cd frontend && npm run dev          # SPA on http://localhost:5173 (proxies /api to :4000)
```
**Tests.**
```bash
cd backend  && npm test             # 183 tests, embedded Postgres, never reads .env
cd backend  && npm run test:pg      # same suites through the production `pg` driver (1-connection pool)
cd frontend && npm test             # 83 tests
cd frontend && npm run build        # production build + automatic secret scan of the bundle
```

---

## 2. Render (backend)

| Setting | Value |
|---|---|
| Service type | Web Service, runtime **Node** |
| Root directory | `backend` |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` (→ `node src/server.js`; listens on `process.env.PORT`, binds `0.0.0.0`) |
| Health check path | `/api/health/live` (no DB call). Use `/api/health` (checks the DB) for uptime monitoring |
| Persistent disk | **Not needed** — data lives in Supabase (DB + Storage). Do not use local file storage on Render |
| Node version | 22 (`NODE_VERSION=22`) |

`render.yaml` at the repository root encodes this as a Blueprint (New → Blueprint). Set the `sync: false` variables in the dashboard — **no `.env` file is uploaded or needed**.

**Environment variables (Render).** Values omitted on purpose.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | Supabase connection string (pooler). Percent-encode special characters in the password (`@` → `%40`) |
| `SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only. Never expose it anywhere else |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | yes | ≥ 32 chars, different. Blueprint uses `generateValue` (stable across deploys) |
| `APP_URL` | yes | Public **https** origin of the Vercel site, no trailing slash. Drives CORS, CSRF origin check, WebAuthn RP ID and email links |
| `CORS_ORIGINS` | optional | Extra allowed origins, comma-separated (e.g. a preview domain) |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPPORT_EMAIL` | yes | From-address must be on a Resend-verified domain |
| `COOKIE_SECURE` | yes | `true` |
| `TRUST_PROXY_HOPS` | yes | `2` with the Vercel rewrite (Render LB + Vercel); `1` if the browser calls Render directly. Wrong value ⇒ wrong client IPs in rate limits/audit |
| `LEDGER_MODE` | yes | `simulated`. `live` is refused at startup |
| `ALLOW_SEED` | yes | `false` |
| `DB_POOL_MAX` | optional | 5–10 |
| `IDENTITY_PROVIDER`, `IDENTITY_WEBHOOK_SECRET` | optional | `manual` by default |

On startup the API validates all of this and **exits with a list of exactly which variables are missing or invalid (names only, never values)**. It also refuses `localhost`/`http` origins, placeholder values and `COOKIE_SECURE=false` in production.

**Database setup for Render.** Run migrations once from your machine against the target project (`DATABASE_URL=… npm run migrate:status`, then `npm run migrate`) — they are not run automatically on deploy. Create the first admin with `npm run seed:admin`. Supabase buckets `profile-photos`, `kyc-documents`, `support-attachments` and `site-assets` must exist and be **private** (migrations `003` and `007` create them).

**Task 02 migrations (`005`–`008`)** are additive and are **not** applied automatically. Order of operations on production: back up → `npm run migrate:status` → `npm run migrate` → deploy the new API and frontend together (the frontend now sends `acceptedTerms` at sign-up; an old API ignores it and a new API requires it, so deploy both before announcing). Renumbering any legacy account numbers is a separate, optional step described in `docs/ACCOUNT_NUMBERS.md`. No new environment variable is required (`SUPABASE_BUCKET_SITE` defaults to `site-assets`).

**Steps.** 1) Push the repo. 2) Render → New → Blueprint → select the repo. 3) Fill the `sync: false` variables. 4) Deploy. 5) Verify (below).

---

## 3. Vercel (frontend)

| Setting | Value |
|---|---|
| Framework preset | **Vite** |
| Root directory | `frontend` |
| Install command | `npm ci` |
| Build command | `npm run build` (runs a pre-build API-location guard and a post-build secret scan) |
| Output directory | `dist` |
| Node version | 20 or 22 |

**Configure the API location (required, one edit).** In `frontend/vercel.json` replace `https://YOUR-BACKEND.onrender.com` in the `/api/:path*` rewrite with your Render service URL. **The Vercel build intentionally fails while the placeholder is still there.** (Vercel rewrite destinations cannot read environment variables.)

**Environment variables (Vercel).** None are required in the default (rewrite) setup. Only `VITE_`-prefixed variables are ever embedded in the browser bundle, so never put secrets in Vercel's frontend variables.

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | no | Leave empty. Set only for direct mode, e.g. `https://YOUR-BACKEND.onrender.com/api` |

`vercel.json` also provides: SPA fallback (page refresh on any route works), security headers (CSP, HSTS, `X-Frame-Options`, `nosniff`, referrer and permissions policies) and long-lived caching for hashed assets.

**Steps.** 1) Edit the rewrite destination. 2) Vercel → Add New Project → import repo → set Root Directory `frontend`. 3) Deploy. 4) Copy the production URL into Render's `APP_URL`, redeploy Render. 5) Verify.

### Alternative: direct mode (not recommended)
Set `VITE_API_BASE_URL` on Vercel; on Render set `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1`, and list the Vercel origin in `APP_URL`/`CORS_ORIGINS`; add the API origin to `connect-src` and `img-src` in `vercel.json`. Browsers that block third-party cookies (Safari, increasingly Chrome) will break sign-in in this mode.

---

## 4. Production verification checklist

Run after both are deployed. Replace the placeholders.

```bash
curl -s https://YOUR-SITE.vercel.app/api/health/live        # {"status":"ok"} via the rewrite
curl -s https://YOUR-SITE.vercel.app/api/health             # {"status":"ok","ledgerMode":"simulated"} = DB reachable
curl -sI https://YOUR-SITE.vercel.app/ | grep -iE "content-security|strict-transport|x-frame|nosniff"
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-SITE.vercel.app/app/transactions   # 200 (SPA deep link)
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-SITE.vercel.app/api/admin/dashboard # 401 (unauthenticated)
curl -s https://YOUR-SITE.vercel.app/assets/*.js | grep -c "service_role"                 # 0
```
Then in a browser: register → verify email → sign in → refresh the page (still signed in) → open Transactions → sign out → confirm `/app` redirects to sign-in. As staff: sign in with MFA, post a ledger credit, confirm the audit entry. Confirm a withdrawal request shows "no funds have been sent".

| Area | How to confirm |
|---|---|
| Frontend reachable | site loads over https; deep links work |
| Backend health | `/api/health/live` and `/api/health` |
| API connectivity | login works; DevTools shows only same-origin `/api/*` calls |
| Authentication | cookies `ewb_at`/`ewb_rt` are `HttpOnly; Secure; SameSite=Strict` |
| Database | `/api/health` returns ok; `npm run migrate:status` shows nothing pending |
| Error handling | unknown `/api/x` → JSON 404 with `requestId`, no stack traces |
| Security headers | the `curl -I` above |
| Secret exposure | `npm run build` prints "Bundle secret scan passed"; `grep` of the deployed JS finds no keys |
| Financial safeguards | transfer needs verified identity + idempotency key; withdrawals create no ledger entries; ledger credits need staff MFA |

### Verified in this repository vs. still to verify after deployment

**Verified here** (see `docs/SECURITY_AUDIT.md` for evidence): environment loading and validation; local startup against Supabase (read-only requests); database schema/triggers/RLS and storage buckets present; all backend and frontend tests; production build + bundle secret scan; the Vercel-style rewrite path (login, session persistence, logout, deep links, outage handling) using a local simulation; security headers; rate limiting.

**Requires testing after deployment:** the real Vercel rewrite and cookie behaviour on your domains; Render cold starts and health-check timing; Resend delivery from your verified domain (the API has only been exercised with a stubbed HTTP response); WebAuthn passkey registration/sign-in on your production hostname; Supabase Storage uploads under production load; `TRUST_PROXY_HOPS` yielding the correct client IP (check `login_events.ip`).
