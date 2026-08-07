// api/f/submit.ts — Public form submission handler
// POST /api/f/submit (from AI-generated forms in landing pages)
// Body: multipart/form-data OR application/x-www-form-urlencoded OR JSON
//   funnel_id, step_id + all form field values
// Stores submission + auto-creates lead in CRM + redirects to success step

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function parseFormData(body: any, contentType: string): Record<string, string> {
  if (contentType.includes('application/json')) return body || {}
  if (typeof body === 'string') {
    // urlencoded
    const p = new URLSearchParams(body)
    const o: Record<string, string> = {}
    p.forEach((v, k) => { o[k] = v })
    return o
  }
  // Already parsed (Vercel/Node http parses urlencoded to object sometimes)
  return body || {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const contentType = (req.headers['content-type'] as string) || 'application/json'
  const data = parseFormData(req.body, contentType)

  const funnel_id = data.funnel_id
  const step_id = data.step_id
  if (!funnel_id || !step_id) {
    return res.status(400).json({ error: 'funnel_id + step_id required (hidden inputs)' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Verify funnel is published
  const { data: flow } = await admin.from('funnel_flows')
    .select('id, slug, status, tags_to_apply').eq('id', funnel_id).maybeSingle()
  if (!flow || flow.status !== 'published') {
    return res.status(404).json({ error: 'Funnel not published' })
  }

  // Verify step + get success redirect
  const { data: step } = await admin.from('funnel_steps')
    .select('id, form_success_step_slug, form_success_url, form_fields, additional_tags').eq('id', step_id).maybeSingle()
  if (!step) return res.status(404).json({ error: 'Step not found' })

  // Extract field values (skip system fields)
  const fieldData: Record<string, any> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k === 'funnel_id' || k === 'step_id') continue
    fieldData[k] = v
  }

  // Compute visitor_id
  const ua = (req.headers['user-agent'] as string) || ''
  const ip = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim()
    || (req.headers['x-real-ip'] as string) || 'unknown'
  const visitorId = crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)

  // Parse UTM from referrer
  let utm_source, utm_medium, utm_campaign
  try {
    const ref = req.headers.referer as string
    if (ref) {
      const rurl = new URL(ref)
      utm_source = rurl.searchParams.get('utm_source') || undefined
      utm_medium = rurl.searchParams.get('utm_medium') || undefined
      utm_campaign = rurl.searchParams.get('utm_campaign') || undefined
    }
  } catch {}

  // Save submission
  const { data: submission, error: subErr } = await admin.from('funnel_form_submissions').insert({
    funnel_id, step_id, data: fieldData, visitor_id: visitorId,
    ip_address: ip.slice(0, 45), user_agent: ua.slice(0, 500),
    referrer: (req.headers.referer as string || '').slice(0, 500),
    utm_source, utm_medium, utm_campaign,
  }).select('id').single()

  if (subErr) {
    console.error('[funnel-submit] insert error', subErr)
    return res.status(500).json({ error: subErr.message })
  }

  // Auto-sync to leads if email present + merge tags
  if (fieldData.email) {
    try {
      const flowTags: string[] = flow.tags_to_apply || []
      const stepTags: string[] = step.additional_tags || []
      const newTags = [...new Set([...flowTags, ...stepTags])].filter(Boolean)

      // Check existing lead by email
      const { data: existingLead } = await admin.from('leads')
        .select('id, tags').eq('email', fieldData.email).maybeSingle()

      let leadId: string
      if (existingLead) {
        leadId = existingLead.id
        // Merge tags with existing (dedup)
        const mergedTags = [...new Set([...(existingLead.tags || []), ...newTags])]
        const patch: any = { tags: mergedTags }
        if (fieldData.name && fieldData.name.trim()) patch.name = fieldData.name
        if (fieldData.phone) patch.phone = fieldData.phone
        await admin.from('leads').update(patch).eq('id', leadId)
      } else {
        const { data: newLead } = await admin.from('leads').insert({
          email: fieldData.email,
          name: fieldData.name || fieldData.email.split('@')[0],
          phone: fieldData.phone || null,
          source: `funnel:${flow.slug}/${step_id}`,
          utm_source, utm_medium, utm_campaign,
          tags: newTags,
        }).select('id').single()
        leadId = newLead?.id
      }

      // Link submission → lead
      if (leadId) {
        await admin.from('funnel_form_submissions').update({ synced_lead_id: leadId }).eq('id', submission.id)
      }

      // NOTE: Auto-nurture email removed. Replaced by tags system.
      // Future: Workflow feature will trigger actions (emails, sequences) based on tag rules.
    } catch (e: any) {
      console.error('[funnel-submit] lead sync', e.message)
      // Don't fail submission if lead sync fails
    }
  }

  // Increment counter
  const { data: current } = await admin.from('funnel_steps').select('form_submits').eq('id', step_id).maybeSingle()
  if (current) {
    await admin.from('funnel_steps').update({
      form_submits: (Number(current.form_submits) || 0) + 1
    }).eq('id', step_id)
  }

  // Decide redirect
  let redirectUrl = '/'
  if (step.form_success_url) {
    redirectUrl = step.form_success_url
  } else if (step.form_success_step_slug) {
    redirectUrl = `/f/${flow.slug}/${step.form_success_step_slug}`
  } else {
    redirectUrl = `/f/${flow.slug}`
  }

  // Response — HTML form submits expect 302 redirect
  if (contentType.includes('application/json')) {
    return res.json({ success: true, submission_id: submission.id, redirect: redirectUrl })
  } else {
    res.setHeader('Location', redirectUrl)
    return res.status(302).end()
  }
}
