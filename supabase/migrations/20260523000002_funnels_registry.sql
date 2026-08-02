-- Funnels Registry
-- Admin nhập danh sách funnels đang deploy → affiliate share link đầy đủ

CREATE TABLE IF NOT EXISTS funnels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  slug          TEXT UNIQUE NOT NULL,       -- ngắn, dùng làm reference (vd: 'khoa-tiktok')
  name          TEXT NOT NULL,              -- tên hiển thị (vd: 'Khóa học TikTok Ads Pro')
  description   TEXT,                       -- mô tả ngắn cho affiliate biết quảng bá gì

  -- URL chính
  url           TEXT NOT NULL,              -- https://funnel-tiktok.vercel.app

  -- Loại funnel (filter trong UI)
  type          TEXT NOT NULL DEFAULT 'sales'
    CHECK (type IN ('sales', 'leads', 'webinar', 'booking', 'challenge', 'other')),

  -- Product link (optional — gắn với khóa học hoặc sản phẩm cụ thể)
  course_id     UUID REFERENCES courses(id) ON DELETE SET NULL,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Settings
  is_active     BOOLEAN NOT NULL DEFAULT true,    -- false → ẩn khỏi affiliate dashboard
  sort_order    INT NOT NULL DEFAULT 0,           -- thứ tự hiển thị

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_funnels_is_active ON funnels(is_active);
CREATE INDEX idx_funnels_sort_order ON funnels(sort_order);

-- RLS
ALTER TABLE funnels ENABLE ROW LEVEL SECURITY;

-- Mọi user đã login đều đọc được (để affiliate dashboard hiện share links)
CREATE POLICY "funnels_read_all_authenticated" ON funnels
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active = true);

-- Chỉ admin được CRUD
CREATE POLICY "funnels_admin_all" ON funnels
  FOR ALL USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = 'admin')
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_funnels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_funnels_updated_at
  BEFORE UPDATE ON funnels
  FOR EACH ROW EXECUTE FUNCTION set_funnels_updated_at();
