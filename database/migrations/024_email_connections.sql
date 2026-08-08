-- 024_email_connections.sql
-- Multi-provider Email Connections
--
-- Analog to provider_credentials (AI): one row per configured email account.
-- Multiple accounts of the SAME provider allowed (e.g. 2 Brevo, 1 Resend).
-- Registry (labels, docs, capability flags) lives in services/email-providers.ts.
--
-- Two "roles":
--   is_default_transactional → magic links, welcome, order confirmations
--   is_default_marketing     → broadcasts, sequences, nurture
-- Exactly ONE row may hold each default. UI picker on EmailMarketingView reads
-- the marketing default; sendEmail(kind='transactional') reads the transactional one.

CREATE TABLE IF NOT EXISTS email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,                       -- 'resend' | 'brevo' | future
  name TEXT NOT NULL,                           -- user-given: "Brevo — Marketing"
  from_email TEXT NOT NULL,
  from_name TEXT,
  api_key_encrypted TEXT,                       -- for API-based providers
  extra JSONB DEFAULT '{}'::jsonb,              -- provider-specific config (region, domain, smtp…)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_default_transactional BOOL NOT NULL DEFAULT FALSE,
  is_default_marketing      BOOL NOT NULL DEFAULT FALSE,
  daily_limit  INT,
  monthly_sent INT NOT NULL DEFAULT 0,
  monthly_reset_at TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  last_tested_at TIMESTAMPTZ,
  last_test_error TEXT,
  created_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce exactly-one default per role (partial unique index — Postgres idiom).
CREATE UNIQUE INDEX IF NOT EXISTS email_conn_one_default_txnl
  ON email_connections((TRUE)) WHERE is_default_transactional = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS email_conn_one_default_mktg
  ON email_connections((TRUE)) WHERE is_default_marketing = TRUE;

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_conn_admin_all" ON email_connections;
CREATE POLICY "email_conn_admin_all" ON email_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('owner','admin')));

-- Extend email_broadcasts to track which connection was used.
ALTER TABLE email_broadcasts
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES email_connections(id) ON DELETE SET NULL;

-- ── Auto-seed from legacy app_settings ────────────────────────────────────────
-- Migrates existing plaintext keys into email_connections. Values are seeded RAW
-- (not AES-encrypted) because legacy app_settings stored them plaintext; the
-- sendEmail() path uses tryDecryptOrRaw() so raw values keep working. First
-- edit in the UI re-encrypts properly. TODO: one-time re-encrypt script.
DO $$
DECLARE
  brevo_key TEXT;
  resend_key TEXT;
  provider_hint TEXT;
BEGIN
  SELECT (value->>'value') INTO brevo_key   FROM app_settings WHERE key = 'brevo_api_key';
  SELECT (value->>'value') INTO resend_key  FROM app_settings WHERE key = 'resend_api_key';
  SELECT (value->>'value') INTO provider_hint FROM app_settings WHERE key = 'email_provider';

  IF resend_key IS NOT NULL AND resend_key <> ''
     AND NOT EXISTS (SELECT 1 FROM email_connections WHERE provider = 'resend') THEN
    INSERT INTO email_connections (provider, name, from_email, api_key_encrypted, is_default_transactional)
    VALUES (
      'resend',
      'Resend (migrated)',
      'onboarding@resend.dev',
      resend_key,
      -- Resend is default_transactional unless brevo is the only key present
      (COALESCE(provider_hint, 'resend') = 'resend') OR (brevo_key IS NULL OR brevo_key = '')
    );
  END IF;

  IF brevo_key IS NOT NULL AND brevo_key <> ''
     AND NOT EXISTS (SELECT 1 FROM email_connections WHERE provider = 'brevo') THEN
    INSERT INTO email_connections (provider, name, from_email, api_key_encrypted, is_default_marketing)
    VALUES (
      'brevo',
      'Brevo (migrated)',
      'onboarding@brevo.local',
      brevo_key,
      COALESCE(provider_hint, 'brevo') = 'brevo'
    );
  END IF;
END $$;

COMMENT ON TABLE email_connections IS
  'Multi-provider email accounts. Multiple rows per provider allowed. Registry (labels/docs) in services/email-providers.ts.';
COMMENT ON COLUMN email_connections.api_key_encrypted IS
  'AES-256-GCM ciphertext (base64) for API-based providers. Legacy migrated rows may be plaintext — read path uses tryDecryptOrRaw().';
COMMENT ON COLUMN email_connections.extra IS
  'Provider-specific config: region (SES), sending_domain (Mailgun), smtp={host,port,user}, etc.';
