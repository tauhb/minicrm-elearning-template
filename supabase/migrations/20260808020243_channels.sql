-- 021_channels.sql — Sprint C: Absorb Zalo + Telegram + Facebook + Email
--                     as CRM channels (extends chat_inboxes / conversations
--                     / messages, adds chat_outbound_queue).
--
-- Design (see docs/CHANNELS.md):
--   • chat_inboxes gains channel_type widening + external_id + channel_config.
--   • chat_conversations gains external_thread_id + channel_type mirror for
--     fast lookup on inbound webhook / worker delivery.
--   • chat_messages gains external_message_id (dedup on retry) + delivery_status.
--   • chat_outbound_queue: agent replies bound for external channels. Telegram
--     is delivered inline by the reply handler; Zalo/Facebook/Email require the
--     worker (worker/) which polls this table.
--
-- Note on channel_type values:
--   Migration 013 already created chat_inboxes with a CHECK on values
--     ('web_widget', 'facebook', 'zalo', 'whatsapp', 'email', 'api').
--   Sprint C introduces 'telegram' and renames 'web_widget' → 'website' per
--   the new channel taxonomy. We migrate existing rows and swap the CHECK.
--   ('whatsapp' and 'api' kept for forward compatibility.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. chat_inboxes — new channel taxonomy + per-channel config
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old check constraint (name varies by pg version — try both spellings)
ALTER TABLE chat_inboxes DROP CONSTRAINT IF EXISTS chat_inboxes_channel_type_check;

-- Rebrand any existing rows before applying the new constraint
UPDATE chat_inboxes SET channel_type = 'website' WHERE channel_type = 'web_widget';

ALTER TABLE chat_inboxes
  ALTER COLUMN channel_type SET DEFAULT 'website';

ALTER TABLE chat_inboxes
  ADD CONSTRAINT chat_inboxes_channel_type_check CHECK (
    channel_type IN ('website', 'telegram', 'zalo', 'facebook', 'email', 'whatsapp', 'api')
  );

ALTER TABLE chat_inboxes
  ADD COLUMN IF NOT EXISTS external_id TEXT,      -- telegram bot handle, zalo own uid, FB page id, email address
  ADD COLUMN IF NOT EXISTS worker_last_heartbeat_at TIMESTAMPTZ;
-- channel_config already exists as JSONB (013). Per-channel shapes:
--   telegram: { bot_token_encrypted, bot_username, webhook_secret, mode: 'webhook'|'polling' }
--   zalo:     { account_email, cookie_encrypted, imei, user_agent, own_uid }
--   facebook: { page_id, page_name, page_access_token_encrypted, verify_token }
--   email:    { imap_host, imap_port, imap_user, imap_pass_encrypted,
--               smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, from_address }

CREATE INDEX IF NOT EXISTS idx_chat_inboxes_channel_type ON chat_inboxes(channel_type);
CREATE INDEX IF NOT EXISTS idx_chat_inboxes_external_id  ON chat_inboxes(channel_type, external_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. chat_conversations — external thread id + channel mirror
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS external_thread_id TEXT,   -- Telegram chat.id, Zalo threadId, FB thread PSID
  ADD COLUMN IF NOT EXISTS channel_type TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_conv_external
  ON chat_conversations(channel_type, external_thread_id)
  WHERE external_thread_id IS NOT NULL;

-- Backfill channel_type from inbox for existing rows.
UPDATE chat_conversations c
   SET channel_type = i.channel_type
  FROM chat_inboxes i
 WHERE c.inbox_id = i.id
   AND c.channel_type IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. chat_messages — external id (dedup) + delivery status
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS external_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent'
    CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'failed'));

CREATE INDEX IF NOT EXISTS idx_chat_msg_external
  ON chat_messages(external_message_id)
  WHERE external_message_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. chat_outbound_queue — agent replies bound for external channels
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_outbound_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id          UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  inbox_id            UUID NOT NULL REFERENCES chat_inboxes(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  channel_type        TEXT NOT NULL,
  external_thread_id  TEXT NOT NULL,
  content             TEXT NOT NULL,
  attempts            INT NOT NULL DEFAULT 0,
  last_error          TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbound_pending
  ON chat_outbound_queue(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbound_inbox
  ON chat_outbound_queue(inbox_id, status);

ALTER TABLE chat_outbound_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbound_admin_read" ON chat_outbound_queue;
CREATE POLICY "outbound_admin_read" ON chat_outbound_queue
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM customers
             WHERE id = auth.uid()
               AND role IN ('owner', 'admin', 'sales', 'support'))
  );

-- Publish outbound queue to realtime so the worker can react instantly
-- (fallback to 3-sec polling if realtime hiccups).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_outbound_queue;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. worker_heartbeats — one row per running worker, refreshed each cycle
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id            TEXT PRIMARY KEY,                    -- worker instance id (env or hostname)
  hostname      TEXT,
  version       TEXT,
  channels      TEXT[] NOT NULL DEFAULT '{}',        -- which channel types this worker owns
  last_beat_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_heartbeats_admin_read" ON worker_heartbeats;
CREATE POLICY "worker_heartbeats_admin_read" ON worker_heartbeats
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM customers
             WHERE id = auth.uid()
               AND role IN ('owner', 'admin', 'sales', 'support'))
  );
