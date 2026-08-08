// api/admin/affiliates.ts
// Admin quản lý danh sách affiliate
// GET   /api/admin/affiliates          — list all
// POST  /api/admin/affiliates          — admin tạo affiliate trực tiếp cho customer
// PATCH /api/admin/affiliates          — approve / suspend / update commission

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
  return ['owner','admin'].includes(customer?.role || '') ? user.id : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getAdminClient()
  const adminId = await requireAdmin(req, supabase)
  if (!adminId) return res.status(403).json({ error: 'Forbidden' })

  // GET với ?affiliate_id= → preview dashboard của 1 affiliate cụ thể (cho admin xem)
  if (req.method === 'GET' && req.query.affiliate_id) {
    const affId = String(req.query.affiliate_id)
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('*')
      .eq('id', affId)
      .maybeSingle()
    if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' })

    const refcode = affiliate.referral_code
    const [
      { count: totalClicks },
      { count: totalConversions },
      { data: commissions },
      { data: payouts },
      { data: referredLeads },
      { data: conversions },
    ] = await Promise.all([
      supabase.from('affiliate_clicks').select('*', { count: 'exact', head: true }).eq('affiliate_id', affId),
      supabase.from('affiliate_conversions').select('*', { count: 'exact', head: true }).eq('affiliate_id', affId).eq('status', 'confirmed'),
      supabase.from('affiliate_commissions').select('commission_amount, payout_status, available_at').eq('affiliate_id', affId),
      supabase.from('affiliate_payouts').select('total_amount, status, paid_at, created_at').eq('affiliate_id', affId).order('created_at', { ascending: false }).limit(10),
      supabase.from('leads').select('id, name, email, source, created_at, converted_at, pipeline_stage_id, score').eq('utm_source', 'affiliate').eq('utm_campaign', refcode).order('created_at', { ascending: false }).limit(50),
      supabase.from('affiliate_conversions').select('id, sale_amount, status, converted_at, course:courses(title), product:products(name)').eq('affiliate_id', affId).order('converted_at', { ascending: false }).limit(20),
    ])

    const now = new Date()
    const pendingAmount   = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) > now).reduce((s, c) => s + c.commission_amount, 0)
    const availableAmount = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) <= now).reduce((s, c) => s + c.commission_amount, 0)
    const paidAmount      = (commissions || []).filter(c => c.payout_status === 'paid').reduce((s, c) => s + c.commission_amount, 0)
    const baseUrl = process.env.PORTAL_URL || 'http://localhost:5009'

    return res.json({
      affiliate: { id: affiliate.id, status: affiliate.status, referral_code: refcode, referral_url: `${baseUrl}/?ref=${refcode}`, commission_rate: affiliate.commission_rate, payout_method: affiliate.payout_method },
      stats: {
        total_clicks: totalClicks || 0,
        total_leads: (referredLeads || []).length,
        total_conversions: totalConversions || 0,
        conversion_rate: (referredLeads || []).length > 0 ? (((totalConversions || 0) / (referredLeads || []).length) * 100).toFixed(1) : '0',
        commissions: { pending: pendingAmount, available: availableAmount, paid: paidAmount },
      },
      referred_leads: (referredLeads || []).map(l => ({ ...l, is_converted: !!l.converted_at })),
      orders: (conversions || []).map((c: any) => ({ id: c.id, sale_amount: c.sale_amount, status: c.status, converted_at: c.converted_at, product_name: c.course?.title || c.product?.name || 'Sản phẩm' })),
      payouts: payouts || [],
      _preview: true, // marker để UI biết đây là admin preview mode
    })
  }

  // GET — list affiliates with stats
  if (req.method === 'GET') {
    const { data: affiliates, error } = await supabase
      .from('affiliates')
      .select(`
        *,
        customer:customers!affiliates_customer_id_fkey(id, email, display_name),
        lead:leads(id, name, email),
        clicks:affiliate_clicks(count),
        conversions:affiliate_conversions(count),
        commissions:affiliate_commissions(commission_amount, payout_status)
      `)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    const enriched = (affiliates || []).map((a: any) => {
      const comms = (a.commissions as any[]) || []
      return {
        ...a,
        customer: a.customer || (a.lead ? { id: null, email: a.lead.email, display_name: a.lead.name } : null),
        total_earned: comms.reduce((s: number, c: any) => s + (c.commission_amount || 0), 0),
        total_paid:   comms.filter((c: any) => c.payout_status === 'paid').reduce((s: number, c: any) => s + (c.commission_amount || 0), 0),
      }
    })

    // Stats tổng + orders từ tất cả affiliate
    const { data: allConversions } = await supabase
      .from('affiliate_conversions')
      .select('id, sale_amount, status, converted_at, affiliate_id, course:courses(title), product:products(name), customer:customers(email, display_name), affiliate:affiliates(display_name, referral_code)')
      .eq('status', 'confirmed')
      .order('converted_at', { ascending: false })

    const totalRevenue = (allConversions || []).reduce((s, c: any) => s + (c.sale_amount || 0), 0)
    const totalOrders  = (allConversions || []).length

    return res.json({
      affiliates: enriched,
      stats: { total_revenue: totalRevenue, total_orders: totalOrders },
      orders: (allConversions || []).map((c: any) => ({
        id: c.id,
        sale_amount: c.sale_amount,
        converted_at: c.converted_at,
        product_name:  c.course?.title || c.product?.name || 'Sản phẩm',
        customer_name: c.customer?.display_name || c.customer?.email || '—',
        customer_email: c.customer?.email || '—',
        affiliate_name: c.affiliate?.display_name || '—',
        affiliate_code: c.affiliate?.referral_code || '—',
      })),
    })
  }

  // POST — admin mời lead hoặc customer làm affiliate
  // Body: { lead_id } HOẶC { customer_id }, + optional commission_rate
  if (req.method === 'POST') {
    const { lead_id, customer_id, commission_rate } = req.body

    if (!lead_id && !customer_id) {
      return res.status(400).json({ error: 'lead_id hoặc customer_id là bắt buộc' })
    }

    // ── Case A: từ Lead (chưa là customer) ──────────────────────────
    if (lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id, name, email, refcode')
        .eq('id', lead_id)
        .maybeSingle()
      if (!lead) return res.status(404).json({ error: 'Lead not found' })

      // Check đã là affiliate chưa (theo lead_id)
      const { data: existingByLead } = await supabase
        .from('affiliates')
        .select('id, status, referral_code')
        .eq('lead_id', lead_id)
        .maybeSingle()
      if (existingByLead) {
        return res.status(409).json({ error: 'Lead đã là affiliate', affiliate: existingByLead })
      }

      // Dùng leads.refcode làm referral_code (đã unique từ DB trigger)
      const referral_code = lead.refcode!

      // Tạo hoặc lấy Supabase auth user cho lead
      let authUserId: string

      // Check user đã tồn tại chưa
      const { data: { users: existingUsers } } = await supabase.auth.admin.listUsers()
      const existingUser = existingUsers?.find((u: any) => u.email === lead.email)

      if (existingUser) {
        authUserId = existingUser.id
        // Update role thành 'affiliate' nếu chưa là customer/admin
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id, role')
          .eq('id', authUserId)
          .maybeSingle()
        if (!existingCustomer) {
          await supabase.from('customers').insert({
            id: authUserId,
            email: lead.email,
            display_name: lead.name,
            role: 'affiliate',
            payment_status: 'pending',
          })
        }
        // Nếu đã là customer (student), giữ nguyên role — họ có đủ quyền hơn affiliate
      } else {
        // Tạo user mới với role 'affiliate'
        const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
          email: lead.email,
          email_confirm: true,
          user_metadata: { display_name: lead.name },
        })
        if (createErr || !newUser?.user) {
          return res.status(500).json({ error: createErr?.message || 'Không tạo được user' })
        }
        authUserId = newUser.user.id

        // Tạo customers record với role='affiliate'
        await supabase.from('customers').insert({
          id: authUserId,
          email: lead.email,
          display_name: lead.name,
          role: 'affiliate',
          payment_status: 'pending',
        })
      }

      // Tạo affiliate record
      const { data: affiliate, error: affErr } = await supabase
        .from('affiliates')
        .insert({
          customer_id:     authUserId,
          lead_id,
          display_name:    lead.name,
          referral_code,
          commission_rate: commission_rate ?? 30,
          payout_method:   'bank_transfer',
          payout_details:  {},
          status:          'approved',
          approved_at:     new Date().toISOString(),
          approved_by:     adminId,
        })
        .select()
        .single()
      if (affErr) return res.status(500).json({ error: affErr.message })

      // Gửi magic link email để affiliate login
      const portalUrl = process.env.PORTAL_URL || process.env.VITE_SUPABASE_URL?.replace('.supabase.co', '.vercel.app') || ''
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: lead.email,
        options: { redirectTo: `${portalUrl}/affiliate` },
      })

      // Mark lead đã được converted (có account)
      await supabase.from('leads')
        .update({ converted_to: authUserId, converted_at: new Date().toISOString() })
        .eq('id', lead_id)

      return res.status(201).json({
        affiliate,
        referral_url: `/?ref=${referral_code}`,
        message: `Magic link đã gửi tới ${lead.email}`,
      })
    }

    // ── Case B: từ Customer đã có sẵn ────────────────────────────────
    const { data: customer } = await supabase
      .from('customers')
      .select('id, display_name, email')
      .eq('id', customer_id)
      .maybeSingle()
    if (!customer) return res.status(404).json({ error: 'Customer not found' })

    const { data: existingByCust } = await supabase
      .from('affiliates')
      .select('id, status')
      .eq('customer_id', customer_id)
      .maybeSingle()
    if (existingByCust) {
      return res.status(409).json({ error: 'Đã là affiliate', affiliate: existingByCust })
    }

    // Tìm lead tương ứng (nếu có) để lấy refcode
    const { data: matchedLead } = await supabase
      .from('leads')
      .select('id, refcode')
      .eq('email', customer.email)
      .maybeSingle()

    // Dùng leads.refcode nếu có, fallback generate mới
    let referral_code = matchedLead?.refcode || ''
    if (!referral_code) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      for (let i = 0; i < 5; i++) {
        referral_code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        const { data: conflict } = await supabase.from('affiliates').select('id').eq('referral_code', referral_code).maybeSingle()
        if (!conflict) break
      }
    }

    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .insert({
        customer_id,
        lead_id:         matchedLead?.id || null,
        display_name:    customer.display_name,
        referral_code,
        commission_rate: commission_rate ?? 30,
        payout_method:   'bank_transfer',
        payout_details:  {},
        status:          'approved',
        approved_at:     new Date().toISOString(),
        approved_by:     adminId,
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ affiliate, referral_url: `/?ref=${referral_code}` })
  }

  // PATCH — update affiliate status or commission rate
  if (req.method === 'PATCH') {
    const { id, status, commission_rate, payout_method, payout_details } = req.body

    if (!id) return res.status(400).json({ error: 'id required' })

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (status) {
      if (!['approved', 'suspended', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      updates.status = status
      if (status === 'approved') {
        updates.approved_at = new Date().toISOString()
        updates.approved_by = adminId
      }
    }
    if (commission_rate !== undefined) updates.commission_rate = commission_rate
    if (payout_method)  updates.payout_method  = payout_method
    if (payout_details) updates.payout_details = payout_details

    const { data, error } = await supabase
      .from('affiliates')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ affiliate: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
