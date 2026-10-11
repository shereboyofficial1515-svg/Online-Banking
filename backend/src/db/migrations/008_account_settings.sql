-- Customer account settings support: verified email change and the account-closure request workflow. Additive; safe on a live database.

-- Email change: the new address is only adopted after the customer enters a code sent to that address. The code is stored as a
-- keyed hash (never in clear), expires, and is limited to a few guesses.
CREATE TABLE IF NOT EXISTS email_change_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email   text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_change_user_idx ON email_change_requests (user_id, created_at DESC);

-- Account closure: the customer asks, staff complete or decline. Closing never deletes data: the account is marked closed and
-- its transaction history is kept (the transaction records are permanent).
CREATE TABLE IF NOT EXISTS account_closure_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  reason      text,
  status      text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','cancelled','completed','declined')),
  ticket_id   uuid REFERENCES support_tickets(id),
  staff_note  text,
  resolved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS account_closure_one_open ON account_closure_requests (account_id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS account_closure_user_idx ON account_closure_requests (user_id, created_at DESC);

ALTER TABLE email_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_closure_requests ENABLE ROW LEVEL SECURITY;
