-- 015_tasks_users_audit.sql
-- Wave 0 foundation: promote care_history to task tracker, extend customers,
-- expand role enum, add audit log. All downstream sprint work depends on this.
--
-- Design decisions:
--   - Merge tasks into care_history (per user's Q1=A) via `kind` column.
--       kind='care_log' (default) = past event, backward compat with existing rows.
--       kind='task'               = future scheduled action with due_at + status.
--   - Existing next_follow_up_date column stays — dashboard follow-up widget still
--     reads it. New tasks use due_at (datetime, higher precision).
--   - Role expansion (Q2=full): owner/admin/sales/support/student/affiliate.
--     Drops BOTH legacy role constraints (customers_role_check + profiles_role_check —
--     table was renamed from `profiles`, both constraints stuck around).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. care_history: promote to dual-role (care log + task)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE care_history
  ADD COLUMN IF NOT EXISTS kind         TEXT DEFAULT 'care_log',
  ADD COLUMN IF NOT EXISTS title        TEXT,
  ADD COLUMN IF NOT EXISTS status       TEXT DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS priority     TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS due_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_to  UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_id     UUID REFERENCES payments(id) ON DELETE SET NULL;

ALTER TABLE care_history DROP CONSTRAINT IF EXISTS care_history_kind_check;
ALTER TABLE care_history ADD CONSTRAINT care_history_kind_check
  CHECK (kind IN ('care_log', 'task'));

ALTER TABLE care_history DROP CONSTRAINT IF EXISTS care_history_status_check;
ALTER TABLE care_history ADD CONSTRAINT care_history_status_check
  CHECK (status IN ('open', 'done', 'cancelled'));

ALTER TABLE care_history DROP CONSTRAINT IF EXISTS care_history_priority_check;
ALTER TABLE care_history ADD CONSTRAINT care_history_priority_check
  CHECK (priority IN ('low', 'medium', 'high'));

-- Backfill: rows created before this migration are historical care logs, marked done.
UPDATE care_history SET kind   = 'care_log' WHERE kind   IS NULL;
UPDATE care_history SET status = 'done'     WHERE status IS NULL;

-- Indexes for dashboard "open tasks by due date" and "tasks assigned to me" queries.
CREATE INDEX IF NOT EXISTS idx_care_history_task_open
  ON care_history(due_at) WHERE kind = 'task' AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_care_history_assigned
  ON care_history(assigned_to) WHERE kind = 'task' AND status = 'open';

COMMENT ON COLUMN care_history.kind IS
  '"care_log" = past event log (default, backward compat with existing rows). "task" = future scheduled action with due_at + status open/done.';
COMMENT ON COLUMN care_history.title IS
  'Task title. Care logs use content instead.';
COMMENT ON COLUMN care_history.due_at IS
  'Precise datetime for task deadline. Preferred over legacy next_follow_up_date (DATE-only).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. customers: phone, soft-delete status, role expansion
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone  TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('active', 'deactivated'));

-- Expand role. Drop BOTH legacy constraints (table was renamed from `profiles` —
-- migration left both stuck. Both would block the new value set).
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_role_check;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE customers ADD CONSTRAINT customers_role_check
  CHECK (role IN ('owner', 'admin', 'sales', 'support', 'student', 'affiliate'));

CREATE INDEX IF NOT EXISTS idx_customers_role   ON customers(role);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status) WHERE status = 'active';

-- Backfill customer.phone from source lead where possible.
UPDATE customers c SET phone = l.phone
  FROM leads l
  WHERE l.converted_to = c.id
    AND c.phone IS NULL
    AND l.phone IS NOT NULL
    AND l.phone <> '';

COMMENT ON COLUMN customers.phone IS
  'Phone number. Backfilled from source lead on conversion when available.';
COMMENT ON COLUMN customers.status IS
  'Soft-delete flag. "deactivated" hides from default admin views but keeps data.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. admin_audit_log: immutable trail of sensitive admin actions
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  actor_email  TEXT,                                 -- snapshot; kept if actor deleted
  action       TEXT NOT NULL,                        -- e.g. 'lead.convert', 'user.role_change'
  target_type  TEXT,                                 -- 'lead' | 'customer' | 'order' | ...
  target_id    UUID,
  changes      JSONB,                                -- {before, after} or diff
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor   ON admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_read_owner_admin" ON admin_audit_log;
CREATE POLICY "audit_read_owner_admin" ON admin_audit_log FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM customers
            WHERE customers.id = auth.uid()
              AND customers.role IN ('owner', 'admin'))
  );

-- Writes are done via service-role from API endpoints — no INSERT policy needed
-- (RLS blocks anon/authenticated INSERT by default when no policy is defined).

COMMENT ON TABLE admin_audit_log IS
  'Immutable trail of sensitive admin actions. Read by owners/admins only.';
