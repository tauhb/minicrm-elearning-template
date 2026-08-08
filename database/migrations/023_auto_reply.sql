-- 023_auto_reply.sql
-- Sprint D — enable AI auto-reply per inbox (Website widget + Telegram + Zalo + FB/Email).
--
-- Per-inbox toggle so admin controls where the bot chats vs where humans handle it.
-- The bot uses Sprint B RAG: query product_knowledge_bases via inbox → funnel → product,
-- retrieve top chunks, LLM (Sprint A default provider) generates reply grounded in chunks.
-- Confidence threshold: if best score < min_score, defers to human (no auto-reply).

ALTER TABLE chat_inboxes
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_reply_config JSONB DEFAULT '{}'::jsonb;
  -- auto_reply_config shape:
  --   { kb_ids: uuid[]           -- explicit KBs (overrides funnel→product→KB lookup)
  --   , min_score: 0.7           -- cosine similarity threshold to speak (else silent)
  --   , persona: 'Bạn là trợ lý AI của khoá học X, trả lời ngắn gọn tiếng Việt.'
  --   , handoff_phrase: 'Chuyển agent'   -- if visitor says this, bot stops
  --   , max_turns: 20            -- after N visitor messages, always defer to human
  --   , provider_id: 'openai'    -- override the default AI provider for this inbox
  --   , model: 'gpt-4o-mini'     -- pinned model
  --   }

-- Track bot messages so we can distinguish them from agent messages in UI + analytics
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS bot_metadata JSONB;
  -- {chunks_used: [{entry_id, score}], model: 'gpt-4o-mini', latency_ms: 1200}
  -- Sender_type='bot' already exists in the check constraint from migration 013.

COMMENT ON COLUMN chat_inboxes.auto_reply_enabled IS
  'When true, incoming visitor messages trigger a RAG-grounded LLM reply. Toggle off to make this inbox agent-only.';
COMMENT ON COLUMN chat_inboxes.auto_reply_config IS
  'Bot behaviour tuning per inbox. See migration 023 for shape.';
COMMENT ON COLUMN chat_messages.bot_metadata IS
  'For sender_type=bot messages: which chunks were retrieved, model used, latency. Used by admin to audit bot decisions.';
