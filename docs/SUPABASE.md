# Supabase setup

The API talks to Supabase **PostgreSQL** with `node-postgres` using a server-side connection string, and to **Storage**
with the service-role key (server only). Authentication is the application's own (Argon2id + JWT cookies), not Supabase Auth.

1. **Create a project** (separate projects for staging and production).
2. **Connection string**: Project Settings → Database → *Connection string*. Use the pooler (transaction mode, port 6543)
   for the API → `DATABASE_URL`. Run migrations with the *direct/session* string if the pooler rejects multi-statement scripts.
3. **Migrations**: `cd backend && npm run migrate`. This applies
   * `001_schema.sql` – tables, immutability/append-only triggers, balance guards;
   * `002_rls.sql` – RLS enabled on **every** table. No client write policies exist; `anon` gets nothing; `authenticated`
     may only `SELECT` its own rows where `users.id = auth.uid()` (a no-op until Supabase Auth identities are linked);
   * `003_storage_buckets.sql` – private buckets `profile-photos`, `kyc-documents`, `support-attachments` (5 MB, image/PDF);
   * `004` – email verification codes;
   * `005_account_numbers.sql` – 12-digit `605…` account-number guard + `legacy_account_number` (no existing account is rewritten; see [ACCOUNT_NUMBERS.md](ACCOUNT_NUMBERS.md));
   * `006_user_preferences.sql` – per-customer display / accessibility / regional preferences;
   * `007_site_content.sql` – website versions, uploaded assets, legal documents + acceptances, immutability triggers and the private `site-assets` bucket (see [WEBSITE_CMS.md](WEBSITE_CMS.md));
   * `008_account_settings.sql` – verified email-change requests and the account-closure workflow;
   * `009_account_security_review.sql` – account-level "additional security review" marker used by the withdrawal workflow;
   * `010_session_lock.sql` – server-side away tracking and session lock (`away_since`, `locked_at`, `unlock_failures` on `sessions`).
4. **Keys**: `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — keep it in the server environment only. The frontend bundle
   contains no keys (verify with `grep -r service_role frontend/dist`). Rotate if it ever leaks.
5. **Network**: restrict database access to your API's egress IPs where possible; enable SSL (the driver does in
   production) and point-in-time recovery.
6. **Smoke test in staging**: `npm run migrate`, `npm run seed:admin`, register → verify email → approve account →
   ledger credit → withdrawal request; confirm rows in `audit_logs` and files in the private buckets.

Because the API role owns the tables it bypasses RLS by design; authorisation is enforced in the API (and mirrored by
the RLS "deny by default" posture for any direct PostgREST access).
