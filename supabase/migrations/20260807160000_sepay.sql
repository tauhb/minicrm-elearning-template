-- 009_sepay.sql
-- SePay VietQR integration:
--   1. funnel_flows.payment_config JSONB — bank info + encrypted API key + amount mode
--   2. funnel_orders table — pending/paid orders with QR + reference code
--   3. link submission → order via funnel_form_submissions.order_id

-- Payment config per funnel
ALTER TABLE funnel_flows
  ADD COLUMN IF NOT EXISTS payment_config JSONB DEFAULT '{}'::jsonb;
-- Shape: {
--   provider: 'sepay',
--   bank_name: 'Vietcombank',           -- also passed to vietqr.app ?bank=
--   bank_bin: '970436',                  -- optional BIN code
--   account_number: '0123456789',
--   account_holder: 'NGUYEN VAN A',
--   qr_template: 'compact' | 'qronly',
--   amount_mode: 'fixed' | 'from_form',
--   fixed_amount: 1997000,
--   amount_form_field: 'amount',         -- if from_form
--   webhook_secret_encrypted: '<AES>',   -- for verifying SePay callback (Authorization header)
--   order_prefix: 'FN'                    -- prefix for reference codes
-- }

-- Orders (one per form submission on payment step)
CREATE TABLE IF NOT EXISTS funnel_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id UUID NOT NULL REFERENCES funnel_flows(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES funnel_steps(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES funnel_form_submissions(id) ON DELETE SET NULL,

  reference_code TEXT UNIQUE NOT NULL,       -- 'FN-abc123' — matched against SePay callback content
  amount INT NOT NULL,                        -- VND, no decimals
  currency TEXT NOT NULL DEFAULT 'VND',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),

  -- Snapshot of bank + customer info at order time
  bank_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {name, email, phone} from form

  qr_url TEXT,                                -- Pre-built VietQR image URL

  sepay_ref TEXT,                             -- SePay's transaction id
  sepay_payload JSONB,                        -- Full webhook payload for audit
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                     -- 30 min default

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_orders_reference ON funnel_orders(reference_code);
CREATE INDEX IF NOT EXISTS idx_funnel_orders_status ON funnel_orders(status);
CREATE INDEX IF NOT EXISTS idx_funnel_orders_funnel ON funnel_orders(funnel_id, created_at DESC);

ALTER TABLE funnel_orders ENABLE ROW LEVEL SECURITY;

-- Public can read own order (for polling) if they know the id
CREATE POLICY "orders_public_read_by_id" ON funnel_orders
  FOR SELECT USING (true);

-- Only admin can list/modify
CREATE POLICY "orders_admin_all" ON funnel_orders
  FOR ALL USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin'));

-- Link submission → order (optional, for lookup)
ALTER TABLE funnel_form_submissions
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES funnel_orders(id) ON DELETE SET NULL;
