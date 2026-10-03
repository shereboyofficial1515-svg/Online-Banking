-- EWB Bank core schema.
-- Money is stored as BIGINT minor units (cents). Ledger entries and audit logs are append-only,
-- enforced by triggers so even a buggy or malicious application path cannot rewrite history.

-- gen_random_uuid() is built into PostgreSQL 13+, no extension required.

-- ───────────────────────── users & authentication ─────────────────────────
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  username           text,
  password_hash      text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  phone              text,
  phone_verified_at  timestamptz,
  date_of_birth      date,
  address_line1      text,
  city               text,
  state              text,
  postal_code        text,
  country            text,
  role               text NOT NULL DEFAULT 'customer'
                     CHECK (role IN ('customer','super_admin','compliance_admin','support_agent','finance_operator','security_admin')),
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','suspended','locked','rejected')),
  email_verified_at  timestamptz,
  verification_status text NOT NULL DEFAULT 'not_started'
                     CHECK (verification_status IN ('not_started','pending','verification_required','verified','failed','expired','manual_review')),
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  mfa_enabled        boolean NOT NULL DEFAULT false,
  mfa_secret_enc     text,
  mfa_pending_secret_enc text,
  mfa_last_step      bigint NOT NULL DEFAULT 0,   -- last accepted TOTP time-step (blocks code replay)
  profile_photo_path text,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_username_uq ON users (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE mfa_recovery_codes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_user_idx ON mfa_recovery_codes (user_id);

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_key    text NOT NULL,            -- sha256 of the opaque device cookie
  label         text NOT NULL,
  user_agent    text,
  last_ip       text,
  trusted_until timestamptz,
  removed_at    timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_key)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     uuid REFERENCES devices(id) ON DELETE SET NULL,
  refresh_hash  text NOT NULL,
  auth_method   text NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password','password_mfa','passkey')),
  mfa_verified_at timestamptz,
  limited       boolean NOT NULL DEFAULT false,   -- true => only MFA enrolment endpoints usable
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,             -- absolute lifetime
  idle_expires_at timestamptz NOT NULL,           -- sliding window, advanced by refresh
  revoked_at    timestamptz,
  revoked_reason text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('email_verification','password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    text NOT NULL,                    -- base64url COSE public key; no biometric data ever
  counter       bigint NOT NULL DEFAULT 0,
  transports    jsonb NOT NULL DEFAULT '[]',
  device_type   text,
  backed_up     boolean NOT NULL DEFAULT false,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys (user_id);

CREATE TABLE webauthn_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('register','authenticate')),
  challenge  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  identifier text,
  success    boolean NOT NULL,
  method     text NOT NULL,
  reason     text,
  ip         text,
  user_agent text,
  device_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_events_user_idx ON login_events (user_id, created_at DESC);

-- ───────────────────────── accounts, transactions, ledger ─────────────────────────
CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id),
  kind           text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','system')),
  account_number text NOT NULL UNIQUE,
  type           text NOT NULL DEFAULT 'checking' CHECK (type IN ('checking','savings','system')),
  name           text NOT NULL,
  currency       char(3) NOT NULL,
  status         text NOT NULL DEFAULT 'pending_review'
                 CHECK (status IN ('pending_review','active','suspended','locked','closed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'customer' AND user_id IS NOT NULL) OR (kind = 'system' AND user_id IS NULL))
);
CREATE INDEX accounts_user_idx ON accounts (user_id);

CREATE TABLE transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL UNIQUE,
  type          text NOT NULL CHECK (type IN ('ledger_credit','ledger_debit','transfer','withdrawal','reversal')),
  status        text NOT NULL CHECK (status IN ('pending','completed','failed','reversed','blocked','cancelled')),
  amount        bigint NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL,
  account_id    uuid NOT NULL REFERENCES accounts(id),
  counterparty_account_id uuid REFERENCES accounts(id),
  initiated_by  uuid NOT NULL REFERENCES users(id),
  description   text,
  reason        text,
  idempotency_key text,
  reverses_transaction_id uuid REFERENCES transactions(id),
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE UNIQUE INDEX transactions_idem_uq ON transactions (initiated_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX transactions_one_reversal_uq ON transactions (reverses_transaction_id) WHERE reverses_transaction_id IS NOT NULL;
CREATE INDEX transactions_account_idx ON transactions (account_id, created_at DESC);

CREATE TABLE ledger_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id),
  transaction_id uuid NOT NULL REFERENCES transactions(id),
  seq            bigint NOT NULL,                 -- gapless per-account sequence
  entry_type     text NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('credit','debit')),
  amount         bigint NOT NULL CHECK (amount > 0),
  currency       char(3) NOT NULL,
  balance_after  bigint NOT NULL,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq)
);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries (transaction_id);

-- Immutability: ledger rows can never be updated or deleted.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted: append-only table', TG_OP, TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Customer accounts may never go negative (system funding accounts are contra accounts and may).
CREATE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acct accounts%ROWTYPE;
BEGIN
  SELECT * INTO acct FROM accounts WHERE id = NEW.account_id;
  IF acct.currency <> NEW.currency THEN
    RAISE EXCEPTION 'currency mismatch on ledger entry';
  END IF;
  IF acct.kind = 'customer' AND NEW.balance_after < 0 THEN
    RAISE EXCEPTION 'insufficient funds' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entries_guard BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();

-- Transactions: financial facts are frozen; only status may advance along allowed transitions.
CREATE FUNCTION transactions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on transactions is not permitted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.reference <> OLD.reference OR NEW.type <> OLD.type OR NEW.amount <> OLD.amount
     OR NEW.currency <> OLD.currency OR NEW.account_id <> OLD.account_id
     OR NEW.initiated_by <> OLD.initiated_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'transaction financial fields are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'pending'   AND NEW.status IN ('completed','failed','blocked','cancelled'))
    OR (OLD.status = 'blocked'   AND NEW.status IN ('pending','cancelled'))
    OR (OLD.status = 'completed' AND NEW.status = 'reversed')) THEN
    RAISE EXCEPTION 'illegal transaction status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transactions_guard_trg BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_guard();

-- ───────────────────────── withdrawals ─────────────────────────
CREATE TABLE withdrawal_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users(id),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  transaction_id uuid REFERENCES transactions(id),
  amount        bigint NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL,
  -- Only the minimum needed to identify the destination. Full external account numbers are never stored.
  destination_bank_name text NOT NULL,
  destination_account_name text NOT NULL,
  destination_last4 char(4) NOT NULL,
  user_note     text,
  status        text NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested','under_review','additional_verification_required','customer_support_required','approved','rejected','cancelled')),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  decision_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX withdrawals_user_idx ON withdrawal_requests (user_id, created_at DESC);
CREATE INDEX withdrawals_status_idx ON withdrawal_requests (status);

CREATE TABLE withdrawal_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid NOT NULL REFERENCES withdrawal_requests(id) ON DELETE CASCADE,
  admin_id      uuid NOT NULL REFERENCES users(id),
  note          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── identity verification ─────────────────────────
CREATE TABLE identity_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_session_id text,
  status              text NOT NULL CHECK (status IN ('pending','verification_required','verified','failed','expired','manual_review')),
  reviewed_by         uuid REFERENCES users(id),
  review_reason       text,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idv_user_idx ON identity_verifications (user_id, created_at DESC);
CREATE UNIQUE INDEX idv_provider_session_uq ON identity_verifications (provider, provider_session_id) WHERE provider_session_id IS NOT NULL;

CREATE TABLE verification_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES identity_verifications(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('id_front','id_back','selfie','proof_of_address')),
  storage_path    text NOT NULL,
  mime            text NOT NULL,
  size_bytes      integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── notifications ─────────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category IN ('security','account','verification','transaction','withdrawal','support','system')),
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_preferences (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('security','account','verification','transaction','withdrawal','support','system')),
  in_app   boolean NOT NULL DEFAULT true,
  email    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, category)
);

-- ───────────────────────── support ─────────────────────────
CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference   text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users(id),
  category    text NOT NULL CHECK (category IN ('account','transactions','withdrawals','verification','security','technical','other')),
  subject     text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_for_customer','resolved','closed')),
  assigned_to uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_user_idx ON support_tickets (user_id, updated_at DESC);

CREATE TABLE support_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  author_type text NOT NULL CHECK (author_type IN ('customer','staff')),
  body       text NOT NULL,
  internal   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, created_at);

CREATE TABLE support_attachments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  filename   text NOT NULL,
  mime       text NOT NULL,
  size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── security events & audit ─────────────────────────
CREATE TABLE security_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  type        text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('info','low','medium','high')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  summary     text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  ip          text,
  session_id  uuid,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_status_idx ON security_events (status, created_at DESC);
CREATE INDEX security_events_user_idx ON security_events (user_id, created_at DESC);

CREATE TABLE audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid REFERENCES users(id),
  actor_role    text,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  account_id    uuid,
  previous_state jsonb,
  new_state     jsonb,
  reason        text,
  ip            text,
  user_agent    text,
  session_id    uuid,
  device_id     uuid,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_account_idx ON audit_logs (account_id);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER login_events_append_only BEFORE UPDATE OR DELETE ON login_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ───────────────────────── email outbox ─────────────────────────
CREATE TABLE email_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  to_email   text NOT NULL,
  template   text NOT NULL,
  subject    text NOT NULL,
  status     text NOT NULL CHECK (status IN ('sent','failed','logged_only')),
  provider   text NOT NULL,
  provider_message_id text,
  error      text,
  body_html  text,           -- populated only by the console provider (dev/test), never in production
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Balance helpers: balances are ALWAYS derived from ledger entries.
CREATE VIEW account_balances AS
SELECT a.id AS account_id,
       COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount ELSE -e.amount END), 0)::bigint AS ledger_balance
FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
GROUP BY a.id;
