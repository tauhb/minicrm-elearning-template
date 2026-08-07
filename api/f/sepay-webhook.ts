// api/f/sepay-webhook.ts — Receive SePay payment callback
// POST /api/f/sepay-webhook
// Headers: Authorization: Apikey <webhook_secret>
// Body: {
//   id, gateway, transactionDate, accountNumber, code, content,
//   transferType, transferAmount, referenceCode, description
// }
//
// Behavior:
//   1. Parse `content` for our reference code (FN....)
//   2. Match funnel_orders.reference_code
//   3. Verify Authorization matches funnel's webhook_secret
//   4. Update order.status='paid', paid_at=now, sepay_ref, sepay_payload
//   5. Create payments row in CRM
//   6. Convert lead → customer if not yet

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { extractReferenceFromContent, verifyWebhookAuth, PaymentConfig } from '../../services/sepay'
import { tryDecrypt } from '../../services/crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const payload = req.body || {}
  const content = String(payload.content || '')
  const transferType = String(payload.transferType || '')
  const amount = Number(payload.transferAmount || 0)

  // Only process incoming transfers
  if (transferType !== 'in') return res.status(200).json({ ok: true, skipped: 'not-incoming' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Try match by referenceCode in content (search across all pending orders)
  // Strategy: scan for any order prefix, but limit to pending orders in last 24h
  const { data: pendingOrders } = await admin.from('funnel_orders')
    .select('id, reference_code, funnel_id, amount, submission_id, status')
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(200)

  const matched = (pendingOrders || []).find(o => content.toUpperCase().includes(o.reference_code.toUpperCase()))

  if (!matched) {
    // Log for audit — no match
    console.warn('[sepay-webhook] no matching order for content:', content.slice(0, 100))
    return res.status(200).json({ ok: true, skipped: 'no-match', content_hint: content.slice(0, 80) })
  }

  // Verify Authorization header against funnel's webhook_secret
  const { data: flow } = await admin.from('funnel_flows')
    .select('payment_config').eq('id', matched.funnel_id).maybeSingle()
  const cfg = (flow?.payment_config || {}) as PaymentConfig
  const secretEncrypted = cfg.webhook_secret_encrypted
  const expectedSecret = secretEncrypted ? tryDecrypt(secretEncrypted) : null

  if (expectedSecret) {
    const auth = req.headers.authorization as string | undefined
    if (!verifyWebhookAuth(auth, expectedSecret)) {
      return res.status(401).json({ error: 'Invalid webhook auth' })
    }
  }
  // If no secret configured on portal side — accept (best-effort, but log warning)
  if (!expectedSecret) {
    console.warn('[sepay-webhook] no webhook_secret configured for funnel', matched.funnel_id)
  }

  // Verify amount matches (allow ±5% tolerance for bank rounding — but usually exact)
  if (Math.abs(amount - matched.amount) > matched.amount * 0.02 && amount < matched.amount) {
    // Underpayment — don't mark paid, log warning
    console.warn('[sepay-webhook] amount mismatch:', { expected: matched.amount, got: amount, ref: matched.reference_code })
    return res.status(200).json({ ok: true, warning: 'amount-mismatch', expected: matched.amount, got: amount })
  }

  // Mark paid + save payload
  await admin.from('funnel_orders').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    sepay_ref: String(payload.id || payload.referenceCode || ''),
    sepay_payload: payload,
    updated_at: new Date().toISOString(),
  }).eq('id', matched.id)

  // Create payments record + convert lead → customer
  try {
    // Get submission's synced lead
    if (matched.submission_id) {
      const { data: submission } = await admin.from('funnel_form_submissions')
        .select('synced_lead_id, data').eq('id', matched.submission_id).maybeSingle()
      const leadId = submission?.synced_lead_id
      const custData = (submission?.data as any) || {}

      let customerId: string | null = null
      if (leadId) {
        // Convert lead → customer if not already
        const { data: lead } = await admin.from('leads').select('email, name, phone, converted_at, converted_to').eq('id', leadId).maybeSingle()
        if (lead) {
          if (lead.converted_to) {
            customerId = lead.converted_to as string
          } else {
            // Create customer via auth admin API
            const emailLower = String(lead.email).toLowerCase()
            const { data: existingUsers } = await admin.auth.admin.listUsers()
            const existingUser = existingUsers?.users?.find((u: any) => u.email === emailLower)
            let userId = existingUser?.id
            if (!userId) {
              const randPass = Math.random().toString(36).slice(-10) + 'Aa1!'
              const { data: newUser } = await admin.auth.admin.createUser({
                email: emailLower, password: randPass, email_confirm: true,
              })
              userId = newUser?.user?.id
            }
            if (userId) {
              await admin.from('customers').upsert({
                id: userId, email: emailLower, display_name: lead.name || emailLower.split('@')[0],
                role: 'student', payment_status: 'paid',
              })
              customerId = userId
              await admin.from('leads').update({
                converted_at: new Date().toISOString(), converted_to: userId,
              }).eq('id', leadId)
            }
          }
        }
      }

      // Payments row
      await admin.from('payments').insert({
        student_id: customerId,
        lead_id: leadId,
        amount: matched.amount,
        currency: 'VND',
        status: 'completed',
        gateway: 'sepay',
        gateway_ref: matched.reference_code,
        order_note: `Funnel order ${matched.reference_code} · SePay tx ${payload.id || ''}`,
      })
    }
  } catch (e: any) {
    console.error('[sepay-webhook] CRM sync error:', e.message)
    // Order still marked paid — this is non-blocking
  }

  return res.status(200).json({ ok: true, order_id: matched.id, reference: matched.reference_code })
}
