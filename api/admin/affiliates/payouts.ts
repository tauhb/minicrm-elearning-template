// api/admin/affiliates/payouts.ts
// Admin xem và xử lý payout cho affiliates
// GET  /api/admin/affiliates/payouts              — list pending commissions
// POST /api/admin/affiliates/payouts              — tạo payout batch cho 1 affiliate
// PATCH /api/admin/affiliates/payouts             — mark payout as completed

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function requireAdmin(req: VercelRequest, supabase: ReturnType<typeof getAdminClient>): Promise<string | null> {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const anonClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user } } = await anonClient.auth.getUser()
  if (!user) return null
  const { data: customer } = await supabase.from('customers').select('role').eq('id', user.id).maybeSingle()
  return customer?.role === 'admin' ? user.id : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getAdminClient()
  const adminId = await requireAdmin(req, supabase)
  if (!adminId) return res.status(403).json({ error: 'Forbidden' })

  // GET — commissions available for payout (qua 30 ngày hold)
  if (req.method === 'GET') {
    const now = new Date().toISOString()

    const { data: commissions } = await supabase
      .from('affiliate_commissions')
      .select(`
        *,
        affiliate:affiliates(id, display_name, referral_code, payout_method, payout_details,
          customer:customers(email))
      `)
      .eq('payout_status', 'pending')
      .lte('available_at', now)
      .order('available_at', { ascending: true })

    // Group by affiliate
    const byAffiliate: Record<string, any> = {}
    for (const c of commissions || []) {
      const aid = (c.affiliate as any).id
      if (!byAffiliate[aid]) {
        byAffiliate[aid] = {
          affiliate:   c.affiliate,
          commissions: [],
          total:       0,
        }
      }
      byAffiliate[aid].commissions.push(c)
      byAffiliate[aid].total += c.commission_amount
    }

    const { data: existingPayouts } = await supabase
      .from('affiliate_payouts')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    return res.json({
      available_by_affiliate: Object.values(byAffiliate),
      pending_payouts: existingPayouts || [],
    })
  }

  // POST — tạo payout batch cho 1 affiliate
  if (req.method === 'POST') {
    const { affiliate_id, commission_ids, notes } = req.body

    if (!affiliate_id || !commission_ids?.length) {
      return res.status(400).json({ error: 'affiliate_id and commission_ids required' })
    }

    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('*')
      .eq('id', affiliate_id)
      .single()

    if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' })

    // Fetch commissions
    const { data: comms } = await supabase
      .from('affiliate_commissions')
      .select('*')
      .in('id', commission_ids)
      .eq('affiliate_id', affiliate_id)
      .eq('payout_status', 'pending')

    if (!comms?.length) return res.status(400).json({ error: 'No eligible commissions' })

    const total = comms.reduce((s, c) => s + c.commission_amount, 0)
    const dates = comms.map(c => new Date(c.earned_at)).sort((a, b) => a.getTime() - b.getTime())

    // Create payout record
    const { data: payout, error: payoutErr } = await supabase
      .from('affiliate_payouts')
      .insert({
        affiliate_id,
        period_start:     dates[0].toISOString().split('T')[0],
        period_end:       dates[dates.length - 1].toISOString().split('T')[0],
        commission_count: comms.length,
        total_amount:     total,
        payout_method:    affiliate.payout_method,
        payout_details:   affiliate.payout_details,
        status:           'pending',
        notes,
        approved_by:      adminId,
        approved_at:      new Date().toISOString(),
      })
      .select()
      .single()

    if (payoutErr) return res.status(500).json({ error: payoutErr.message })

    // Link commissions → payout
    await supabase
      .from('affiliate_commissions')
      .update({ payout_id: payout.id, payout_status: 'approved' })
      .in('id', commission_ids)

    return res.status(201).json({ payout, commission_count: comms.length, total_vnd: total })
  }

  // PATCH — mark payout completed (sau khi chuyển tiền thực tế)
  if (req.method === 'PATCH') {
    const { payout_id, payout_reference, status } = req.body

    if (!payout_id) return res.status(400).json({ error: 'payout_id required' })

    const updates: Record<string, any> = {}
    if (status === 'completed') {
      updates.status            = 'completed'
      updates.paid_at           = new Date().toISOString()
      updates.payout_reference  = payout_reference

      // Mark commissions as paid
      await supabase
        .from('affiliate_commissions')
        .update({ payout_status: 'paid', paid_at: new Date().toISOString() })
        .eq('payout_id', payout_id)
    } else if (status === 'failed') {
      updates.status = 'failed'
      updates.notes  = req.body.notes

      // Revert commissions to pending
      await supabase
        .from('affiliate_commissions')
        .update({ payout_status: 'pending', payout_id: null })
        .eq('payout_id', payout_id)
    }

    const { data, error } = await supabase
      .from('affiliate_payouts')
      .update(updates)
      .eq('id', payout_id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ payout: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
