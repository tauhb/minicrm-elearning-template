// api/f/order-status.ts — Poll payment status
// GET /api/f/order-status?order=<order_id>
// Returns {status: 'pending'|'paid'|'expired'|'failed', next_url?}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const url = new URL(req.url || '', 'http://localhost')
  const orderId = url.searchParams.get('order')
  if (!orderId) return res.status(400).json({ error: 'order required' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: order } = await admin.from('funnel_orders')
    .select('id, status, expires_at, paid_at, funnel_id, step_id')
    .eq('id', orderId).maybeSingle()

  if (!order) return res.status(404).json({ error: 'Order not found' })

  // Auto-expire if past deadline and still pending
  let status = order.status
  if (status === 'pending' && order.expires_at && new Date(order.expires_at) < new Date()) {
    await admin.from('funnel_orders').update({ status: 'expired' }).eq('id', orderId)
    status = 'expired'
  }

  return res.status(200).json({
    status,
    paid_at: order.paid_at,
    expires_at: order.expires_at,
  })
}
