-- 010_per_block_html.sql
-- Per-block HTML storage (enables regenerate-section + outline→HTML text sync)
-- + render_instructions field (user extra requirements before generating HTML)

ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS html_blocks JSONB DEFAULT '[]'::jsonb,
  -- Array of { kind, content_snapshot, html, generated_at, error?, is_stale? }
  -- content_snapshot = block content at time of render (used to detect outline drift)
  ADD COLUMN IF NOT EXISTS render_instructions TEXT NULL;
  -- Extra user constraints appended to HTML render system prompt

-- Enable jsonb ops without index for now
