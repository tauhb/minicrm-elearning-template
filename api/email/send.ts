// api/email/send.ts — External email endpoint for funnels / integrations
// POST /api/email/send
// Header: X-Webhook-Secret: <secret>
// Body: { to, subject, template, data, from?, replyTo? }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, EmailTemplate } from '../../services/email'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_TEMPLATES: EmailTemplate[] = [
  'welcome-magic-link', 'welcome-credentials', 'password-reset',
  'enrollment', 'payment-confirmation', 'certificate', 'broadcast'
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth via webhook secret ──────────────────────────────────────────────
  const db = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const incoming = req.headers['x-webhook-secret'] as string | undefined
  const { data: secretRow } = await db
    .from('app_settings').select('value').eq('key', 'webhook_secret').maybeSingle()
  const expected = process.env.WEBHOOK_SECRET || (secretRow?.value as any)?.value || ''
  if (!expected || incoming !== expected) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  // ── Validate input ───────────────────────────────────────────────────────
  const { to, subject, template, data, from, replyTo } = req.body || {}
  if (!to) return res.status(400).json({ error: '`to` is required' })
  if (!subject) return res.status(400).json({ error: '`subject` is required' })
  if (!template) return res.status(400).json({ error: '`template` is required' })
  if (!VALID_TEMPLATES.includes(template)) {
    return res.status(400).json({ error: `Invalid template. Valid: ${VALID_TEMPLATES.join(', ')}` })
  }

  const result = await sendEmail({
    to, subject, template,
    data: data || {},
    from, replyTo,
  })

  if (!result.ok) {
    return res.status(500).json({ error: result.error, provider: result.provider })
  }
  return res.json({ success: true, id: result.id, provider: result.provider })
}
