-- 007_copy_formulas_and_content.sql
-- Content-first workflow:
--   1. copy_formulas          — 6 built-in + user-added formulas (PAS/AIDA/BAB/4Ps/QUEST/Star-Story)
--   2. funnel_flows.custom_prompt — per-funnel override for AI system prompt
--   3. funnel_steps content-first fields (copy_draft, copy_approved, etc)
--   4. funnel_step_copy_versions — undo history (last 5 per step)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. copy_formulas
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS copy_formulas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,             -- 'pas' | 'aida' | 'bab' | ...
  name TEXT NOT NULL,                    -- 'PAS — Problem, Agitate, Solution'
  description TEXT,                      -- Ngắn, hiện trong dropdown
  system_prompt TEXT NOT NULL,           -- Instruction cho AI structure content theo formula
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copy_formulas_key ON copy_formulas(key);
CREATE INDEX IF NOT EXISTS idx_copy_formulas_active ON copy_formulas(is_active);

ALTER TABLE copy_formulas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "copy_formulas_admin_all" ON copy_formulas
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "copy_formulas_public_read" ON copy_formulas
  FOR SELECT USING (is_active = true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Custom prompt override at funnel level
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE funnel_flows
  ADD COLUMN IF NOT EXISTS custom_prompt TEXT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Content-first fields on funnel_steps
-- ═══════════════════════════════════════════════════════════════════════════
-- content_source enum: expand to allow 'ai_draft' (2-step) vs 'ai_direct' (1-step)
-- Existing values: 'ai' | 'imported' | 'blank' — migrate 'ai' → 'ai_direct'
ALTER TABLE funnel_steps DROP CONSTRAINT IF EXISTS funnel_steps_content_source_check;
UPDATE funnel_steps SET content_source = 'ai_direct' WHERE content_source = 'ai';
ALTER TABLE funnel_steps
  ADD CONSTRAINT funnel_steps_content_source_check
  CHECK (content_source IN ('ai_draft', 'ai_direct', 'imported', 'blank'));

ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS copy_formula_key TEXT NULL,       -- FK-soft to copy_formulas.key
  ADD COLUMN IF NOT EXISTS copy_raw_input TEXT NULL,          -- User's raw description/paste
  ADD COLUMN IF NOT EXISTS copy_draft JSONB DEFAULT '{}'::jsonb,  -- {blocks:[{kind, content}]}
  ADD COLUMN IF NOT EXISTS copy_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS copy_approved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS html_generated_from_copy_at TIMESTAMPTZ NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Copy version history (undo/redo)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS funnel_step_copy_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id UUID NOT NULL REFERENCES funnel_steps(id) ON DELETE CASCADE,
  version_number INT NOT NULL,           -- Auto-incrementing per step
  copy_draft JSONB NOT NULL,
  copy_formula_key TEXT,
  copy_raw_input TEXT,
  generation_meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(step_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_step_copy_versions_step ON funnel_step_copy_versions(step_id, version_number DESC);

ALTER TABLE funnel_step_copy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "step_versions_admin_all" ON funnel_step_copy_versions
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));

-- Auto-prune to last 5 versions per step (trigger)
CREATE OR REPLACE FUNCTION prune_step_copy_versions() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM funnel_step_copy_versions
   WHERE step_id = NEW.step_id
     AND id NOT IN (
       SELECT id FROM funnel_step_copy_versions
        WHERE step_id = NEW.step_id
        ORDER BY version_number DESC
        LIMIT 5
     );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prune_step_copy_versions ON funnel_step_copy_versions;
CREATE TRIGGER trigger_prune_step_copy_versions
AFTER INSERT ON funnel_step_copy_versions
FOR EACH ROW EXECUTE FUNCTION prune_step_copy_versions();
