# EWB Bank — Security & configuration audit (Engineering Task 01)

Scope: backend (Express/pg), frontend (React/Vite), deployment configuration. Method: code review, an adversarial test
suite written *before* the fixes (so failures confirm findings), dependency audit, local runtime checks, and a simulated
Vercel→Render path. **No real financial transaction was made and no production data was changed.** Read-only requests were
made to the configured Supabase project (connectivity, table list, row counts, bucket list).

> This is an engineering review, not a penetration test or a guarantee. A passing build and test suite do not prove the
> application is secure; see "Unresolved risks" and get an independent test before handling real customers.

## Environment issue — root cause

The real `.env` lives at the **repository root**. The backend's scripts used `node --env-file-if-exists=.env`, which resolves
the path against the **current working directory** (`backend/`). The file was therefore never read — Node printed
`.env not found. Continuing without it.` and the API silently fell back to development defaults (embedded database,
console email, generated dev secrets). Reproduced exactly; `DATABASE_URL` etc. were invisible to the process.

**Fix:** one loader, `backend/src/config/loadEnv.js`, anchored to the file's own location (not the cwd), searching
`ENV_FILE` → `backend/.env` → repo-root `.env`. Real process variables always win; a file is optional; auto-discovery is
development-only (staging/production use the host's variables unless `ENV_FILE` is set); tests never read files. The competing
`--env-file-if-exists` flags were removed. Startup validation names every missing/invalid variable without printing values.

## Findings

Severity = my assessment of impact × likelihood in this deployment.

| ID | Finding | Severity | Status |
|---|---|---|---|
| S-01 | **Real credentials in a committed template.** The working copy of `.env.example` contained the live Supabase database password, anon key and service-role key. | **High** (Critical had it been committed) | Fixed; **rotation required** |
| S-02 | Env file not found (root cause above) → silent dev-default fallback | Medium | Fixed |
| S-03 | Cross-site cookie mismatch for Vercel + Render: `SameSite=Strict` cookies are not sent across `vercel.app`↔`onrender.com`, so login/session would fail in production | High (deployment-blocking) | Fixed by design |
| S-04 | Single-boolean `trust proxy`: behind Vercel + Render the app would key rate limits/audit IPs on a shared proxy address | Medium | Fixed |
| S-05 | Duplicate withdrawal submissions (double click / retry) created two requests and two holds | Medium | Fixed |
| S-06 | Password-reset and verification emails could be repeated without limit per address (inbox flooding) | Medium | Fixed |
| S-07 | Stray developer `.env` auto-loaded in production could silently fill missing variables | Medium | Fixed |
| S-08 | Tests could have read real credentials / a remote database once an env loader existed | Medium (preventive) | Fixed |
| S-09 | Database TLS was only enabled when `NODE_ENV=production`; dev/staging against Supabase were not forced to TLS | Low–Medium | Fixed |
| S-10 | Email bodies (single-use links) were stored in `email_outbox` whenever the console provider was used outside production | Low | Fixed |
| S-11 | Frontend showed raw `Failed to fetch`, had no request timeout, and treated a hosting 502/504 as "signed out" | Low | Fixed |
| S-12 | Database TLS certificate not verified (Supabase private CA) | Low–Medium | Mitigated (optional `DB_SSL_CA`) |

### Details

**S-01 — credentials in `.env.example`.** *Files:* `.env.example`. *Root cause:* real values were pasted into the tracked
template instead of the git-ignored `.env`. *Impact:* anyone with the repo could read/write the database and storage (the
service-role key bypasses row-level security). *Fix:* template restored to placeholders (the identical values were already in the
git-ignored `.env`, so nothing was lost); `.gitignore` verified (`.env`, `.env.*`, with `!.env.example` / `!.env.*.example`);
tests now fail if any `.env*.example` contains a JWT-shaped token, a database URL with a password, a real Supabase project
reference, or a value for a secret variable, and if any source/doc file embeds a JWT-shaped token. *Verification:*
`git show HEAD:.env.example` contains none of these (the values were never committed; one commit exists); `config.test.js › secrets hygiene`.
**Unresolved:** the values were displayed in this working session, so **rotate the Supabase database password and the service-role key**
(and treat the anon key as public). Also rotate the Resend key if it was ever shared.

**S-03 / S-04 — Vercel↔Render.** *Files:* `frontend/vercel.json`, `backend/src/config/index.js`, `app.js`, `controllers/authController.js`,
`middleware/csrf.js`. *Fix:* the SPA calls same-origin `/api`, which Vercel rewrites to Render, so cookies stay first-party with
`SameSite=Strict` and CORS is not in the path; `TRUST_PROXY_HOPS` takes the exact proxy count (2 here); `COOKIE_SAMESITE=none` is
available for a direct cross-site setup (requires Secure, validated at startup). A build guard fails the Vercel build while the rewrite
still points at the `YOUR-BACKEND` placeholder. *Verification:* simulated Vercel (static + `/api` proxy + the real headers): login, wrong
password, HttpOnly cookies invisible to JS, accounts/transactions, customer→admin 403, persistence across refresh, logout then 401, deep links,
backend-down screen with retry and recovery. **Not verified on real Vercel/Render** — see `DEPLOYMENT.md`.

**S-05 — duplicate withdrawal.** *Files:* `services/withdrawalService.js`, `validators/index.js`, `frontend/.../Money.jsx`. The form now sends a
per-submission `idempotencyKey`; the existing unique `(initiated_by, idempotency_key)` index makes a replay (even a racing one) return the
original request. *Verification:* `hardening.test.js` — parallel identical submissions → one request, one hold; replay returns the same id.

**S-06 — email flooding.** *Files:* `services/authService.js`. One reset / verification email per address per 60 s window; responses stay
identical (no enumeration). *Verification:* five rapid requests → one email each; the owner can still reset.

## Verified controls (no defect found)

Each of these has an automated test unless noted.
- **Authorization / IDOR:** all customer routes resolve ids only together with the session's user id; cross-account access returns 404; admin APIs 403 for customers; full role×endpoint matrix; limited (MFA-pending) staff sessions reach nothing; staff cannot use customer APIs; privilege changes revoke sessions.
- **Mass assignment:** role/status/balance/verification fields in bodies are ignored (profile PATCH, registration, withdrawal).
- **Balances & integrity:** integer minor units; balances derived from append-only entries (DB triggers block UPDATE/DELETE); negative balances blocked by trigger; row locks; idempotency keys on transfers and adjustments; reversal via compensating entries; double-entry sums to zero; integrity checker reconciles running balances and sequence numbers.
- **Races:** 6 parallel transfers can't overdraw; parallel withdrawals can't hold more than available; two staff approving one request → exactly one decision; same-key adjustment raced three ways credits once.
- **Duplicate/failed money movement:** no success is returned for failed operations; failed API calls reject in the UI client (tested).
- **Authentication:** Argon2id; uniform responses and dummy hashing for unknown users; lockout after 5 failures; refresh rotation with reuse detection; JWT algorithm pinned, separate secrets, DB-backed sessions; TOTP replay protection and single-use recovery codes; MFA step-up for ledger credits/reversals/approvals; single-use hashed reset/verify tokens.
- **CSRF / CORS / headers:** double-submit token + Origin check + SameSite; CORS only echoes configured origins (preflight, `null` origin tested); CSP without `unsafe-eval`/inline, `frame-ancestors 'none'`, nosniff, permissions policy, HSTS in production; `no-store` on API responses.
- **Rate limiting:** enforced and tested with the limiter enabled (31st auth attempt → 429).
- **Injection / XSS:** all SQL parameterised (a `'; DROP TABLE` search string returns nothing and breaks nothing); no `dangerouslySetInnerHTML`/`eval`; emails HTML-escape every value; user content rendered as text.
- **Uploads:** content sniffing by magic bytes (SVG/HTML/exe rejected), size/count limits, private storage, authorised streaming with `nosniff`.
- **Errors/logging:** generic 500s with request id; log scrubbing of secret-named fields; startup errors never print values.
- **Dependencies:** `npm audit` — 0 vulnerabilities (backend and frontend, with and without dev dependencies).
- **Secrets in the browser:** `npm run build` scans the bundle for secret-shaped strings *and the literal values of every server secret found in the environment/`.env`*; negative test (a planted key) correctly fails the build.

## Integrations and transaction processing (what is real)

There is **no external payment, banking or card integration**. A "transaction" is a row plus ledger entries in the application's own
PostgreSQL ledger. `PaymentProvider`/`BankingProvider` are inert (`501 PROVIDER_NOT_CONFIGURED`); `LEDGER_MODE=live` is refused at startup. Withdrawals
create requests only, never ledger entries, and "approved" is an internal state. Beneficiary management does not exist in the product (transfers use
the recipient's account number each time). Resend, Supabase and WebAuthn are implemented but only partly exercised (see below).

## Unresolved risks and limitations

1. **Rotate the exposed credentials** (S-01).
2. Account lockout is a denial-of-service lever (5 failures lock a known email for 15 min). Accepted trade-off; consider per-IP + per-account CAPTCHA/step-up.
3. Registration reveals whether a *username* is taken; sign-in reveals that an account exists only after ≥ 5 failed attempts (HTTP 429).
4. Expired sessions, tokens and WebAuthn challenges are never purged (housekeeping job needed). `login_events` is append-only with `ON DELETE SET NULL`, so erasing a user needs a deliberate redaction design.
5. Database certificate verification requires `DB_SSL_CA` to be set (S-12).
6. Not tested against live Supabase writes, live Resend delivery, a real WebAuthn authenticator, or real Vercel/Render. `npm run test:pg` passes all assertions through the `pg` driver, but its socket test-shim reports a protocol error at process exit for some files (a shim artifact, not an application failure).
7. No automated accessibility audit or independent penetration test has been run.
8. The Terms/Privacy text is a draft and needs legal review.
