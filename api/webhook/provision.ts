// api/webhook/provision.ts — Vercel Serverless Function
// Cấp quyền truy cập: tạo khách hàng + enroll khoá học + ghi đơn hàng
// Dùng cho: thanh toán thành công (SePay, Stripe…), đăng ký trực tiếp
//
// POST https://your-portal.vercel.app/api/webhook/provision
// Header: X-Webhook-Secret: <secret>
// Body:
//   { email, name?,
//     course_id?, cohort?, start_date?,   ← enroll khoá học
//     product_id?,                         ← grant sản phẩm số
//     amount?, currency?, gateway_ref?,    ← ghi đơn (tuỳ chọn)
//     send_magic_link? }                   ← gửi email

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendWelcome } from '../../services/email'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      source: 'webhook_provision', payload: req.body || {}, processed: false, error: 'Invalid secret',
    })
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  const {
    email, name,
    course_id, cohort, start_date,
    product_id,
    amount, currency = 'VND', gateway_ref,
    send_magic_link = true,
  } = req.body || {}

  if (!email) return res.status(400).json({ error: 'email là bắt buộc' })
  const emailLower = (email as string).trim().toLowerCase()

  // ── Log event ─────────────────────────────────────────────────────────────
  const { data: evt } = await db.from('webhook_events')
    .insert({ source: 'webhook_provision', payload: req.body, processed: false })
    .select('id').single()
  const evtId = evt?.id

  const markDone = (error?: string) =>
    evtId && db.from('webhook_events')
      .update({ processed: !error, error: error || null }).eq('id', evtId)

  try {
    // ── Idempotency: skip nếu gateway_ref đã xử lý ────────────────────────
    if (gateway_ref) {
      const { data: dup } = await db.from('payments')
        .select('id').eq('gateway_ref', gateway_ref).maybeSingle()
      if (dup) {
        await markDone()
        return res.json({ success: true, skipped: true, reason: 'gateway_ref đã tồn tại' })
      }
    }

    // ── Kiểm tra / tạo auth user ──────────────────────────────────────────
    const listRes = await db.auth.admin.listUsers()
    const existingUsers = (listRes.data?.users || []) as Array<{ id: string; email?: string }>
    const existingUser = existingUsers.find(u => u.email === emailLower)

    let userId: string
    let isNewUser = false

    if (existingUser) {
      userId = existingUser.id
    } else {
      const randPass = Math.random().toString(36).slice(-10) + 'Aa1!'
      const { data: newUser, error: createErr } = await db.auth.admin.createUser({
        email: emailLower, password: randPass, email_confirm: true,
      })
      if (createErr || !newUser?.user)
        throw new Error(createErr?.message || 'Không tạo được tài khoản')
      userId = newUser.user.id
      isNewUser = true
    }

    // ── Upsert customer profile ───────────────────────────────────────────
    await db.from('customers').upsert({
      id: userId,
      email: emailLower,
      display_name: name || emailLower.split('@')[0],
      role: 'student',
      payment_status: (amount && Number(amount) > 0) ? 'paid' : 'pending',
    })

    // ── Enroll khoá học ───────────────────────────────────────────────────
    let enrollmentId: string | null = null
    if (course_id) {
      const { data: enr } = await db.from('customer_courses').upsert({
        customer_id: userId,
        course_id,
        cohort: cohort || null,
        start_date: start_date || null,
        status: 'active',
      }, { onConflict: 'customer_id,course_id' }).select('id').single()
      enrollmentId = enr?.id || null
    }

    // ── Grant sản phẩm số ─────────────────────────────────────────────────
    if (product_id) {
      await db.from('customer_products').upsert({
        customer_id: userId, product_id,
      }, { onConflict: 'customer_id,product_id' })
    }

    // ── Ghi đơn hàng ─────────────────────────────────────────────────────
    if (amount && Number(amount) > 0) {
      await db.from('payments').insert({
        student_id:    userId,
        course_id:     course_id || null,
        product_id:    product_id || null,
        enrollment_id: enrollmentId,
        amount:        Number(amount),
        currency,
        status:        'completed',
        gateway:       'webhook',
        gateway_ref:   gateway_ref || `WH-${Date.now()}`,
      })
    }

    // ── Convert lead nếu có cùng email ───────────────────────────────────
    const { data: matchedLead } = await db.from('leads')
      .select('id').eq('email', emailLower).is('converted_at', null).maybeSingle()
    if (matchedLead) {
      await db.from('leads').update({
        converted_at: new Date().toISOString(),
        converted_to: userId,
      }).eq('id', matchedLead.id)
    }

    // ── Gửi magic link / welcome email ───────────────────────────────────
    const origin = (req.headers.origin as string) || process.env.VERCEL_URL || 'http://localhost:5009'
    const portalUrl = origin.startsWith('http') ? origin : `https://${origin}`

    if (send_magic_link && isNewUser) {
      await sendWelcome({
        email: emailLower,
        name: name || emailLower.split('@')[0],
        portalUrl,
        mode: 'magic-link',
        loginUrl: portalUrl,
      })
    }

    await markDone()
    return res.json({ success: true, userId, email: emailLower, isNewUser })
  } catch (err: any) {
    console.error('[webhook/provision]', err)
    await markDone(err.message)
    return res.status(500).json({ error: err.message })
  }
}

