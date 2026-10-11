-- Six-digit session PIN (unlocks an already signed-in session; it never signs anyone in), inactivity tracking for the session lock,
-- and a per-user switch for passkey/biometric unlock. The PIN is stored only as an Argon2id hash of an HMAC of the PIN keyed with a
-- server secret, so a database copy alone is not enough to test PIN guesses. Additive; safe on a live database.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_pin_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_pin_set_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlock_passkey_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS activity_at timestamptz NOT NULL DEFAULT now();
