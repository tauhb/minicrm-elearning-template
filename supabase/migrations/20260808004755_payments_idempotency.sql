-- 016_payments_idempotency.sql
-- Wave 1 Track B — belt-and-suspenders idempotency for SePay webhooks.
--
-- Problem:
--   Neither /api/webhook-sepay nor /api/f/sepay-webhook enforces uniqueness at
--   the DB level. If SePay retries a callback (network flake, timeout) we would
--   double-insert into payments and re-create the same customer.
--
-- Fix:
--   Partial UNIQUE index on payments(gateway, gateway_ref) where gateway_ref
--   is populated. Manual/legacy rows with NULL gateway_ref are unaffected.
--
-- Also: allow 'cancelled' status on funnel_orders so admins can cancel a
-- pending order from the OrderDetailModal without leaving a dangling reference.

-- 1) Idempotency guard on payments (gateway, gateway_ref)
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_ref_unique
  ON payments (gateway, gateway_ref)
  WHERE gateway_ref IS NOT NULL;

COMMENT ON INDEX payments_gateway_ref_unique IS
  'Belt-and-suspenders idempotency: prevents duplicate payment rows when SePay retries a webhook. Partial index so legacy rows with NULL gateway_ref remain allowed.';

-- 2) payments.order_id → funnel_orders(id)
--    Wave 1 Track B needs the reverse pointer so the unified OrdersView + the
--    OrderDetailModal can hydrate the source funnel_order when clicking a
--    payment row (and dedupe funnel_order rows that already produced a
--    payments row). Nullable — legacy/manual payments don't have one.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES funnel_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_order_id
  ON payments(order_id) WHERE order_id IS NOT NULL;

COMMENT ON COLUMN payments.order_id IS
  'Back-pointer to funnel_orders.id when this payment was created by the funnel checkout flow. NULL for manual/legacy payments.';

-- 3) Allow cancelled status on funnel_orders (admin cancel-pending action)
ALTER TABLE funnel_orders DROP CONSTRAINT IF EXISTS funnel_orders_status_check;
ALTER TABLE funnel_orders ADD CONSTRAINT funnel_orders_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled'));

COMMENT ON COLUMN funnel_orders.status IS
  'pending = awaiting QR pay | paid = confirmed via SePay webhook | expired = past expires_at without payment | failed = webhook error | cancelled = admin cancelled from OrdersView.';
