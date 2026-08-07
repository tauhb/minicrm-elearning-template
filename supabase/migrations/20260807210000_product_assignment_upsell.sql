-- 014_product_assignment_and_upsell.sql
-- Product assignment for order/upsell steps + upsell child-order linkage
--
-- Rationale:
--   Previously, price for the order step came from funnel_flows.payment_config.fixed_amount.
--   This forces one price per funnel and no product linkage.
--   New model: each order/upsell step can be assigned a product from the shop, with an
--   optional per-step price override (e.g. "sale price for this funnel").
--
-- Upsell:
--   funnel_orders.parent_order_id links an upsell/add-on order back to the base order.
--   Combined with a paid parent, this is what lets the upsell page verify eligibility.

ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS assigned_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_override BIGINT,                -- VND. NULL = use product's native price
  ADD COLUMN IF NOT EXISTS upsell_config JSONB DEFAULT '{}'::jsonb;
  -- upsell_config shape (upsell steps only):
  --   { "description": "Bổ sung khoá học nâng cao",
  --     "addon_note": "Chỉ 297k thay vì 597k",
  --     "success_step_slug": "thank-you",       // where to send after upsell paid or skipped
  --     "skip_label": "Cảm ơn, chỉ cần đơn hàng này",
  --     "accept_label": "CÓ, tôi lấy thêm ưu đãi này" }

CREATE INDEX IF NOT EXISTS idx_funnel_steps_assigned_product
  ON funnel_steps(assigned_product_id) WHERE assigned_product_id IS NOT NULL;

ALTER TABLE funnel_orders
  ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES funnel_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_kind TEXT DEFAULT 'base' CHECK (order_kind IN ('base', 'upsell')),
  ADD COLUMN IF NOT EXISTS product_snapshot JSONB;  -- {id, name, price} of product sold, for reporting

CREATE INDEX IF NOT EXISTS idx_funnel_orders_parent
  ON funnel_orders(parent_order_id) WHERE parent_order_id IS NOT NULL;

COMMENT ON COLUMN funnel_steps.assigned_product_id IS 'Product from shop attached to this order/upsell step. Price defaults to products.price; override with price_override.';
COMMENT ON COLUMN funnel_steps.price_override IS 'VND. When set, wins over products.price for this step (per-funnel promotional pricing).';
COMMENT ON COLUMN funnel_orders.parent_order_id IS 'Upsell/add-on orders point back to the base order. Base orders leave this NULL.';
COMMENT ON COLUMN funnel_orders.order_kind IS 'base = paid before upsell shown, upsell = created when user clicks YES on upsell page.';
