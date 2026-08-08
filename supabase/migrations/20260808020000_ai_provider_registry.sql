-- 019_ai_provider_registry.sql
-- Sprint A — expand provider_credentials so multi-provider AI (Groq/OpenRouter/Kimi/Qwen/DeepSeek/…)
-- can register alongside the existing openai-codex OAuth setup.
--
-- Design:
--   - All new providers use OpenAI-compatible REST APIs — one adapter, N configs.
--   - `provider` is now open-ended TEXT (no CHECK). Registry lives in code (services/ai-providers.ts)
--     so adding a provider = new adapter entry + config, no migration needed.
--   - `auth_type` distinguishes OAuth (openai-codex) from API key (rest).
--   - `default_model` snapshot per credential so admin can pin a model without changing global default.

ALTER TABLE provider_credentials
  ADD COLUMN IF NOT EXISTS default_model TEXT,
  ADD COLUMN IF NOT EXISTS is_default   BOOLEAN NOT NULL DEFAULT FALSE;

-- Only ONE credential may be marked default at a time — partial unique index enforces it.
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_only_one_default
  ON provider_credentials((TRUE)) WHERE is_default = TRUE;

-- Drop any legacy provider CHECK that may still be present.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_credentials_provider_check') THEN
    ALTER TABLE provider_credentials DROP CONSTRAINT provider_credentials_provider_check;
  END IF;
END $$;

COMMENT ON COLUMN provider_credentials.default_model IS
  'Pinned model for this credential. If NULL, adapter falls back to its built-in default (e.g. Groq → llama-3.3-70b-versatile).';
COMMENT ON COLUMN provider_credentials.is_default IS
  'Exactly one credential across the table may be default. runCompletion() with provider="default" resolves to that row.';
