-- 008_tags_and_polish.sql
-- Replace auto_nurture with tags system. Prep for future Workflow feature.

-- Drop auto_nurture (replaced by tags → Workflow)
ALTER TABLE funnel_flows DROP COLUMN IF EXISTS auto_nurture;

-- Tags applied to leads created from this funnel
ALTER TABLE funnel_flows
  ADD COLUMN IF NOT EXISTS tags_to_apply TEXT[] DEFAULT '{}';

-- Optional per-step tags (merge with flow-level tags)
ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS additional_tags TEXT[] DEFAULT '{}';

-- Ensure UNIQUE(funnel_id, step_number) is deferrable so we can reorder without conflicts
-- (Postgres UNIQUE by default is immediate — we'll use a swap-via-temp-negative pattern in reorder API)
