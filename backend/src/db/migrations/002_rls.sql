-- Row Level Security.
-- The Express API connects with a privileged server-side role and enforces authorization itself.
-- RLS exists so that anyone reaching the database through Supabase's public PostgREST endpoint
-- with the anon/authenticated roles gets nothing by default, and may only read their own rows
-- where a policy explicitly allows it. users.id is expected to equal auth.uid() if Supabase Auth
-- identities are ever linked; until then these policies simply never match.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- Read-only "own record" policies. No client-side write policies exist at all:
    -- every mutation goes through the API, which owns the business rules.
    EXECUTE 'CREATE POLICY users_select_own ON users FOR SELECT TO authenticated USING (id = auth.uid())';
    EXECUTE 'CREATE POLICY accounts_select_own ON accounts FOR SELECT TO authenticated USING (user_id = auth.uid())';
    EXECUTE 'CREATE POLICY transactions_select_own ON transactions FOR SELECT TO authenticated
             USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))';
    EXECUTE 'CREATE POLICY ledger_select_own ON ledger_entries FOR SELECT TO authenticated
             USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))';
    EXECUTE 'CREATE POLICY withdrawals_select_own ON withdrawal_requests FOR SELECT TO authenticated USING (user_id = auth.uid())';
    EXECUTE 'CREATE POLICY notifications_select_own ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid())';
    EXECUTE 'CREATE POLICY tickets_select_own ON support_tickets FOR SELECT TO authenticated USING (user_id = auth.uid())';
    EXECUTE 'CREATE POLICY idv_select_own ON identity_verifications FOR SELECT TO authenticated USING (user_id = auth.uid())';

    -- Sensitive tables stay fully closed to anon/authenticated (RLS on, zero policies).
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON users, sessions, auth_tokens, passkeys, mfa_recovery_codes, audit_logs, email_outbox FROM authenticated';
    EXECUTE 'GRANT SELECT (id, first_name, last_name, email, status, verification_status, created_at) ON users TO authenticated';
  END IF;
END $$;
