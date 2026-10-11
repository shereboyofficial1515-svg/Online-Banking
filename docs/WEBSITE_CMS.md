# Website content, branding and legal documents (admin-editable)

## What an administrator can change
**Admin → Website** (permission `site.manage`, Super Admin by default):

| Area | Fields |
| --- | --- |
| Branding | website name, logo text, short description, logo for light backgrounds, logo for dark backgrounds, favicon, primary / secondary / accent colours |
| Homepage | hero eyebrow, headline, description, two buttons (label + link), hero background image + description, protection summary rows, about section, services, security points, digital-banking cards, FAQ, contact section |
| About & contact | About page (title, intro, body), contact email / phone / address / opening hours |
| Footer & social | footer text, up to six social links |

**Admin → Legal documents** (`legal.edit` to draft, `legal.publish` to publish/restore; Compliance Admins can draft, only Super Admin can publish): Terms of Service, Privacy Policy, Cookie Policy, Security Policy, Accessibility Statement.

## How it works
* **Draft → preview → publish.** Edits are saved to one draft. Visitors only ever see the published version. *Preview* renders the draft with the real page components without touching the live site.
* **Versions.** Publishing creates a new numbered, immutable version; the previous one is archived and stays readable. *Restore* copies an old version into the draft; it never edits history and never goes live by itself. Database triggers reject UPDATE/DELETE of published versions.
* **Failure-safe public site.** `GET /api/public/site` validates the stored configuration on every read. If it is missing, unreadable or invalid it serves the built-in defaults (also shipped in the frontend bundle and cached in the browser), so a bad edit or a database problem cannot blank the website.
* **Validation (server-side).** Text length limits; no HTML tags; control characters refused; hex colours only; link destinations must be an in-site path or `https://` (no `javascript:`, `data:` or protocol-relative URLs); icons chosen from a fixed list; image ids must exist and match their purpose. Colours are refused if white text on the primary/accent colour (or the secondary colour on white) falls below WCAG contrast (4.5:1 / 3:1).
* **Images.** Uploaded to the private `site-assets` storage bucket (migration `007`; set `SUPABASE_BUCKET_SITE` to change the name) and served through `GET /api/public/assets/:id`, only while the *published* configuration references them (admins preview drafts through `/api/admin/site/assets/:id`). The format and dimensions are read from the file's bytes (a renamed SVG/HTML/script file is rejected), with per-kind size/dimension limits (hero ≤ 5 MB and ≥ 1200 px wide; logos ≤ 2 MB; favicon ≤ 512 KB). Responses carry `nosniff`, a locked-down CSP and `Cross-Origin-Resource-Policy: cross-origin`.
* **Audit.** Draft saves, discards, publishes, restores and uploads are written to the append-only audit log with the actor, IP and the sections changed.
* **Legal publishing needs MFA step-up** (a fresh authenticator code) for both publish and restore.
* **Legal text is plain restricted Markdown** (`##` headings, lists, `**bold**`, `*italic*`, links). Raw HTML is refused by the API and, as a second layer, the viewer renders only React elements (never `innerHTML`) and re-checks every link target.
* **Acceptances.** Registration requires `acceptedTerms: true` and records one append-only row per document in `legal_acceptances`, pointing at the exact version accepted. Publishing a new version never alters these rows (a trigger forbids UPDATE/DELETE). Customers can see what they accepted under Settings → About & legal.
* **Built-in text.** The default documents are seeded as version 1 and flagged **"Not legally reviewed"** in the admin console. They are drafts prepared for the business, not legal advice; have your own counsel review and publish final text.

## Hero image
See [HERO_IMAGE.md](HERO_IMAGE.md) for the bundled photograph's source and licence.

## Migrations
`007_site_content.sql` (tables, immutability triggers, RLS, private bucket) and `006_user_preferences.sql`. Both are additive.
