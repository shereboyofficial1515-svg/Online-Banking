-- Server-side "away" tracking and session locking. When a customer leaves the site for longer than the configured time, the
-- session becomes LOCKED on the server: every protected endpoint refuses it (403 SESSION_LOCKED) until the user proves who
-- they are again with their password (or a passkey). A stale access or refresh token therefore cannot bypass the lock.
-- Additive; safe on a live database.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS away_since timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS unlock_failures integer NOT NULL DEFAULT 0;
