// api/f/upsell.ts — Handle YES click on upsell page: create child order + return SePay QR.
//   POST /api/f/upsell?action=accept
//   Body: { funnel_id, step_id, parent_order_id }
// Verifies parent order is paid + belongs to same funnel, then creates a child
// funnel_orders row for the upsell add-on with its own reference code + QR.
// The upsell page shows the returned QR in a modal and polls /api/f/order-status.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { buildQrUrl, generateReferenceCode, PaymentConfig } from '../../services/sepay'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action') || 'accept'

  const body = req.body || {}
  const { funnel_id, step_id, parent_order_id } = body
  if (!funnel_id || !step_id || !parent_order_id) {
    return res.status(400).json({ error: 'funnel_id, step_id, parent_order_id required' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  if (action !== 'accept') return res.status(400).json({ error: `Unknown action: ${action}` })

  // Verify parent order paid + belongs to this funnel
  const { data: parent } = await admin.from('funnel_orders')
    .select('id, status, funnel_id, customer_snapshot').eq('id', parent_order_id).maybeSingle()
  if (!parent) return res.status(404).json({ error: 'Parent order not found' })
  if (parent.funnel_id !== funnel_id) return res.status(403).json({ error: 'Parent order belongs to different funnel' })
  if (parent.status !== 'paid') return res.status(403).json({ error: 'Parent order chưa thanh toán' })

  // Load upsell step + assigned product + funnel's SePay config
  const { data: step } = await admin.from('funnel_steps')
    .select('id, page_type, assigned_product_id, price_override, upsell_config').eq('id', step_id).maybeSingle()
  if (!step) return res.status(404).json({ error: 'Step not found' })
  if (step.page_type !== 'upsell') return res.status(400).json({ error: 'Step is not an upsell page' })

  const { data: flow } = await admin.from('funnel_flows')
    .select('id, slug, payment_mode, payment_config').eq('id', funnel_id).maybeSingle()
  if (!flow) return res.status(404).json({ error: 'Funnel not found' })
  if (flow.payment_mode !== 'inline_qr' || !(flow.payment_config as any)?.account_number) {
    return res.status(400).json({ error: 'Funnel chưa cấu hình SePay inline_qr' })
  }

  // Resolve upsell price: price_override > product.price
  let upsellAmount = 0
  let productSnapshot: any = null
  if (step.price_override != null) {
    upsellAmount = Number(step.price_override) || 0
  }
  if ((!upsellAmount || upsellAmount <= 0) && step.assigned_product_id) {
    const { data: prod } = await admin.from('products').select('id, name, price').eq('id', step.assigned_product_id).maybeSingle()
    if (prod) {
      productSnapshot = { id: prod.id, name: prod.name, price: prod.price }
      if (!upsellAmount || upsellAmount <= 0) upsellAmount = Number(prod.price) || 0
    }
  }
  if (upsellAmount <= 0) return res.status(400).json({ error: 'Upsell chưa cấu hình sản phẩm hoặc giá' })

  const cfg = flow.payment_config as PaymentConfig
  const referenceCode = generateReferenceCode((cfg.order_prefix || 'FN') + 'UP')
  const qrUrl = buildQrUrl(cfg, upsellAmount, referenceCode)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)   // 30 min

  const { data: order, error } = await admin.from('funnel_orders').insert({
    funnel_id, step_id,
    parent_order_id,
    order_kind: 'upsell',
    reference_code: referenceCode,
    amount: upsellAmount,
    currency: 'VND',
    status: 'pending',
    bank_snapshot: {
      bank_name: cfg.bank_name, bank_bin: cfg.bank_bin,
      account_number: cfg.account_number, account_holder: cfg.account_holder,
    },
    customer_snapshot: parent.customer_snapshot,  // Reuse buyer info from parent order
    product_snapshot: productSnapshot,
    qr_url: qrUrl,
    expires_at: expiresAt.toISOString(),
  }).select('id, reference_code, amount, qr_url, expires_at').single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({
    order_id: order.id,
    reference_code: order.reference_code,
    amount: order.amount,
    qr_url: order.qr_url,
    expires_at: order.expires_at,
  })
}
