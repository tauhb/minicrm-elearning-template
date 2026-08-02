// api/capture-lead.ts — Vercel Serverless Function
// Captures leads from landing page opt-in forms
// URL: https://your-portal.vercel.app/api/capture-lead
//
// Usage from landing page:
// fetch('https://your-portal.vercel.app/api/capture-lead', {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json' },
//   body: JSON.stringify({
//     name: 'Nguyen Van A',
//     email: 'user@email.com',
//     phone: '0901234567',
//     source: 'landing_page',
//     utm_source: new URLSearchParams(location.search).get('utm_source'),
//     utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
//     utm_medium: new URLSearchParams(location.search).get('utm_medium'),
//     page_url: location.href,
//   })
// })

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).json({})

  res.setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'])
  res.setHeader('Access-Control-Allow-Headers', corsHeaders['Access-Control-Allow-Headers'])

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getAdminClient()

  try {
    const {
      name, email, phone,
      source = 'landing_page',
      utm_medium, utm_term, utm_content,
      page_url,
      ref, // affiliate referral code — funnel gửi khi URL có ?ref=CODE
    } = req.body || {}

    if (!email) return res.status(400).json({ error: 'Email is required' })

    // Affiliate ref attribution: ?ref=CODE → lookup leads.refcode
    // refcode thuộc về lead người giới thiệu — lưu vào utm để webhook biết
    let utm_source   = req.body?.utm_source   || null
    let utm_campaign = req.body?.utm_campaign || null

    if (ref) {
      const refCode = String(ref).toUpperCase().trim()
      // Lookup theo leads.refcode (ưu tiên) hoặc affiliates.referral_code (legacy)
      const { data: refLead } = await supabase
        .from('leads')
        .select('id, refcode')
        .eq('refcode', refCode)
        .maybeSingle()

      if (refLead) {
        utm_source   = 'affiliate'
        utm_campaign = refCode // leads.refcode = affiliate code
      } else {
        // Fallback: cũ — check affiliates table trực tiếp
        const { data: aff } = await supabase
          .from('affiliates')
          .select('id, referral_code')
          .eq('referral_code', refCode)
          .eq('status', 'approved')
          .maybeSingle()
        if (aff) {
          utm_source   = 'affiliate'
          utm_campaign = refCode
        }
      }
    }

    // Check duplicate email
    const { data: existing } = await supabase
      .from('leads')
      .select('id, name')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (existing) {
      // Lead already exists — just log the visit
      await supabase.from('care_history').insert({
        lead_id: existing.id,
        type: 'note',
        content: `Truy cập lại form${page_url ? ` từ ${page_url}` : ''}`,
      })
      return res.json({ success: true, lead_id: existing.id, existing: true })
    }

    // Get first pipeline stage
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('id')
      .order('order_index', { ascending: true })
      .limit(1)
    const firstStageId = stages?.[0]?.id || null

    // Create lead
    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        name: name || email.split('@')[0],
        email: email.toLowerCase().trim(),
        phone: phone || null,
        source,
        utm_source:   utm_source   || null,
        utm_campaign: utm_campaign || null,
        utm_medium:   utm_medium   || null,
        utm_term:     utm_term     || null,
        utm_content:  utm_content  || null,
        pipeline_stage_id: firstStageId,
        score: 10, // initial score
      })
      .select()
      .single()

    if (error) throw error

    // Log care_history — lead mới
    const sourceLabel: Record<string, string> = {
      landing_page: 'Landing page',
      facebook_ad: 'Quảng cáo Facebook',
      referral: 'Giới thiệu',
      organic: 'Tìm kiếm tự nhiên',
    }
    await supabase.from('care_history').insert({
      lead_id: lead.id,
      type: 'note',
      content: `Lead mới từ ${sourceLabel[source] || source}${utm_campaign ? ` — Campaign: ${utm_campaign}` : ''}${page_url ? ` — Trang: ${page_url}` : ''}`,
    })

    // refcode được DB trigger tự generate — trả về để funnel có thể dùng
    return res.json({ success: true, lead_id: lead.id, existing: false, refcode: lead.refcode || null })

  } catch (err: any) {
    console.error('capture-lead error:', err)
    return res.status(500).json({ error: err.message })
  }
}
