// api/affiliates/dashboard.ts
// Affiliate xem stats + leads họ giới thiệu + đơn hàng
// GET /api/affiliates/dashboard
// Auth: Bearer token

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const getUserClient = (token: string) => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!,
  { global: { headers: { Authorization: `Bearer ${token}` } } }
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const userClient = getUserClient(token)
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const supabase = getAdminClient()

  const { data: affiliate } = await supabase
    .from('affiliates')
    .select('*')
    .eq('customer_id', user.id)
    .maybeSingle()

  if (!affiliate) return res.status(404).json({ error: 'Not an affiliate' })

  const refcode = affiliate.referral_code // = leads.refcode của người này

  // Load song song: clicks, conversions, commissions, payouts, referred leads, orders, funnels
  const [
    { count: totalClicks },
    { count: totalConversions },
    { data: commissions },
    { data: payouts },
    { data: referredLeads },
    { data: conversions },
    { data: funnels },
  ] = await Promise.all([
    supabase
      .from('affiliate_clicks')
      .select('*', { count: 'exact', head: true })
      .eq('affiliate_id', affiliate.id),

    supabase
      .from('affiliate_conversions')
      .select('*', { count: 'exact', head: true })
      .eq('affiliate_id', affiliate.id)
      .eq('status', 'confirmed'),

    supabase
      .from('affiliate_commissions')
      .select('commission_amount, payout_status, available_at')
      .eq('affiliate_id', affiliate.id),

    supabase
      .from('affiliate_payouts')
      .select('total_amount, status, paid_at, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(10),

    // Leads được giới thiệu bởi affiliate này (utm_campaign = refcode)
    supabase
      .from('leads')
      .select('id, name, email, source, created_at, converted_at, pipeline_stage_id, score')
      .eq('utm_source', 'affiliate')
      .eq('utm_campaign', refcode)
      .order('created_at', { ascending: false })
      .limit(50),

    // Đơn hàng/conversions chi tiết
    supabase
      .from('affiliate_conversions')
      .select(`
        id, sale_amount, status, converted_at,
        course:courses(title),
        product:products(name)
      `)
      .eq('affiliate_id', affiliate.id)
      .order('converted_at', { ascending: false })
      .limit(20),

    // Funnels active để affiliate share
    supabase
      .from('funnels')
      .select('id, slug, name, description, url, type')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  const now = new Date()
  const pendingAmount   = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) > now).reduce((s, c) => s + c.commission_amount, 0)
  const availableAmount = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) <= now).reduce((s, c) => s + c.commission_amount, 0)
  const paidAmount      = (commissions || []).filter(c => c.payout_status === 'paid').reduce((s, c) => s + c.commission_amount, 0)

  const baseUrl = process.env.PORTAL_URL || 'https://your-portal.vercel.app'

  return res.json({
    affiliate: {
      id:              affiliate.id,
      status:          affiliate.status,
      referral_code:   refcode,
      referral_url:    `${baseUrl}/?ref=${refcode}`,
      commission_rate: affiliate.commission_rate,
      payout_method:   affiliate.payout_method,
    },
    stats: {
      total_clicks:       totalClicks || 0,
      total_leads:        (referredLeads || []).length,
      total_conversions:  totalConversions || 0,
      conversion_rate:    (referredLeads || []).length > 0
        ? (((totalConversions || 0) / (referredLeads || []).length) * 100).toFixed(1)
        : '0',
      commissions: {
        pending:   pendingAmount,   // hold 30 ngày
        available: availableAmount, // sẵn sàng rút
        paid:      paidAmount,
      },
    },
    referred_leads: (referredLeads || []).map(l => ({
      ...l,
      is_converted: !!l.converted_at,
    })),
    orders: (conversions || []).map((c: any) => ({
      id:            c.id,
      sale_amount:   c.sale_amount,
      status:        c.status,
      converted_at:  c.converted_at,
      product_name:  c.course?.title || c.product?.name || 'Sản phẩm',
    })),
    payouts: payouts || [],
    funnels: (funnels || []).map(f => ({
      id:           f.id,
      slug:         f.slug,
      name:         f.name,
      description:  f.description,
      type:         f.type,
      url:          f.url,
      share_url:    `${f.url}/?ref=${refcode}`,
    })),
  })
}
