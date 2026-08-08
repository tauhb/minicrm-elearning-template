-- 011_funnel_images_bucket.sql
-- Supabase Storage bucket for funnel block images (upload/paste fallback when user
-- doesn't provide external URL). Public read so images render in landing pages.
--
-- Guarded: `supabase db reset --local` starts with a bare Postgres schema before
-- Supabase's own bootstrap adds the storage tables. Skip the insert when
-- storage.buckets doesn't exist yet — the bucket gets created on the next apply
-- (production Supabase always has storage.buckets ready).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'funnel-images',
      'funnel-images',
      true,                          -- public read (any browser can display)
      10 * 1024 * 1024,              -- 10 MB per file
      ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSE
    RAISE NOTICE 'Skipping funnel-images bucket create — storage schema not ready yet.';
  END IF;
END $$;

-- Note: uploads happen via service_role key (bypasses RLS).
-- Public read works because bucket.public = true.
-- Path convention: funnel-images/{funnel_id}/{step_id}/{uuid}.{ext}
