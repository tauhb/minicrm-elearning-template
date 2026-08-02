// api/email/broadcast.ts — Broadcast email to multiple recipients (admin only)
// POST /api/email/broadcast
// Header: Authorization: Bearer <userToken>
// Body: {
//   audience: 'all-students' | 'course' | 'custom',
//   course_id?: string,             // if audience='course'
//   emails?: string[],              // if audience='custom'
//   subject: string,
//   body: string,                   // HTML or markdown-ish
//   ctaUrl?: string,
//   ctaText?: string,
//   template?: 'broadcast'          // default
// }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '../../services/email'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RATE_LIMIT_PER_BATCH = 10
const SLEEP_MS = 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth: admin only ─────────────────────────────────────────────────────
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

  const { data: caller } = await userClient
    .from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || caller.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' })
  }

  // ── Validate input ───────────────────────────────────────────────────────
  const { audience, course_id, emails, subject, body, ctaUrl, ctaText } = req.body || {}
  if (!audience) return res.status(400).json({ error: '`audience` required' })
  if (!subject) return res.status(400).json({ error: '`subject` required' })
  if (!body) return res.status(400).json({ error: '`body` required' })

  // ── Resolve recipients ───────────────────────────────────────────────────
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let recipients: Array<{ email: string; name: string }> = []

  if (audience === 'all-students') {
    const { data } = await admin.from('customers')
      .select('email, display_name').eq('role', 'student').not('email', 'is', null)
    recipients = (data || []).map((r: any) => ({ email: r.email, name: r.display_name || r.email.split('@')[0] }))
  } else if (audience === 'course') {
    if (!course_id) return res.status(400).json({ error: 'course_id required for audience=course' })
    const { data } = await admin.from('customer_courses')
      .select('customers!inner(email, display_name)').eq('course_id', course_id).eq('status', 'active')
    recipients = (data || []).map((r: any) => ({
      email: r.customers.email,
      name: r.customers.display_name || r.customers.email.split('@')[0]
    }))
  } else if (audience === 'custom') {
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails[] required for audience=custom' })
    }
    recipients = emails.map((e: string) => ({ email: e, name: e.split('@')[0] }))
  } else {
    return res.status(400).json({ error: `Unknown audience: ${audience}` })
  }

  if (recipients.length === 0) {
    return res.json({ success: true, sent: 0, failed: 0, message: 'No recipients matched' })
  }

  // ── Send in batches with rate limit ──────────────────────────────────────
  const portalUrl = (req.headers.origin as string) || process.env.CUSTOMER_PORTAL_URL || ''
  let sent = 0, failed = 0
  const errors: Array<{ email: string; error: string }> = []

  for (let i = 0; i < recipients.length; i += RATE_LIMIT_PER_BATCH) {
    const batch = recipients.slice(i, i + RATE_LIMIT_PER_BATCH)
    const results = await Promise.all(batch.map(r =>
      sendEmail({
        to: r.email,
        subject,
        template: 'broadcast',
        data: {
          name: r.name,
          body,
          ctaUrl: ctaUrl || '',
          ctaText: ctaText || 'Xem chi tiết',
          unsubscribeUrl: `${portalUrl}/unsubscribe?email=${encodeURIComponent(r.email)}`,
        }
      }).then(res => ({ email: r.email, res }))
    ))
    for (const { email, res: r } of results) {
      if (r.ok) sent++
      else { failed++; errors.push({ email, error: r.error || 'unknown' }) }
    }
    // Sleep between batches (skip after last)
    if (i + RATE_LIMIT_PER_BATCH < recipients.length) {
      await new Promise(r => setTimeout(r, SLEEP_MS))
    }
  }

  return res.json({
    success: true,
    sent,
    failed,
    total: recipients.length,
    errors: errors.slice(0, 20)  // cap error report
  })
}
