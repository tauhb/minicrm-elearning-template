-- 012_page_meta_and_formula_filter.sql
-- 1. Page metadata (title, description) per step for SEO
-- 2. copy_formulas.page_type_filter — filter which formulas apply to which page_type

ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS page_title TEXT NULL,
  ADD COLUMN IF NOT EXISTS page_description TEXT NULL;

ALTER TABLE copy_formulas
  ADD COLUMN IF NOT EXISTS page_type_filter TEXT[] DEFAULT NULL;
-- NULL = áp dụng mọi page_type (backward compat)
-- Array = chỉ hiện khi step.page_type IN filter

-- Update existing 6 copywriting formulas to filter for landing/opt-in
UPDATE copy_formulas
   SET page_type_filter = ARRAY['landing', 'opt-in', 'custom']
 WHERE key IN ('pas', 'aida', 'bab', '4ps', 'quest', 'star-story-solution');
