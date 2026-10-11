-- 1) Normalised phone numbers. `phone_e164` holds the number in E.164 form (e.g. +2348031234567). It is NULL for customers who
--    registered before phone numbers were mandatory (their original text stays in `phone`; nothing is invented), and the app asks
--    them to add one. A partial unique index enforces "one phone number per profile" for every number that is on file.
-- 2) `app_settings`: small database-backed switches that management can change without a redeploy (the savings feature starts
--    DISABLED because no row exists).
-- Additive; safe on a live database.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_e164_format;
ALTER TABLE users ADD CONSTRAINT users_phone_e164_format CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$');
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_e164_uq ON users (phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
