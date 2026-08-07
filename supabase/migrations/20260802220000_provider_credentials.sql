-- 004_provider_credentials.sql
-- Store AI provider credentials (OAuth tokens, API keys) encrypted.
--
-- Each row = 1 provider (openai-codex, anthropic, openai-api, groq, etc)
-- Only 1 row per provider per portal instance (single-tenant).
-- Encryption: access_token/refresh_token/api_key stored as encrypted TEXT
--   (encryption done in application layer using PROVIDER_ENCRYPTION_KEY env var).

CREATE TABLE IF NOT EXISTS provider_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL UNIQUE,     -- 'openai-codex', 'anthropic-api', 'openai-api', etc
  auth_type TEXT NOT NULL,           -- 'oauth_device_code' | 'api_key' | 'paste_token'
  display_name TEXT,                 -- Human-readable label
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'pending')),

  -- Encrypted secrets (base64-encoded ciphertext)
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  api_key_encrypted TEXT,

  -- Non-secret metadata
  base_url TEXT,                      -- API endpoint (e.g. chatgpt.com/backend-api/codex)
  expires_at TIMESTAMPTZ,             -- when access_token expires (for refresh scheduling)
  scopes TEXT[],                      -- OAuth scopes granted
  account_email TEXT,                 -- Account this is linked to (for user display)
  extra JSONB DEFAULT '{}'::jsonb,    -- Provider-specific metadata

  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider ON provider_credentials(provider);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_status ON provider_credentials(status);

-- RLS: admins only (secrets never exposed to client-side)
ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access" ON provider_credentials
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

-- Pending device auth sessions (short-lived, ephemeral)
CREATE TABLE IF NOT EXISTS oauth_device_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  device_auth_id TEXT NOT NULL,       -- OpenAI's device_auth_id
  user_code TEXT NOT NULL,            -- Code shown to user
  verification_uri TEXT NOT NULL,     -- URL user opens
  poll_interval_seconds INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,    -- After this, session invalid
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'expired', 'cancelled')),
  authorized_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_device_sessions_status ON oauth_device_sessions(status);
CREATE INDEX IF NOT EXISTS idx_oauth_device_sessions_expires_at ON oauth_device_sessions(expires_at);

ALTER TABLE oauth_device_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_sessions" ON oauth_device_sessions
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );
