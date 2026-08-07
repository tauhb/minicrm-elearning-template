-- 006_funnel_multistep.sql
-- Multi-step funnel architecture:
--   funnel_types      — types user can create/edit (sales, leads, custom)
--   funnel_flows      — 1 funnel = container for N steps
--   funnel_steps      — each page in the flow (landing, order, upsell, thank-you...)
--   funnel_form_submissions — leads captured from any form step
--
-- Deprecates the older generated_funnels / generated_funnel_events tables.

-- ── 1. Drop old MVP tables (were never used in production) ────────────────────
DROP TABLE IF EXISTS generated_funnel_events CASCADE;
DROP TABLE IF EXISTS generated_funnels CASCADE;

-- ── 2. funnel_types ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funnel_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,        -- 'sales' | 'leads' | user-created 'coaching-call'
  name TEXT NOT NULL,               -- Human name
  description TEXT,                 -- One-liner shown in dropdown
  icon TEXT DEFAULT 'zap',          -- Lucide icon name
  color TEXT DEFAULT '#B6FF00',     -- Tag color hex
  system_prompt TEXT,               -- Full markdown skill (editable)
  suggested_steps JSONB DEFAULT '[]'::jsonb,  -- [{name, page_type, has_form, form_fields?, hint}]
  is_builtin BOOLEAN NOT NULL DEFAULT false,  -- Ship-with-portal (can't delete)
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_types_key ON funnel_types(key);
CREATE INDEX IF NOT EXISTS idx_funnel_types_active ON funnel_types(is_active);

ALTER TABLE funnel_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funnel_types_admin_all" ON funnel_types
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "funnel_types_public_read" ON funnel_types
  FOR SELECT USING (is_active = true);

-- ── 3. funnel_flows (container) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funnel_flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,           -- 'khoa-ai-marketing'
  name TEXT NOT NULL,
  type_key TEXT NOT NULL,              -- refers to funnel_types.key (soft FK)
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),

  -- Global style (single source of truth for all steps)
  style_preset JSONB DEFAULT '{}'::jsonb,   -- {vibe, fontPair, layout, density, brandColor}

  -- Shared copy context (used across steps, edit once)
  shared_context JSONB DEFAULT '{}'::jsonb,  -- {productName, audience, painPoints, USP, ...}

  -- Per-funnel toggles (from user answers)
  payment_mode TEXT DEFAULT 'collect_only'
    CHECK (payment_mode IN ('collect_only', 'inline_qr', 'external_checkout')),
  auto_nurture BOOLEAN DEFAULT true,   -- fire email sequences on lead submit?

  custom_domain TEXT,                  -- Optional CNAME target

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_funnel_flows_slug ON funnel_flows(slug);
CREATE INDEX IF NOT EXISTS idx_funnel_flows_status ON funnel_flows(status);
CREATE INDEX IF NOT EXISTS idx_funnel_flows_type ON funnel_flows(type_key);

ALTER TABLE funnel_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funnel_flows_public_read" ON funnel_flows
  FOR SELECT USING (status = 'published');
CREATE POLICY "funnel_flows_admin_all" ON funnel_flows
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));

-- ── 4. funnel_steps (pages in the flow) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS funnel_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id UUID NOT NULL REFERENCES funnel_flows(id) ON DELETE CASCADE,
  step_number INT NOT NULL,             -- 1, 2, 3, ...
  slug TEXT NOT NULL,                    -- path in URL: 'landing', 'order', 'thank-you'
  name TEXT NOT NULL,                    -- Display: 'Sales Page', 'Order Form'
  page_type TEXT NOT NULL,               -- 'landing' | 'opt-in' | 'order' | 'upsell' | 'thank-you' | 'custom'

  -- Content source
  content_source TEXT NOT NULL DEFAULT 'ai' CHECK (content_source IN ('ai', 'imported', 'blank')),

  -- Form config
  has_form BOOLEAN NOT NULL DEFAULT false,
  form_mode TEXT DEFAULT 'inline' CHECK (form_mode IN ('inline', 'popup', 'none')),
  form_fields JSONB DEFAULT '[]'::jsonb,  -- [{name, label, type, required, placeholder}]
  form_success_step_slug TEXT,             -- Which step to redirect after submit
  form_success_url TEXT,                    -- Or external URL

  -- Copy inputs (step-specific)
  copy_input JSONB DEFAULT '{}'::jsonb,

  -- Rendered content
  html TEXT,                              -- Final HTML (from AI or import)
  generation_meta JSONB DEFAULT '{}'::jsonb,

  -- Import-specific: preserve original + config
  import_original_html TEXT,
  import_config JSONB DEFAULT '{}'::jsonb, -- {stripped_scripts, kept_scripts, form_action_overridden, ...}

  -- Tracking counters (denormalized)
  visits INT NOT NULL DEFAULT 0,
  cta_clicks INT NOT NULL DEFAULT 0,
  form_submits INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (funnel_id, step_number),
  UNIQUE (funnel_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_funnel_steps_funnel ON funnel_steps(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_steps_slug ON funnel_steps(funnel_id, slug);

ALTER TABLE funnel_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funnel_steps_public_read_via_published_funnel" ON funnel_steps
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM funnel_flows WHERE id = funnel_id AND status = 'published')
  );
CREATE POLICY "funnel_steps_admin_all" ON funnel_steps
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));

-- ── 5. Form submissions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funnel_form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id UUID NOT NULL REFERENCES funnel_flows(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES funnel_steps(id) ON DELETE CASCADE,
  data JSONB NOT NULL,                 -- All field values
  visitor_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,

  -- Auto-sync to CRM
  synced_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  synced_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_submissions_funnel ON funnel_form_submissions(funnel_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_submissions_step ON funnel_form_submissions(step_id);

ALTER TABLE funnel_form_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funnel_submissions_public_insert" ON funnel_form_submissions
  FOR INSERT WITH CHECK (true);
CREATE POLICY "funnel_submissions_admin_read" ON funnel_form_submissions
  FOR SELECT USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));

-- ── 6. Tracking events (per step) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funnel_step_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id UUID NOT NULL REFERENCES funnel_flows(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES funnel_steps(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('visit', 'cta_click', 'form_submit')),
  visitor_id TEXT,
  user_agent TEXT,
  referrer TEXT,
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_step_events_step ON funnel_step_events(step_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_step_events_type ON funnel_step_events(event_type);

ALTER TABLE funnel_step_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funnel_step_events_public_insert" ON funnel_step_events
  FOR INSERT WITH CHECK (true);
CREATE POLICY "funnel_step_events_admin_read" ON funnel_step_events
  FOR SELECT USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));
