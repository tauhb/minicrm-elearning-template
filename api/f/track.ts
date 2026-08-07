// api/f/track.ts — Public tracking endpoint
// POST /api/f/track { funnel_id, step_id, event_type, extra?, referrer? }
// Called from injected JS in rendered funnel pages.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID = ['visit', 'cta_click', 'form_submit']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { funnel_id, step_id, event_type, extra, referrer } = req.body || {}
  if (!funnel_id || !step_id || !VALID.includes(event_type)) {
    return res.status(400).json({ error: 'invalid input' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const ua = (req.headers['user-agent'] as string) || ''
  const ip = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || 'unknown'
  const visitorId = crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)

  await admin.from('funnel_step_events').insert({
    funnel_id, step_id, event_type,
    visitor_id: visitorId,
    user_agent: ua.slice(0, 500),
    referrer: (referrer || '').slice(0, 500),
    extra: extra || {},
  })

  const col = event_type === 'visit' ? 'visits' : event_type === 'cta_click' ? 'cta_clicks' : 'form_submits'
  const { data: current } = await admin.from('funnel_steps').select(col).eq('id', step_id).maybeSingle()
  if (current) {
    await admin.from('funnel_steps').update({ [col]: (Number((current as any)[col]) || 0) + 1 }).eq('id', step_id)
  }

  return res.status(200).json({ ok: true })
}
