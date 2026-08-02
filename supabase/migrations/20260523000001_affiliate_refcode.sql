-- Affiliate Refcode Migration
-- 1. Mỗi lead có refcode duy nhất từ lúc tạo
-- 2. Affiliates có thể là lead (chưa mua) hoặc customer (đã mua)
-- 3. Thêm role 'affiliate' cho customers

-- ─────────────────────────────────────────────
-- 1. Add refcode to leads
-- ─────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS refcode TEXT UNIQUE;

-- Index để lookup nhanh khi visitor click ?ref=
CREATE INDEX IF NOT EXISTS idx_leads_refcode ON leads(refcode);

-- ─────────────────────────────────────────────
-- 2. Update affiliates table
--    - customer_id: nullable (lead chưa mua chưa có account)
--    - lead_id: FK mới → leads.id
-- ─────────────────────────────────────────────

-- Drop old NOT NULL constraint on customer_id
ALTER TABLE affiliates ALTER COLUMN customer_id DROP NOT NULL;

-- Add lead_id FK
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_affiliates_lead_id ON affiliates(lead_id);

-- Constraint: phải có ít nhất 1 trong 2 (customer_id hoặc lead_id)
ALTER TABLE affiliates DROP CONSTRAINT IF EXISTS affiliates_has_owner;
ALTER TABLE affiliates ADD CONSTRAINT affiliates_has_owner
  CHECK (customer_id IS NOT NULL OR lead_id IS NOT NULL);

-- ─────────────────────────────────────────────
-- 3. customers.role: thêm 'affiliate'
-- ─────────────────────────────────────────────
-- Drop old check constraint nếu có
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_role_check;
ALTER TABLE customers ADD CONSTRAINT customers_role_check
  CHECK (role IN ('student', 'admin', 'sales', 'affiliate'));

-- ─────────────────────────────────────────────
-- 4. Update RLS policies cho affiliates (thêm lead_id check)
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "affiliate_own_read" ON affiliates;
CREATE POLICY "affiliate_own_read" ON affiliates
  FOR SELECT USING (
    customer_id = auth.uid()
    OR lead_id IN (
      SELECT id FROM leads WHERE converted_to = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- 5. Trigger: auto-generate refcode khi tạo lead mới
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_lead_refcode()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT;
  attempts INT := 0;
BEGIN
  -- Chỉ generate nếu chưa có
  IF NEW.refcode IS NOT NULL THEN
    RETURN NEW;
  END IF;

  LOOP
    -- 6 ký tự, tránh 0/O/1/I
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
    END LOOP;

    -- Check unique
    EXIT WHEN NOT EXISTS (SELECT 1 FROM leads WHERE refcode = code);

    attempts := attempts + 1;
    IF attempts > 10 THEN
      -- Fallback: 8 ký tự nếu collision liên tục
      code := '';
      FOR i IN 1..8 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
      END LOOP;
      EXIT;
    END IF;
  END LOOP;

  NEW.refcode := code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_refcode ON leads;
CREATE TRIGGER trg_lead_refcode
  BEFORE INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION set_lead_refcode();

-- ─────────────────────────────────────────────
-- 6. Backfill refcode cho leads cũ chưa có
-- ─────────────────────────────────────────────
DO $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  rec   RECORD;
  code  TEXT;
BEGIN
  FOR rec IN SELECT id FROM leads WHERE refcode IS NULL LOOP
    LOOP
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM leads WHERE refcode = code);
    END LOOP;
    UPDATE leads SET refcode = code WHERE id = rec.id;
  END LOOP;
END;
$$;
