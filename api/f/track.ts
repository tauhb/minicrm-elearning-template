// api/f/track.ts — Public tracking pixel endpoint
// POST /api/f/track { funnel_id, event_type: 'visit'|'cta_click'|'form_submit', extra?, referrer? }
// No auth required — public endpoint invoked from injected JS on funnel pages.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_EVENTS = ['visit', 'cta_click', 'form_submit']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { funnel_id, event_type, extra, referrer } = req.body || {}
  if (!funnel_id || !event_type) return res.status(400).json({ error: 'funnel_id + event_type required' })
  if (!VALID_EVENTS.includes(event_type)) return res.status(400).json({ error: 'invalid event_type' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Basic visitor_id: hash IP + user_agent (privacy-preserving fingerprint)
  const ua = (req.headers['user-agent'] as string) || ''
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string)
    || 'unknown'
  const visitorId = crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)

  // Parse UTM from referrer if present
  let utmSource, utmMedium, utmCampaign
  try {
    if (referrer) {
      const rurl = new URL(referrer)
      utmSource = rurl.searchParams.get('utm_source') || undefined
      utmMedium = rurl.searchParams.get('utm_medium') || undefined
      utmCampaign = rurl.searchParams.get('utm_campaign') || undefined
    }
  } catch {}

  // Insert event
  await admin.from('generated_funnel_events').insert({
    funnel_id, event_type, visitor_id: visitorId,
    user_agent: ua.slice(0, 500), referrer: (referrer || '').slice(0, 500),
    utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign,
    extra: extra || {},
  })

  // Increment denormalized counter (best-effort)
  const col = event_type === 'visit' ? 'visits' : event_type === 'cta_click' ? 'cta_clicks' : 'form_submits'
  // Postgres doesn't support ${col} directly in RPC, use raw SQL via RPC or update pattern
  // Simple approach: fetch + increment (race-prone but ok for MVP)
  const { data: current } = await admin.from('generated_funnels').select(col).eq('id', funnel_id).maybeSingle()
  if (current) {
    const newValue = (Number((current as any)[col]) || 0) + 1
    await admin.from('generated_funnels').update({ [col]: newValue }).eq('id', funnel_id)
  }

  return res.status(200).json({ ok: true })
}
