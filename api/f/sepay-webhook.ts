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
//   4. IDEMPOTENCY: if order.status already 'paid' → return 200 "already processed"
//      Also relies on partial UNIQUE index payments(gateway, gateway_ref) as belt-and-suspenders.
//   5. Update order.status='paid', paid_at=now, sepay_ref, sepay_payload
//   6. Create payments row in CRM (idempotent via unique index)
//   7. Convert lead → customer if not yet + write care_history note
//      Also matches leads by email even when submission has no synced_lead_id yet.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyWebhookAuth, PaymentConfig } from '../../services/sepay'
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

  // Try match by referenceCode in content.
  // Scan pending + already-paid orders in last 24h so that duplicate deliveries
  // for an already-processed reference are recognised and short-circuited.
  const { data: candidateOrders } = await admin.from('funnel_orders')
    .select('id, reference_code, funnel_id, amount, submission_id, status, paid_at')
    .in('status', ['pending', 'paid'])
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(400)

  const matched = (candidateOrders || []).find(o => content.toUpperCase().includes(o.reference_code.toUpperCase()))

  if (!matched) {
    // Log for audit — no match
    console.warn('[sepay-webhook] no matching order for content:', content.slice(0, 100))
    return res.status(200).json({ ok: true, skipped: 'no-match', content_hint: content.slice(0, 80) })
  }

  // ── Idempotency guard #1: order already paid → return 200 so SePay stops retrying ──
  if (matched.status === 'paid') {
    console.log('[sepay-webhook] duplicate delivery for already-paid order', matched.reference_code)
    return res.status(200).json({
      ok: true,
      already_processed: true,
      order_id: matched.id,
      reference: matched.reference_code,
      paid_at: matched.paid_at,
    })
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

  // Verify amount matches (allow ±2% tolerance for bank rounding — but usually exact)
  if (Math.abs(amount - matched.amount) > matched.amount * 0.02 && amount < matched.amount) {
    // Underpayment — don't mark paid, log warning
    console.warn('[sepay-webhook] amount mismatch:', { expected: matched.amount, got: amount, ref: matched.reference_code })
    return res.status(200).json({ ok: true, warning: 'amount-mismatch', expected: matched.amount, got: amount })
  }

  // ── Idempotency guard #2: conditional UPDATE — only flips pending → paid.
  //    If a concurrent invocation raced past guard #1, this returns 0 rows and
  //    we short-circuit before creating a duplicate payments row.
  const nowIso = new Date().toISOString()
  const { data: flippedRows, error: flipErr } = await admin.from('funnel_orders').update({
    status: 'paid',
    paid_at: nowIso,
    sepay_ref: String(payload.id || payload.referenceCode || ''),
    sepay_payload: payload,
    updated_at: nowIso,
  })
    .eq('id', matched.id)
    .eq('status', 'pending')   // only proceed if still pending
    .select('id')

  if (flipErr) {
    console.error('[sepay-webhook] failed to mark order paid:', flipErr.message)
    return res.status(500).json({ error: 'db update failed' })
  }

  if (!flippedRows || flippedRows.length === 0) {
    // Someone else won the race and already marked paid — treat as duplicate.
    console.log('[sepay-webhook] race lost; order already marked paid', matched.reference_code)
    return res.status(200).json({
      ok: true,
      already_processed: true,
      order_id: matched.id,
      reference: matched.reference_code,
    })
  }

  // Create payments record + convert lead → customer + care_history sync.
  try {
    // Get submission for lead + customer data (submission_id optional).
    let submission: { synced_lead_id?: string | null; data?: any } | null = null
    if (matched.submission_id) {
      const { data } = await admin.from('funnel_form_submissions')
        .select('synced_lead_id, data').eq('id', matched.submission_id).maybeSingle()
      submission = data
    }

    let leadId: string | null = (submission?.synced_lead_id as string) || null
    const custData = (submission?.data as any) || {}
    const customerEmail = String(custData.email || '').toLowerCase()
    const customerName = String(custData.name || custData.full_name || '') || customerEmail.split('@')[0]
    const customerPhone = String(custData.phone || '')

    // If submission had no lead sync, try to match a lead by email (Track B fix:
    // funnel checkout should still credit the originating lead).
    if (!leadId && customerEmail) {
      const { data: leadByEmail } = await admin.from('leads')
        .select('id, converted_to')
        .eq('email', customerEmail)
        .limit(1)
        .maybeSingle()
      if (leadByEmail) leadId = leadByEmail.id as string
    }

    let customerId: string | null = null
    if (leadId) {
      const { data: lead } = await admin.from('leads')
        .select('id, email, name, phone, converted_at, converted_to')
        .eq('id', leadId).maybeSingle()

      if (lead) {
        if (lead.converted_to) {
          customerId = lead.converted_to as string
        } else {
          // Create customer via auth admin API
          const emailLower = String(lead.email || customerEmail).toLowerCase()
          if (emailLower) {
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
                id: userId,
                email: emailLower,
                display_name: lead.name || customerName || emailLower.split('@')[0],
                role: 'student',
                payment_status: 'paid',
              })
              customerId = userId
              await admin.from('leads').update({
                converted_at: nowIso,
                converted_to: userId,
              }).eq('id', leadId)

              // care_history note — mirrors admin-create-customer.ts wording
              await admin.from('care_history').insert({
                lead_id: leadId,
                type: 'note',
                content: 'Chuyển đổi thành Khách hàng qua funnel checkout',
                kind: 'care_log',
                status: 'done',
              })
            }
          }
        }
      }
    }

    // Fallback: no lead but we have an email → still try to create a customer so
    // the funnel checkout actually provisions the buyer.
    if (!customerId && customerEmail) {
      const { data: existingUsers } = await admin.auth.admin.listUsers()
      const existingUser = existingUsers?.users?.find((u: any) => u.email === customerEmail)
      customerId = existingUser?.id || null
      if (!customerId) {
        const randPass = Math.random().toString(36).slice(-10) + 'Aa1!'
        const { data: newUser } = await admin.auth.admin.createUser({
          email: customerEmail, password: randPass, email_confirm: true,
        })
        customerId = newUser?.user?.id || null
        if (customerId) {
          await admin.from('customers').upsert({
            id: customerId,
            email: customerEmail,
            display_name: customerName,
            role: 'student',
            payment_status: 'paid',
          })
        }
      }
    }

    // Payments row — belt-and-suspenders: relies on partial UNIQUE index
    // payments(gateway, gateway_ref) to reject duplicates if we somehow race here.
    const { error: payErr } = await admin.from('payments').insert({
      student_id: customerId,
      lead_id: leadId,
      order_id: matched.id,
      amount: matched.amount,
      currency: 'VND',
      status: 'completed',
      gateway: 'sepay',
      gateway_ref: matched.reference_code,
      gateway_payload: payload,
      order_note: `Funnel order ${matched.reference_code} · SePay tx ${payload.id || ''}`,
    })
    if (payErr) {
      // Unique-violation on (gateway, gateway_ref) means a prior invocation already inserted.
      // Postgres error code 23505 = unique_violation.
      const code = (payErr as any).code
      if (code === '23505') {
        console.log('[sepay-webhook] payments row already exists for', matched.reference_code)
      } else {
        console.error('[sepay-webhook] payments insert error:', payErr.message)
      }
    }
  } catch (e: any) {
    console.error('[sepay-webhook] CRM sync error:', e.message)
    // Order still marked paid — this is non-blocking
  }

  return res.status(200).json({ ok: true, order_id: matched.id, reference: matched.reference_code })
}
