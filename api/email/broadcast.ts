// api/email/broadcast.ts — Broadcast email to multiple recipients (admin only)
// POST /api/email/broadcast
// Header: Authorization: Bearer <userToken>
// Body: {
//   audience:
//     | 'all-leads'          // all rows in leads table
//     | 'all-students'       // customers with role=student
//     | 'team'               // customers with role in (owner|admin|sales|support)
//     | 'tag'                // requires `tag`; matches customers.tags AND leads.tags
//     | 'course'             // legacy: requires `course_id`
//     | 'custom',            // requires `emails[]`
//   tag?: string,
//   course_id?: string,
//   emails?: string[],
//   subject: string,
//   body: string,                   // HTML or markdown-ish
//   ctaUrl?: string,
//   ctaText?: string,
//   template?: 'broadcast'          // default
// }
//
// Wave 2 Track F: every send is logged to email_broadcasts (status transitions
// sending → sent|failed). Response includes {broadcast_id} for UI linking.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '../../services/email'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RATE_LIMIT_PER_BATCH = 10
const SLEEP_MS = 1000
const BROADCAST_ROLES = ['owner', 'admin', 'sales']

interface Recipient { email: string; name: string }

/**
 * Shared helper: resolve audience → recipient list. Used by both broadcast.ts
 * (actual send) and broadcasts.ts (preview count). Exported so other endpoints
 * can reuse the same audience contract without drifting.
 */
export async function resolveRecipients(
  admin: SupabaseClient,
  audience: string,
  opts: { course_id?: string; emails?: string[]; tag?: string; tags?: string[] }
): Promise<Recipient[]> {
  if (audience === 'all-leads') {
    const { data } = await admin.from('leads')
      .select('email, name').not('email', 'is', null)
    return (data || []).map((r: any) => ({
      email: r.email,
      name: r.name || r.email.split('@')[0],
    }))
  }

  if (audience === 'all-students') {
    const { data } = await admin.from('customers')
      .select('email, display_name').eq('role', 'student').not('email', 'is', null)
    return (data || []).map((r: any) => ({
      email: r.email,
      name: r.display_name || r.email.split('@')[0],
    }))
  }

  if (audience === 'team') {
    const { data } = await admin.from('customers')
      .select('email, display_name, role')
      .in('role', ['owner', 'admin', 'sales', 'support'])
      .not('email', 'is', null)
    return (data || []).map((r: any) => ({
      email: r.email,
      name: r.display_name || r.email.split('@')[0],
    }))
  }

  if (audience === 'tag') {
    // Accept multiple tags (OR). Backward compat: single opts.tag still works.
    const tagList = (opts.tags && opts.tags.length ? opts.tags : (opts.tag ? [opts.tag] : []))
      .map(t => t.trim()).filter(Boolean)
    if (!tagList.length) throw new Error('tag(s) required for audience=tag')
    // Overlaps: rows whose tags[] intersects tagList (i.e. has any of them).
    const [{ data: custs }, { data: leadRows }] = await Promise.all([
      admin.from('customers')
        .select('email, display_name').overlaps('tags', tagList)
        .not('email', 'is', null),
      admin.from('leads')
        .select('email, name').overlaps('tags', tagList)
        .not('email', 'is', null),
    ])
    const seen = new Set<string>()
    const out: Recipient[] = []
    for (const r of (custs || []) as any[]) {
      const e = String(r.email).toLowerCase()
      if (seen.has(e)) continue
      seen.add(e)
      out.push({ email: r.email, name: r.display_name || r.email.split('@')[0] })
    }
    for (const r of (leadRows || []) as any[]) {
      const e = String(r.email).toLowerCase()
      if (seen.has(e)) continue
      seen.add(e)
      out.push({ email: r.email, name: r.name || r.email.split('@')[0] })
    }
    return out
  }

  if (audience === 'course') {
    if (!opts.course_id) throw new Error('course_id required for audience=course')
    const { data } = await admin.from('customer_courses')
      .select('customers!inner(email, display_name)')
      .eq('course_id', opts.course_id).eq('status', 'active')
    return (data || []).map((r: any) => ({
      email: r.customers.email,
      name: r.customers.display_name || r.customers.email.split('@')[0],
    }))
  }

  if (audience === 'custom') {
    if (!Array.isArray(opts.emails) || opts.emails.length === 0) {
      throw new Error('emails[] required for audience=custom')
    }
    return opts.emails.map((e: string) => ({ email: e, name: e.split('@')[0] }))
  }

  throw new Error(`Unknown audience: ${audience}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth ─────────────────────────────────────────────────────────────────
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
  if (!caller || !BROADCAST_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Không có quyền gửi broadcast' })
  }

  // ── Validate input ───────────────────────────────────────────────────────
  const { audience, course_id, emails, tag, tags, subject, body, ctaUrl, ctaText } = req.body || {}
  if (!audience) return res.status(400).json({ error: '`audience` required' })
  if (!subject)  return res.status(400).json({ error: '`subject` required' })
  if (!body)     return res.status(400).json({ error: '`body` required' })

  // ── Resolve recipients ───────────────────────────────────────────────────
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let recipients: Recipient[] = []
  try {
    recipients = await resolveRecipients(admin, audience, { course_id, emails, tag, tags })
  } catch (e: any) {
    return res.status(400).json({ error: e.message || 'Recipient resolution failed' })
  }

  // Build recipient_filter JSONB
  const recipient_filter: Record<string, any> = { kind: audience }
  if (audience === 'tag') {
    const persistTags = (tags && tags.length) ? tags : (tag ? [tag] : [])
    if (persistTags.length === 1) recipient_filter.tag = persistTags[0]
    else if (persistTags.length > 1) recipient_filter.tags = persistTags
  }
  if (audience === 'course' && course_id)      recipient_filter.course_id = course_id
  if (audience === 'custom' && Array.isArray(emails))
    recipient_filter.emails = emails.slice(0, 100)  // cap for storage

  // ── Log: create broadcast row (status=sending) ───────────────────────────
  const { data: bcast, error: logErr } = await admin.from('email_broadcasts')
    .insert({
      subject,
      html_body: body,
      recipient_filter,
      recipient_count: recipients.length,
      status: recipients.length === 0 ? 'sent' : 'sending',
      created_by: user.id,
    })
    .select('id')
    .single()
  if (logErr) {
    // Non-fatal for the send itself; log & continue without broadcast_id.
    console.warn('[broadcast] failed to insert email_broadcasts row:', logErr.message)
  }
  const broadcastId: string | undefined = bcast?.id

  if (recipients.length === 0) {
    return res.json({
      success: true,
      sent: 0,
      failed: 0,
      broadcast_id: broadcastId,
      message: 'No recipients matched',
    })
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
    if (i + RATE_LIMIT_PER_BATCH < recipients.length) {
      await new Promise(r => setTimeout(r, SLEEP_MS))
    }
  }

  // ── Log: finalise broadcast row ──────────────────────────────────────────
  if (broadcastId) {
    const finalStatus = failed === recipients.length ? 'failed' : 'sent'
    const errorSummary = failed > 0
      ? errors.slice(0, 5).map(e => `${e.email}: ${e.error}`).join('; ')
      : null
    await admin.from('email_broadcasts')
      .update({
        sent_count: sent,
        failed_count: failed,
        status: finalStatus,
        error: errorSummary,
      })
      .eq('id', broadcastId)
  }

  return res.json({
    success: true,
    sent,
    failed,
    total: recipients.length,
    broadcast_id: broadcastId,
    errors: errors.slice(0, 20),
  })
}
