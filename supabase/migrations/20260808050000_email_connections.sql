-- Supabase mirror of database/migrations/024_email_connections.sql
-- (kept in sync — edit both when touching schema.)

CREATE TABLE IF NOT EXISTS email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  api_key_encrypted TEXT,
  extra JSONB DEFAULT '{}'::jsonb,
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

CREATE UNIQUE INDEX IF NOT EXISTS email_conn_one_default_txnl
  ON email_connections((TRUE)) WHERE is_default_transactional = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS email_conn_one_default_mktg
  ON email_connections((TRUE)) WHERE is_default_marketing = TRUE;

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_conn_admin_all" ON email_connections;
CREATE POLICY "email_conn_admin_all" ON email_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE email_broadcasts
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES email_connections(id) ON DELETE SET NULL;

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
      'resend', 'Resend (migrated)', 'onboarding@resend.dev', resend_key,
      (COALESCE(provider_hint, 'resend') = 'resend') OR (brevo_key IS NULL OR brevo_key = '')
    );
  END IF;

  IF brevo_key IS NOT NULL AND brevo_key <> ''
     AND NOT EXISTS (SELECT 1 FROM email_connections WHERE provider = 'brevo') THEN
    INSERT INTO email_connections (provider, name, from_email, api_key_encrypted, is_default_marketing)
    VALUES (
      'brevo', 'Brevo (migrated)', 'onboarding@brevo.local', brevo_key,
      COALESCE(provider_hint, 'brevo') = 'brevo'
    );
  END IF;
END $$;
