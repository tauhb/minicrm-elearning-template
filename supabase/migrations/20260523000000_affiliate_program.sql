-- Affiliate Program Module
-- Nguồn: Dub.co (dubinc/dub), Mangosqueezy, Rewardful, Tapfiliate patterns
-- Attribution: Last-click, 30-day cookie window
-- Commission: % based, 30-day hold period before payout

-- ─────────────────────────────────────────────
-- 1. AFFILIATES — đối tác giới thiệu
-- ─────────────────────────────────────────────
CREATE TABLE affiliates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Profile
  display_name          TEXT NOT NULL,
  bio                   TEXT,

  -- Referral
  referral_code         TEXT UNIQUE NOT NULL, -- 6-char alphanumeric, e.g. "ABC123"

  -- Commission
  commission_rate       NUMERIC(5,2) NOT NULL DEFAULT 30.00, -- % of sale
  commission_type       TEXT NOT NULL DEFAULT 'percentage'   -- 'percentage' | 'fixed'
    CHECK (commission_type IN ('percentage', 'fixed')),
  fixed_amount          BIGINT,                              -- VND, if commission_type = 'fixed'

  -- Payout info (VN market)
  payout_method         TEXT DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'vietqr', 'momo', 'zalopay')),
  payout_details        JSONB,
  -- bank_transfer: { bankCode, accountNumber, accountHolder }
  -- momo: { momoNumber, accountName }
  -- vietqr: { bankCode, accountNumber, accountHolder }

  -- Status
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended')),

  approved_at           TIMESTAMPTZ,
  approved_by           UUID REFERENCES customers(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_affiliates_customer_id    ON affiliates(customer_id);
CREATE INDEX idx_affiliates_referral_code  ON affiliates(referral_code);
CREATE INDEX idx_affiliates_status         ON affiliates(status);

-- ─────────────────────────────────────────────
-- 2. AFFILIATE_CLICKS — mỗi lần ai đó click link ref
-- ─────────────────────────────────────────────
CREATE TABLE affiliate_clicks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id   UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  click_id       TEXT UNIQUE NOT NULL, -- frontend lưu vào localStorage

  -- Visitor context
  visitor_ip     TEXT,
  user_agent     TEXT,
  referrer       TEXT,

  -- Landing page
  landing_url    TEXT,

  -- Attribution window
  clicked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),

  -- Conversion (updated khi có payment)
  converted      BOOLEAN NOT NULL DEFAULT false,
  converted_at   TIMESTAMPTZ
);

CREATE INDEX idx_affiliate_clicks_affiliate_id ON affiliate_clicks(affiliate_id);
CREATE INDEX idx_affiliate_clicks_click_id     ON affiliate_clicks(click_id);
CREATE INDEX idx_affiliate_clicks_expires_at   ON affiliate_clicks(expires_at);

-- ─────────────────────────────────────────────
-- 3. AFFILIATE_CONVERSIONS — mỗi đơn hàng được attributed
-- ─────────────────────────────────────────────
CREATE TABLE affiliate_conversions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  click_id        TEXT REFERENCES affiliate_clicks(click_id),

  -- Order info
  payment_id      UUID REFERENCES payments(id),
  customer_id     UUID REFERENCES customers(id),
  course_id       UUID REFERENCES courses(id),
  product_id      UUID REFERENCES products(id),

  -- Revenue
  sale_amount     BIGINT NOT NULL, -- VND

  -- Status
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'refunded')),

  converted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_affiliate_conversions_affiliate_id ON affiliate_conversions(affiliate_id);
CREATE INDEX idx_affiliate_conversions_payment_id   ON affiliate_conversions(payment_id);
CREATE INDEX idx_affiliate_conversions_status       ON affiliate_conversions(status);

-- ─────────────────────────────────────────────
-- 4. AFFILIATE_COMMISSIONS — tiền hoa hồng earned
-- ─────────────────────────────────────────────
CREATE TABLE affiliate_commissions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id            UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  conversion_id           UUID NOT NULL REFERENCES affiliate_conversions(id) ON DELETE CASCADE,

  -- Calculation snapshot (tại thời điểm conversion)
  sale_amount             BIGINT NOT NULL,         -- VND
  commission_rate         NUMERIC(5,2) NOT NULL,   -- % hoặc fixed amount
  commission_amount       BIGINT NOT NULL,          -- VND earned

  -- Hold period: 30 ngày để tránh refund
  earned_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),

  -- Payout
  payout_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (payout_status IN ('pending', 'approved', 'paid', 'cancelled')),
  payout_id               UUID, -- set khi được batch vào payout
  paid_at                 TIMESTAMPTZ
);

CREATE INDEX idx_affiliate_commissions_affiliate_id  ON affiliate_commissions(affiliate_id);
CREATE INDEX idx_affiliate_commissions_payout_status ON affiliate_commissions(payout_status);
CREATE INDEX idx_affiliate_commissions_available_at  ON affiliate_commissions(available_at);

-- ─────────────────────────────────────────────
-- 5. AFFILIATE_PAYOUTS — batch payout records
-- ─────────────────────────────────────────────
CREATE TABLE affiliate_payouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id        UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,

  -- Batch info
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  commission_count    INT NOT NULL DEFAULT 0,
  total_amount        BIGINT NOT NULL, -- VND

  -- Payout method (snapshot từ affiliate)
  payout_method       TEXT NOT NULL,
  payout_details      JSONB NOT NULL,

  -- Status
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'failed')),

  -- Transaction
  payout_reference    TEXT, -- bank ref, MoMo receipt, etc.
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES customers(id),
  paid_at             TIMESTAMPTZ
);

CREATE INDEX idx_affiliate_payouts_affiliate_id ON affiliate_payouts(affiliate_id);
CREATE INDEX idx_affiliate_payouts_status       ON affiliate_payouts(status);

-- Link commissions → payout
ALTER TABLE affiliate_commissions
  ADD CONSTRAINT fk_commission_payout
  FOREIGN KEY (payout_id) REFERENCES affiliate_payouts(id);

-- ─────────────────────────────────────────────
-- 6. RLS POLICIES
-- ─────────────────────────────────────────────
ALTER TABLE affiliates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_conversions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_commissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_payouts       ENABLE ROW LEVEL SECURITY;

-- Affiliate xem data của chính mình
CREATE POLICY "affiliate_own_read" ON affiliates
  FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY "affiliate_own_clicks" ON affiliate_clicks
  FOR SELECT USING (
    affiliate_id IN (SELECT id FROM affiliates WHERE customer_id = auth.uid())
  );

CREATE POLICY "affiliate_own_conversions" ON affiliate_conversions
  FOR SELECT USING (
    affiliate_id IN (SELECT id FROM affiliates WHERE customer_id = auth.uid())
  );

CREATE POLICY "affiliate_own_commissions" ON affiliate_commissions
  FOR SELECT USING (
    affiliate_id IN (SELECT id FROM affiliates WHERE customer_id = auth.uid())
  );

CREATE POLICY "affiliate_own_payouts" ON affiliate_payouts
  FOR SELECT USING (
    affiliate_id IN (SELECT id FROM affiliates WHERE customer_id = auth.uid())
  );

-- Admin full access (service role bypasses RLS, nhưng thêm cho admin role)
CREATE POLICY "admin_full_affiliates" ON affiliates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_full_clicks" ON affiliate_clicks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_full_conversions" ON affiliate_conversions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_full_commissions" ON affiliate_commissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_full_payouts" ON affiliate_payouts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────
-- 7. HELPER FUNCTION — generate referral code
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0,O,1,I to avoid confusion
  code  TEXT := '';
  i     INT;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;
