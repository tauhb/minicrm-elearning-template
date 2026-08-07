// api/funnels/generate.ts — Generate or iterate a funnel's HTML with AI
// POST /api/funnels/generate (admin only)
// Body: {
//   funnel_id?: string,          // if updating existing
//   type: 'sales' | 'leads' | 'webinar',
//   input: {...FunnelCopyInput},
//   iteration_instruction?: string,  // if iterating: "đổi màu CTA thành xanh"
//   provider?: 'openai-codex',
//   model?: string,
// }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateFunnelHtml, injectTrackingPixel, FunnelType } from '../../services/funnel-generator'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (caller?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })

  const { funnel_id, type, input, iteration_instruction, provider, model } = req.body || {}
  if (!type || !['sales', 'leads', 'webinar'].includes(type)) {
    return res.status(400).json({ error: 'type must be sales, leads, or webinar' })
  }
  if (!input) return res.status(400).json({ error: 'input required' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // If iterating, fetch previous HTML
    let previousHtml: string | undefined
    if (funnel_id && iteration_instruction) {
      const { data: existing } = await admin.from('generated_funnels')
        .select('html').eq('id', funnel_id).maybeSingle()
      previousHtml = existing?.html || undefined
    }

    // Generate
    const { html, meta } = await generateFunnelHtml({
      type: type as FunnelType,
      input,
      provider,
      model,
      iterationInstruction: iteration_instruction,
      previousHtml,
    })

    return res.json({
      html,
      meta,
      // Client saves via /save endpoint after preview review
    })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
