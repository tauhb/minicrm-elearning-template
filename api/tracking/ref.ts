// api/tracking/ref.ts
// Record affiliate click khi visitor landing với ?ref=CODE
// GET /api/tracking/ref?code=REFCODE
// Frontend gọi endpoint này, lưu click_id vào localStorage

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const code = (req.query.code as string || '').toUpperCase().trim()
  if (!code) return res.status(400).json({ error: 'Missing ref code' })

  const supabase = getAdminClient()

  // Validate referral code
  const { data: affiliate, error } = await supabase
    .from('affiliates')
    .select('id, status')
    .eq('referral_code', code)
    .maybeSingle()

  if (error || !affiliate) {
    return res.status(404).json({ error: 'Invalid referral code' })
  }

  if (affiliate.status !== 'approved') {
    return res.status(403).json({ error: 'Affiliate not active' })
  }

  // Generate unique click_id
  const clickId = randomUUID()

  // Record click
  await supabase.from('affiliate_clicks').insert({
    affiliate_id: affiliate.id,
    click_id:     clickId,
    visitor_ip:   Array.isArray(req.headers['x-forwarded-for'])
                    ? req.headers['x-forwarded-for'][0]
                    : req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    user_agent:   req.headers['user-agent'],
    referrer:     req.headers['referer'],
    landing_url:  req.headers['referer'],
  })

  return res.status(200).json({
    click_id:      clickId,
    referral_code: code,
    expires_in:    30 * 24 * 60 * 60, // 30 days in seconds
  })
}
