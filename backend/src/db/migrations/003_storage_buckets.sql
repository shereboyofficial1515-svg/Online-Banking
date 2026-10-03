-- Supabase Storage buckets (private). Only runs where Supabase's `storage` schema exists; a no-op on plain Postgres.
-- Files are written/read exclusively by the API with the service-role key and streamed to authorised users;
-- there are no storage policies for anon/authenticated, so direct access through Supabase is denied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('profile-photos',      'profile-photos',      false, 5242880, ARRAY['image/jpeg','image/png','image/webp']),
      ('kyc-documents',       'kyc-documents',       false, 5242880, ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
      ('support-attachments', 'support-attachments', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
