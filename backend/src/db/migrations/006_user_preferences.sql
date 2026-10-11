-- Per-customer display, accessibility, language and regional preferences. One row per user.
-- These only change how information is PRESENTED. They never alter stored values: timestamps stay timestamptz (UTC)
-- and money stays integer minor units in the account's own currency.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme           text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  language        text NOT NULL DEFAULT 'en' CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  text_size       text NOT NULL DEFAULT 'default' CHECK (text_size IN ('small','default','large','xlarge')),
  motion          text NOT NULL DEFAULT 'system' CHECK (motion IN ('system','reduce')),
  contrast        text NOT NULL DEFAULT 'standard' CHECK (contrast IN ('standard','high')),
  timezone        text,                                   -- IANA name; NULL = use the browser's timezone
  date_format     text NOT NULL DEFAULT 'system' CHECK (date_format IN ('system','mdy','dmy','ymd')),
  time_format     text NOT NULL DEFAULT 'system' CHECK (time_format IN ('system','12h','24h')),
  number_format   text NOT NULL DEFAULT 'system' CHECK (number_format IN ('system','en-US','en-GB','de-DE','fr-FR','en-IN')),
  currency_display text NOT NULL DEFAULT 'symbol' CHECK (currency_display IN ('symbol','code')),
  dashboard       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
