-- Mở rộng products table cho digital pages
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug         TEXT UNIQUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_html TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS access_type  TEXT DEFAULT 'public'
  CHECK (access_type IN ('public','password','course','assigned'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS password     TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS course_id    UUID REFERENCES courses(id) ON DELETE SET NULL;

-- Junction table: khách → sản phẩm số (cho access_type='assigned')
CREATE TABLE IF NOT EXISTS customer_products (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  granted_by  UUID REFERENCES customers(id),
  UNIQUE(customer_id, product_id)
);

-- RLS
ALTER TABLE customer_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_customer_products" ON customer_products FOR SELECT
  USING (auth.uid() = customer_id);
CREATE POLICY "admin_customer_products" ON customer_products FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin','sales')));

-- Public có thể đọc products (cho /p/:slug — access check ở app layer)
DROP POLICY IF EXISTS "public_products_read" ON products;
CREATE POLICY "public_products_read" ON products FOR SELECT USING (true);
