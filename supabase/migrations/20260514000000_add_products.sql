CREATE TABLE IF NOT EXISTS products (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'ebook',
  price        INT DEFAULT 0,
  delivery_url TEXT,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_note TEXT;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_products" ON products FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'sales')));
