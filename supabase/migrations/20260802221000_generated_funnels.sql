-- 005_generated_funnels.sql
-- AI-generated landing pages (in-portal, rendered at /f/:slug).
-- Different from existing `funnels` table (which is a registry of external funnels).

CREATE TABLE IF NOT EXISTS generated_funnels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,        -- URL-friendly, e.g. "khoa-ai-marketing"
  name TEXT NOT NULL,                -- Human name
  type TEXT NOT NULL DEFAULT 'sales' CHECK (type IN ('sales', 'leads', 'webinar')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),

  -- Copy input from user (offer, pain, USP, testimonials, pricing, CTA, ...)
  copy_input JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Generated output
  html TEXT,                         -- Full HTML (rendered at /f/:slug)
  generation_meta JSONB DEFAULT '{}'::jsonb,  -- provider, model, tokens used, generated_at

  -- Iteration history (past prompts + versions kept for undo)
  iteration_history JSONB DEFAULT '[]'::jsonb,

  -- Custom domain (optional — CNAME set by user externally)
  custom_domain TEXT,

  -- Tracking counters (denormalized for speed)
  visits INT NOT NULL DEFAULT 0,
  cta_clicks INT NOT NULL DEFAULT 0,
  form_submits INT NOT NULL DEFAULT 0,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_generated_funnels_slug ON generated_funnels(slug);
CREATE INDEX IF NOT EXISTS idx_generated_funnels_status ON generated_funnels(status);
CREATE INDEX IF NOT EXISTS idx_generated_funnels_type ON generated_funnels(type);

-- Tracking events (raw, aggregated into counters)
CREATE TABLE IF NOT EXISTS generated_funnel_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id UUID NOT NULL REFERENCES generated_funnels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('visit', 'cta_click', 'form_submit')),
  visitor_id TEXT,                   -- Hashed cookie/IP for basic dedup
  user_agent TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gen_funnel_events_funnel ON generated_funnel_events(funnel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_funnel_events_type ON generated_funnel_events(event_type);

-- RLS
ALTER TABLE generated_funnels ENABLE ROW LEVEL SECURITY;

-- Public read for published funnels only (via slug — no listing)
CREATE POLICY "public_read_published" ON generated_funnels
  FOR SELECT USING (status = 'published');

-- Admin full access
CREATE POLICY "admin_full_access_funnels" ON generated_funnels
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE generated_funnel_events ENABLE ROW LEVEL SECURITY;

-- Anyone can insert events (public tracking)
CREATE POLICY "public_insert_events" ON generated_funnel_events
  FOR INSERT WITH CHECK (true);

-- Admin can read events
CREATE POLICY "admin_read_events" ON generated_funnel_events
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );
