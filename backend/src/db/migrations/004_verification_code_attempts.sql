-- Email verification now uses a short numeric code instead of a link. A 6-digit code is guessable, so each
-- code carries an attempt counter: after too many wrong guesses it is invalidated and a new one must be requested.
-- Additive and safe to run on a live database.
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
