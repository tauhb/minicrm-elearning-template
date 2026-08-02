// api/affiliates/register.ts
// Customer đăng ký tham gia affiliate program
// POST /api/affiliates/register
// Body: { display_name, bio?, payout_method, payout_details }
// Auth: Bearer token (Supabase JWT)

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

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const userClient = getUserClient(token)
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const supabase = getAdminClient()

  // Check đã là affiliate chưa
  const { data: existing } = await supabase
    .from('affiliates')
    .select('id, status')
    .eq('customer_id', user.id)
    .maybeSingle()

  if (existing) {
    return res.status(409).json({
      error: 'Already registered',
      status: existing.status,
      affiliate_id: existing.id,
    })
  }

  const { display_name, bio, payout_method, payout_details } = req.body

  if (!display_name) return res.status(400).json({ error: 'display_name required' })

  // Generate unique referral code
  let referral_code = generateCode()
  let attempts = 0
  while (attempts < 5) {
    const { data: conflict } = await supabase
      .from('affiliates')
      .select('id')
      .eq('referral_code', referral_code)
      .maybeSingle()
    if (!conflict) break
    referral_code = generateCode()
    attempts++
  }

  const { data: affiliate, error } = await supabase
    .from('affiliates')
    .insert({
      customer_id:    user.id,
      display_name,
      bio,
      referral_code,
      payout_method:  payout_method || 'bank_transfer',
      payout_details: payout_details || {},
      status:         'pending',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(201).json({
    message: 'Đăng ký thành công. Vui lòng chờ admin phê duyệt.',
    affiliate,
  })
}
