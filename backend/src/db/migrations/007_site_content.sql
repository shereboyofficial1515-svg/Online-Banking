-- Admin-managed website content: branding, homepage/about/contact content, uploaded assets, and legal documents.
-- Design rules:
--  * Draft / publish: edits are saved to a single DRAFT; publishing creates a new immutable numbered version. The public site
--    only ever reads the published version, so a half-finished edit can never break or alter the live website.
--  * Published versions can never be edited or deleted (triggers). Older versions are archived, stay readable, and can be
--    restored (restoring copies one into a new draft; it does not rewrite history).
--  * Customers' acceptance of legal documents is append-only and points at the exact version they accepted.
-- Additive; safe on a live database.

CREATE TABLE IF NOT EXISTS site_config_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      integer,                                   -- NULL while a draft; assigned at publish
  status       text NOT NULL CHECK (status IN ('draft','published','archived')),
  config       jsonb NOT NULL,
  note         text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users(id),
  published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS site_config_one_draft ON site_config_versions ((true)) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS site_config_one_published ON site_config_versions ((true)) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS site_config_version_uq ON site_config_versions (version) WHERE version IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('logo_light','logo_dark','favicon','hero')),
  filename     text NOT NULL,
  mime         text NOT NULL,
  size_bytes   integer NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  storage_path text NOT NULL,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_document_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{1,40}$'),
  version        integer,                                  -- NULL while a draft
  status         text NOT NULL CHECK (status IN ('draft','published','archived')),
  title          text NOT NULL,
  body           text NOT NULL,                            -- restricted Markdown (no raw HTML); rendered without innerHTML
  effective_date date NOT NULL,
  change_note    text,
  needs_review   boolean NOT NULL DEFAULT false,           -- true for built-in default text that legal counsel has not confirmed
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES users(id),
  published_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_one_draft ON legal_document_versions (slug) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS legal_one_published ON legal_document_versions (slug) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS legal_version_uq ON legal_document_versions (slug, version) WHERE version IS NOT NULL;

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  slug        text NOT NULL,
  version_id  uuid NOT NULL REFERENCES legal_document_versions(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, slug);

-- Immutability. Published/archived versions are frozen except for the published -> archived transition.
CREATE OR REPLACE FUNCTION frozen_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'published versions cannot be deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('published','archived') THEN
    IF NOT (OLD.status = 'published' AND NEW.status = 'archived')
       OR NEW.version IS DISTINCT FROM OLD.version OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'published versions are immutable' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF to_jsonb(NEW) - ARRAY['status','updated_at'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status','updated_at'] THEN
      RAISE EXCEPTION 'published versions are immutable' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS site_config_frozen_trg ON site_config_versions;
CREATE TRIGGER site_config_frozen_trg BEFORE UPDATE OR DELETE ON site_config_versions FOR EACH ROW EXECUTE FUNCTION frozen_versions_guard();
DROP TRIGGER IF EXISTS legal_versions_frozen_trg ON legal_document_versions;
CREATE TRIGGER legal_versions_frozen_trg BEFORE UPDATE OR DELETE ON legal_document_versions FOR EACH ROW EXECUTE FUNCTION frozen_versions_guard();
DROP TRIGGER IF EXISTS legal_acceptances_append_only ON legal_acceptances;
CREATE TRIGGER legal_acceptances_append_only BEFORE UPDATE OR DELETE ON legal_acceptances FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS site_assets_append_only ON site_assets;
CREATE TRIGGER site_assets_append_only BEFORE UPDATE OR DELETE ON site_assets FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE site_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;

-- Private Supabase Storage bucket for uploaded brand assets (served to visitors through the API, never directly).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('site-assets', 'site-assets', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/x-icon','image/vnd.microsoft.icon'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
