-- Migration 003: Allow admin/sales to write app_settings
-- Root cause: app_settings only had SELECT policy, writes were silently blocked

CREATE POLICY "admin_write_settings" ON app_settings
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin', 'sales'))
  );
