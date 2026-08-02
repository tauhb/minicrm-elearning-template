// api/webhook/lead.ts — Vercel Serverless Function
// Nhận lead từ landing page / phễu bán hàng bên ngoài
//
// POST https://your-portal.vercel.app/api/webhook/lead
// Header: X-Webhook-Secret: <secret>
// Body:
//   { name, email, phone?, source?, utm_source?, utm_campaign?,
//     utm_medium?, utm_term?, utm_content?, tags?, notes?, page_url? }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Mirror sang Google Sheets nếu được cấu hình — fire-and-forget, không block
const mirrorToSheets = (payload: Record<string, unknown>) => {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!url) return
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
  }).catch(err => console.warn('[mirror-sheets]', err?.message))
}

const adminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const db = adminClient()

  // ── Xác thực secret ──────────────────────────────────────────────────────
  const incoming = req.headers['x-webhook-secret'] as string | undefined
  const { data: secretRow } = await db
    .from('app_settings').select('value').eq('key', 'webhook_secret').maybeSingle()
  const expected = process.env.WEBHOOK_SECRET || (secretRow?.value as any)?.value || ''

  if (!expected || incoming !== expected) {
    await db.from('webhook_events').insert({
      source: 'webhook_lead', payload: req.body || {}, processed: false, error: 'Invalid secret',
    })
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  const {
    name, email, phone,
    source = 'landing_page',
    utm_source, utm_campaign, utm_medium, utm_term, utm_content,
    tags = [], notes, page_url,
  } = req.body || {}

  if (!email) return res.status(400).json({ error: 'email là bắt buộc' })
  const emailLower = (email as string).trim().toLowerCase()

  // ── Log event ─────────────────────────────────────────────────────────────
  const { data: evt } = await db.from('webhook_events')
    .insert({ source: 'webhook_lead', payload: req.body, processed: false })
    .select('id').single()
  const evtId = evt?.id

  const markDone = (error?: string) =>
    evtId && db.from('webhook_events')
      .update({ processed: !error, error: error || null }).eq('id', evtId)

  try {
    // ── Dedup theo email ────────────────────────────────────────────────────
    const { data: existing } = await db.from('leads')
      .select('id, tags').eq('email', emailLower).maybeSingle()

    if (existing) {
      // Merge tags nếu có
      if (tags?.length) {
        const merged = [...new Set([...(existing.tags || []), ...tags])]
        await db.from('leads').update({ tags: merged }).eq('id', existing.id)
      }
      if (page_url) {
        await db.from('care_history').insert({
          lead_id: existing.id, type: 'note',
          content: `Truy cập lại form${page_url ? ` từ ${page_url}` : ''}`,
        })
      }
      await markDone()
      mirrorToSheets({ name, email: emailLower, phone, source, utm_source, utm_campaign, utm_medium })
      return res.json({ success: true, lead_id: existing.id, existing: true })
    }

    // ── Stage đầu tiên ──────────────────────────────────────────────────────
    const { data: stages } = await db.from('pipeline_stages')
      .select('id').order('order_index', { ascending: true }).limit(1)

    // ── Tạo lead ────────────────────────────────────────────────────────────
    const { data: lead, error } = await db.from('leads').insert({
      name:         name || emailLower.split('@')[0],
      email:        emailLower,
      phone:        phone || null,
      source,
      utm_source:   utm_source   || null,
      utm_campaign: utm_campaign || null,
      utm_medium:   utm_medium   || null,
      utm_term:     utm_term     || null,
      utm_content:  utm_content  || null,
      tags:         Array.isArray(tags) ? tags : [],
      notes:        notes || null,
      pipeline_stage_id: stages?.[0]?.id || null,
      score: 10,
    }).select().single()

    if (error) throw error

    await db.from('care_history').insert({
      lead_id: lead.id, type: 'note',
      content: `Lead mới qua webhook${utm_campaign ? ` — ${utm_campaign}` : ''}${page_url ? ` — ${page_url}` : ''}`,
    })

    await markDone()
    mirrorToSheets({ name: lead.name, email: emailLower, phone, source, utm_source, utm_campaign, utm_medium })
    return res.json({ success: true, lead_id: lead.id, existing: false })
  } catch (err: any) {
    await markDone(err.message)
    return res.status(500).json({ error: err.message })
  }
}
