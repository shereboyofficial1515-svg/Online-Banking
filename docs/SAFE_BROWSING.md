# Chrome "dangerous site" warning — investigation (Engineering Task 03)

Checked on 2026-10-11. Nothing here claims to know Google's current classification: the only Safe Browsing source I could reach was an **unofficial** Transparency Report endpoint, and its result is described below.

> **Update (2026-10-11):** a screenshot from the owner's phone shows the EWB Bank site open at `banking-rust.vercel.app`, while every request I made from here to that host returned the Next.js "Boomine" app below. I cannot reconcile the two from here. Likely explanations: the Vercel project's production deployment was switched between the two apps, or different deployments/aliases answer differently. **Check Vercel (Project → Deployments/Domains) to see which deployment `banking-rust.vercel.app` points at.** The Safe Browsing findings below apply to whatever that host serves; if it served the Next.js app that asks for SSNs when the warning was recorded, that alone can explain it.

## 1. Which site shows the warning
The screenshot domain is `banking-rust.vercel.app`. **That is not the EWB Bank application.**

| Check | `banking-rust.vercel.app` | EWB Bank (this repository) |
| --- | --- | --- |
| Framework (response headers) | Next.js (`X-Powered-By: Next.js`, `/_next/static/…`) | Vite single-page app (no Next.js anywhere in the repo or its history) |
| `GET /` | 307 redirect to `/sign-in` | serves the EWB home page; there is no `/sign-in` route (`/login`) |
| Page title / brand | "Boomine", heading "Horizon" | "EWB Bank" |
| Sign-up form fields | First/last name, address, city, state, postal code, date of birth, **SSN**, email, password | name, contact details, date of birth, address, password (no SSN field anywhere in EWB) |
| Security headers | none of CSP / X-Frame-Options / nosniff set | strict CSP, `frame-ancestors 'none'`, nosniff, HSTS, permissions policy (`frontend/vercel.json`) |
| `robots.txt`, `security.txt` | both 404 | n/a |

It looks like a separate "banking app" project (the common Next.js "Horizon" template) deployed to a free shared `*.vercel.app` subdomain. Whoever owns that Vercel project is the party Google is warning about. If the project owner did deploy it, it is a different Vercel project from EWB Bank. The EWB repository's own production domain is not recorded anywhere in the repo (`DEPLOYMENT.md` uses `YOUR-SITE.vercel.app`), so **the real EWB domain still needs to be confirmed by the owner** and re-checked (section 4).

## 2. Likely root cause of the warning
Evidence-based inference, not a confirmed Google statement: Safe Browsing's "deceptive site / phishing" classification is heuristic. The flagged page matches the pattern it targets: a bank-branded credential page on a free, anonymous, shared subdomain that asks for an SSN, date of birth and password, with no custom domain or verifiable ownership. A new `vercel.app` project like this is flagged for the page itself, not because of any compromise. `vercel.app` as a whole is **not** flagged (see 3).

## 3. Evidence collected
* **HTTP/redirect inspection** of `banking-rust.vercel.app`: HSTS present; `/` → `/sign-in`; `/login` 404; no unexpected cross-domain redirects.
* **Safe Browsing status (unofficial, undocumented endpoint)** `transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=…` returned a row with all flags `false` for `banking-rust.vercel.app`, `ewb-bank.onrender.com` and `vercel.app`, and a "last scanned" value of `0` for the first two. I cannot say what that means for Chrome's live warning, which can use data (and local heuristics) that this report does not show. **I did not confirm either that Google currently flags or that it has cleared any of these domains.** Check the official page yourself: <https://transparencyreport.google.com/safe-browsing/search> for the domain.
* **EWB Bank code review (this repository)**
  * Built bundle contains two same-origin scripts only (`/theme-init.js`, `/assets/index-*.js`); no third-party scripts, fonts, analytics, iframes or CDN loads. The CSP (`script-src 'self'`) would block any injected external script.
  * No `eval`, `new Function`, `document.write`, `innerHTML` or `dangerouslySetInnerHTML` in application code. Legal/About text is rendered as React elements.
  * Dependencies: 5 runtime packages (`react`, `react-dom`, `react-router-dom`, `gsap`, `@simplewebauthn/browser`); `npm audit` reports 0 vulnerabilities in frontend and backend; lockfiles are committed; the git history shows a single author and no unexpected commits.
  * Redirects/rewrites (`frontend/vercel.json`): only `/api/*` → the Render API and a SPA fallback; no open redirects.
  * Authentication pages are served over HTTPS (HSTS, `upgrade-insecure-requests`); passwords are only ever posted to same-origin `/api/auth/*`; cookies are `HttpOnly`/`Secure`.
  * Secrets: the production build runs a secret scan of the bundle (passes); `.env` is git-ignored.
  * The API host (`ewb-bank.onrender.com`) answers health checks normally with the same security headers.

## 4. What to do
1. **Confirm which domain EWB Bank is actually deployed on** (Vercel dashboard → the project built from the `Online-Banking` repository → Domains). If users are being sent to `banking-rust.vercel.app`, they are seeing a different project: update any links, messages and bookmarks to the correct URL.
2. If `banking-rust.vercel.app` is also yours and is a real project, either delete that deployment, or treat it as a production banking site: add a **custom domain you own**, add the security headers EWB uses, and remove the SSN collection unless you are legally required to collect it and handle it properly. A demo should not ask for a real SSN.
3. Move EWB Bank to a **custom domain** (e.g. `app.<your-domain>`), not a bare `*.vercel.app` URL. It lets you verify ownership in Google Search Console, and a domain with its own reputation is far less likely to be swept up by heuristics about shared subdomains.
4. **Requesting a review (official process; no outcome is guaranteed and Google gives no time commitment):**
   * If you own a verified domain: Google Search Console → *Security & Manual Actions → Security issues* → fix, then **Request review**.
   * For a page you believe is wrongly flagged as phishing: <https://safebrowsing.google.com/safebrowsing/report_error/> ("Report incorrect phishing warning"), or the **Learn more / "This isn't a dangerous site"** link on the warning page itself.
   * You cannot verify `*.vercel.app` in Search Console (you do not own `vercel.app`), which is another reason to use a custom domain.
   * If the warning concerns the shared platform rather than the page, report it to Vercel through <https://vercel.com/help> (abuse/trust & safety).
5. **Do not** hide the warning with cloaking, redirects or any trick; none were added.

## 5. Status
| Item | Status |
| --- | --- |
| Is the flagged domain the EWB Bank app? | **No** (different framework, brand and form fields) |
| Suspicious code, redirects, scripts or compromised dependencies in EWB Bank | **None found** |
| Exposed secrets in the EWB bundle | None found |
| Google's current classification of any domain | **Not verified** (only an unofficial endpoint was reachable) |
| Safe Browsing review | **Not requested** — needs the domain owner's Google/Search Console access |
| EWB production domain | **Unknown to me** — owner to confirm |

## Update: domain status finding
* `eastwesthub.site` currently does not resolve (NXDOMAIN). RDAP shows the registry status `server hold` (registered 2026-10-11 via Hostinger). The cause of the hold is **unconfirmed**; contact the registrar. A browser warning cannot be assessed while the site is unreachable.
* Source, headers, cookies, CORS, bundle and source maps were reviewed: no secrets, no source maps, no third-party scripts, no cloaking or redirects. The bundle secret scan runs on every build.
* Google's classification was **not** independently verified. Once the domain resolves, check Search Console (Security issues) and request a review there; do not claim the warning is cleared until Google shows it so.
* `vercel.json` rewrites `/api` to the API domain, which is unreachable until DNS works.
