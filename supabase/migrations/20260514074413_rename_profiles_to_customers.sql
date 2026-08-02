-- Rename profiles → customers
ALTER TABLE profiles RENAME TO customers;

-- Update RLS policies on leads that reference profiles table
DROP POLICY IF EXISTS "admin_leads" ON leads;
CREATE POLICY "admin_leads" ON leads FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales')));

-- Update RLS policies on products
DROP POLICY IF EXISTS "admin_products" ON products;
CREATE POLICY "admin_products" ON products FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales')));

-- Update lead_activities policy
DROP POLICY IF EXISTS "admin_lead_activities" ON lead_activities;

-- Rename existing policies for clarity (cosmetic)
ALTER POLICY "own_profile" ON customers RENAME TO "own_customer";
ALTER POLICY "public_read_profiles" ON customers RENAME TO "public_read_customers";
