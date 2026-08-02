-- 1. Thêm UTM fields vào leads (utm_source, utm_campaign đã có)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium  TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content TEXT;

-- 2. Tạo bảng Lịch sử chăm sóc
CREATE TABLE IF NOT EXISTS care_history (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id             UUID REFERENCES leads(id) ON DELETE CASCADE,
  customer_id         UUID REFERENCES customers(id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN ('call','zalo','email','meeting','note','follow_up')),
  content             TEXT,
  result              TEXT CHECK (result IN ('success','no_answer','interested','not_interested','purchased')),
  next_follow_up_date DATE,
  created_by          UUID REFERENCES customers(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT care_history_target_check CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL)
);

ALTER TABLE care_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_care_history" ON care_history FOR ALL
  USING (EXISTS (
    SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin','sales','student')
  ));
