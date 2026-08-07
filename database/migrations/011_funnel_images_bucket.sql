-- 011_funnel_images_bucket.sql
-- Supabase Storage bucket for funnel block images (upload/paste fallback when user
-- doesn't provide external URL). Public read so images render in landing pages.

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

-- Note: uploads happen via service_role key (bypasses RLS).
-- Public read works because bucket.public = true.
-- Path convention: funnel-images/{funnel_id}/{step_id}/{uuid}.{ext}
