-- 022_api_tokens.sql
-- Sprint E · MCP server foundation: personal API tokens.
--
-- Each row is a token owned by a customer (typically an admin/owner) that
-- external AI agents (Claude Code / Codex / Cursor / arbitrary MCP client)
-- can present to the CRM via `Authorization: Bearer acrm_...`.
--
-- Only the SHA-256 hash is stored; the raw token is shown to the user
-- exactly once at creation time.  Scopes are pure strings — validation
-- (and the canonical list) lives in the application layer
-- (`mcp-server/src/scopes.ts` + `api/api-tokens/index.ts`) so we can
-- iterate without a migration.

CREATE TABLE IF NOT EXISTS api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_owner ON api_tokens(owner_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash  ON api_tokens(token_hash) WHERE revoked_at IS NULL;

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_tokens_owner_manage" ON api_tokens;
CREATE POLICY "api_tokens_owner_manage" ON api_tokens FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
