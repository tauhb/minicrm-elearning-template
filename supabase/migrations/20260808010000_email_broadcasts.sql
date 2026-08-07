-- 017_email_broadcasts.sql
-- Wave 2 Track F — Email Marketing (Brevo integration)
--
-- Lightweight audit log for admin-triggered broadcasts. The UI wraps the
-- existing /api/email/broadcast endpoint but records every send here so team
-- members without Brevo dashboard access can still see history & stats.
--
-- Recipient filter is stored as JSONB so we can add new audience shapes
-- without another migration:
--   {kind: 'leads'}                            → all leads
--   {kind: 'students'}                         → all customers with role=student
--   {kind: 'team'}                             → all customers with role in owner/admin/sales/support
--   {kind: 'tag', tag: 'vip'}                  → customers/leads with tag
--   {kind: 'course', course_id: '...'}         → students enrolled in course (legacy)
--   {kind: 'custom', emails: ['a@x','b@y']}    → raw email list

CREATE TABLE IF NOT EXISTS email_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  html_body TEXT,
  recipient_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'sent' CHECK (status IN ('draft','sending','sent','failed')),
  error TEXT,
  created_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_broadcasts_created
  ON email_broadcasts(created_at DESC);

ALTER TABLE email_broadcasts ENABLE ROW LEVEL SECURITY;

-- Admin/owner/sales can read broadcast history
DROP POLICY IF EXISTS "admin_email_broadcasts_read" ON email_broadcasts;
CREATE POLICY "admin_email_broadcasts_read" ON email_broadcasts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE id = auth.uid()
        AND role IN ('owner','admin','sales')
    )
  );

-- Writes only via service role (API endpoint); no client-side INSERT/UPDATE.

COMMENT ON TABLE  email_broadcasts        IS 'Wave 2 Track F: audit log for admin-triggered email broadcasts.';
COMMENT ON COLUMN email_broadcasts.recipient_filter IS 'JSONB filter spec: {kind, tag?, course_id?, emails?}';
COMMENT ON COLUMN email_broadcasts.status IS 'draft (unused today) | sending | sent | failed (all recipients failed)';
