-- 013_chat_system.sql
-- Chat feature (Chatwoot-inspired, integrated with existing leads/customers).
--
-- Design:
--   - chat_inboxes: channels (web_widget MVP; facebook/zalo later)
--   - chat_conversations: thread between contact (lead OR customer) + inbox + assignee agent
--   - chat_messages: messages (polymorphic sender: contact | agent | system | bot)
--   - chat_visitor_sessions: browser session tracking (for continuity before pre-chat form)
--
-- Contact resolution: leads-first (auto-create if new email; link customer_id if email matches customer).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. chat_inboxes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_inboxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,                     -- 'Website chat', 'Fanpage AI Marketing'
  channel_type TEXT NOT NULL DEFAULT 'web_widget'
    CHECK (channel_type IN ('web_widget', 'facebook', 'zalo', 'whatsapp', 'email', 'api')),
  channel_config JSONB DEFAULT '{}'::jsonb,
  -- For web_widget: {
  --   widget_color, welcome_title, welcome_tagline,
  --   pre_chat_form_enabled, pre_chat_form_fields: [{name, label, type, required}],
  --   allowed_domains: '*.example.com,another.com',
  --   position: 'bottom-right' | 'bottom-left'
  -- }
  website_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  hmac_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  greeting_enabled BOOLEAN NOT NULL DEFAULT true,
  greeting_message TEXT DEFAULT 'Xin chào! Chúng tôi có thể giúp gì?',
  working_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  working_hours JSONB DEFAULT '[]'::jsonb,
  out_of_office_message TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  auto_assign_to UUID REFERENCES customers(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_inboxes_website_token ON chat_inboxes(website_token);
CREATE INDEX IF NOT EXISTS idx_chat_inboxes_active ON chat_inboxes(is_active);

ALTER TABLE chat_inboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_inboxes_admin_all" ON chat_inboxes
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales')));
CREATE POLICY "chat_inboxes_public_read_config" ON chat_inboxes
  FOR SELECT USING (is_active = true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. chat_conversations
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SEQUENCE IF NOT EXISTS chat_conversations_display_id_seq START 1000;

CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id BIGINT NOT NULL DEFAULT nextval('chat_conversations_display_id_seq') UNIQUE,
  inbox_id UUID NOT NULL REFERENCES chat_inboxes(id) ON DELETE CASCADE,

  -- Polymorphic contact: exactly one of these should be non-null usually
  -- (both can be non-null after lead → customer conversion)
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Anonymous visitor tracking (before pre-chat form)
  visitor_session_id UUID,

  assignee_id UUID REFERENCES customers(id) ON DELETE SET NULL,   -- Agent (admin/sales)
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'snoozed', 'resolved')),
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  labels TEXT[] DEFAULT '{}',

  contact_last_seen_at TIMESTAMPTZ,
  agent_last_seen_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_reply_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,

  -- Source context (where the conversation started)
  source_url TEXT,                        -- Landing page URL
  source_funnel_id UUID REFERENCES funnel_flows(id) ON DELETE SET NULL,
  source_step_id UUID REFERENCES funnel_steps(id) ON DELETE SET NULL,
  utm JSONB DEFAULT '{}'::jsonb,
  additional_attributes JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_status ON chat_conversations(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conv_inbox ON chat_conversations(inbox_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_assignee ON chat_conversations(assignee_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_lead ON chat_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_customer ON chat_conversations(customer_id);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_conv_admin_all" ON chat_conversations
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales')));
-- Public read/insert handled via service_role in widget endpoints (no direct anon access)

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. chat_messages
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  content TEXT,
  content_type TEXT NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text', 'image', 'file', 'audio', 'video', 'system')),
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('contact', 'agent', 'system', 'bot')),
  sender_id UUID,   -- lead_id | customer_id | agent(customer) id | null for system
  private BOOLEAN NOT NULL DEFAULT false,  -- Internal note (only agents see)
  attachments JSONB DEFAULT '[]'::jsonb,   -- [{url, filename, size, mime}]
  read_by_contact_at TIMESTAMPTZ,
  read_by_agent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_msg_sender ON chat_messages(sender_type, sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_created ON chat_messages(created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_msg_admin_all" ON chat_messages
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales')));

-- Trigger: update conversation.last_activity_at + first_reply_at
CREATE OR REPLACE FUNCTION update_chat_conversation_on_message() RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations
     SET last_activity_at = NEW.created_at,
         first_reply_at = COALESCE(first_reply_at, CASE WHEN NEW.sender_type = 'agent' THEN NEW.created_at ELSE NULL END),
         updated_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_msg_update_conv ON chat_messages;
CREATE TRIGGER trg_chat_msg_update_conv
AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION update_chat_conversation_on_message();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. chat_visitor_sessions
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_visitor_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  inbox_id UUID NOT NULL REFERENCES chat_inboxes(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  visitor_meta JSONB DEFAULT '{}'::jsonb,
  -- {user_agent, ip_hash, first_seen_url, referrer, funnel_slug, step_slug, utm{}}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_visitor_session_token ON chat_visitor_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_chat_visitor_last_seen ON chat_visitor_sessions(last_seen_at DESC);

ALTER TABLE chat_visitor_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_visitor_admin_read" ON chat_visitor_sessions
  FOR SELECT USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales')));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. funnel_flows.chat_widget_id — per-funnel chat toggle
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE funnel_flows
  ADD COLUMN IF NOT EXISTS chat_widget_inbox_id UUID REFERENCES chat_inboxes(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Enable Supabase Realtime for chat_messages + chat_conversations
--    (client-side subscriptions in admin UI)
-- ═══════════════════════════════════════════════════════════════════════════
-- Note: publication supabase_realtime is auto-created by Supabase.
-- Add tables to it (idempotent-ish — checks if already added).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
