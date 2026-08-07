// api/admin-create-customer.ts — Vercel Serverless Function
// Tạo Khách hàng / Convert KHTN — chỉ server-side dùng service_role key

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendWelcome } from '../services/email'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // 1. Verify caller là admin/sales qua JWT
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Thiếu token xác thực' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  )
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return res.status(401).json({ error: 'Token không hợp lệ' })

  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || !['admin', 'sales'].includes(caller.role)) {
    return res.status(403).json({ error: 'Chỉ admin/sales được thực hiện' })
  }

  // 2. Service role client
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const {
      email,
      display_name,
      role = 'student',
      email_mode = 'magic_link',   // 'magic_link' | 'password'
      password: customPassword,
      send_magic_link,
      enroll_course_id,
      enroll_cohort,
      enroll_start_date,
      grant_product_id,
      grant_product_ids,
      convert_lead_id,
      lead_id: lead_id_body,
      amount,
      order_note,
      phone: phone_body,
    } = req.body || {}

    const lead_id = convert_lead_id || lead_id_body
    const productIds: string[] = [
      ...(grant_product_ids || []),
      ...(grant_product_id ? [grant_product_id] : []),
    ].filter(Boolean)

    if (!email) return res.status(400).json({ error: 'Email bắt buộc' })
    if (email_mode === 'password' && !customPassword) {
      return res.status(400).json({ error: 'Mật khẩu bắt buộc khi chọn mode password' })
    }

    const emailLower = email.trim().toLowerCase()

    // 3. Kiểm tra user đã tồn tại chưa
    const listRes = await admin.auth.admin.listUsers()
    const existingUsers = (listRes.data?.users || []) as Array<{ id: string; email?: string }>
    const existing = existingUsers.find(u => u.email === emailLower)

    let userId: string
    let created = false
    const finalPassword = email_mode === 'password' ? customPassword : (Math.random().toString(36).slice(-10) + 'Aa1!')

    if (existing) {
      userId = existing.id
      // Update password nếu admin đặt mới
      if (email_mode === 'password') {
        await admin.auth.admin.updateUserById(userId, { password: finalPassword })
      }
    } else {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: emailLower,
        password: finalPassword,
        email_confirm: true,
      })
      if (createErr || !newUser?.user) {
        return res.status(500).json({ error: createErr?.message || 'Không tạo được tài khoản' })
      }
      userId = newUser.user.id
      created = true
    }

    // 5. Upsert customer profile
    // Backfill phone: prefer request body, else from linked lead (only when customer.phone
    // is currently NULL — never overwrite manually-set values).
    let phoneToUse: string | null = phone_body || null
    if (!phoneToUse && lead_id) {
      const { data: leadRow } = await admin.from('leads').select('phone').eq('id', lead_id).maybeSingle()
      phoneToUse = leadRow?.phone || null
    }
    const paymentStatus = (amount && amount > 0) ? 'paid' : 'pending'
    const existingCustomer = await admin.from('customers').select('phone').eq('id', userId).maybeSingle()
    const shouldSetPhone = phoneToUse && !existingCustomer.data?.phone
    await admin.from('customers').upsert({
      id: userId,
      email: emailLower,
      display_name: display_name || emailLower.split('@')[0],
      role,
      payment_status: paymentStatus,
      ...(shouldSetPhone ? { phone: phoneToUse } : {}),
    })

    // 6. Enroll vào course nếu có
    let enrollmentId: string | null = null
    if (enroll_course_id) {
      const { data: enr } = await admin.from('customer_courses').upsert({
        customer_id: userId,
        course_id: enroll_course_id,
        cohort: enroll_cohort || null,
        start_date: enroll_start_date || null,
        status: 'active',
        granted_by: user.id,
      }, { onConflict: 'customer_id,course_id' }).select('id').single()
      enrollmentId = enr?.id || null
    }

    // 7. Grant digital products nếu có
    if (productIds.length > 0) {
      await Promise.all(productIds.map(pid =>
        admin.from('customer_products').upsert({
          customer_id: userId,
          product_id: pid,
          granted_by: user.id,
        }, { onConflict: 'customer_id,product_id' })
      ))
    }

    // 8. Payment record nếu có amount
    if (amount && Number(amount) > 0) {
      await admin.from('payments').insert({
        student_id: userId,
        lead_id: lead_id || null,
        course_id: enroll_course_id || null,
        enrollment_id: enrollmentId,
        product_id: productIds[0] || null,
        amount: Number(amount),
        currency: 'VND',
        status: 'completed',
        gateway: 'manual',
        gateway_ref: `MANUAL-${Date.now()}`,
        order_note: order_note || null,
      })
    }

    // 9. Convert lead nếu có
    if (lead_id) {
      await admin.from('leads').update({
        converted_at: new Date().toISOString(),
        converted_to: userId,
      }).eq('id', lead_id)
      await admin.from('care_history').insert({
        lead_id,
        type: 'note',
        content: 'Chuyển đổi thành Khách hàng',
        created_by: user.id,
      })
    }

    // 10. Gửi email
    const origin = (req.headers.origin as string) || process.env.VERCEL_URL || 'http://localhost:5009'
    const portalUrl = origin.startsWith('http') ? origin : `https://${origin}`
    const customerName = display_name || emailLower.split('@')[0]

    if (email_mode === 'password') {
      await sendWelcome({
        email: emailLower,
        name: customerName,
        portalUrl,
        mode: 'credentials',
        password: finalPassword,
      })
    } else if ((email_mode === 'magic_link' || send_magic_link) && (created || send_magic_link)) {
      await sendWelcome({
        email: emailLower,
        name: customerName,
        portalUrl,
        mode: 'magic-link',
        loginUrl: portalUrl,
      })
    }

    return res.json({ success: true, userId, email: emailLower, created })
  } catch (err: any) {
    console.error('admin-create-customer error:', err)
    return res.status(500).json({ error: err.message || 'Lỗi không xác định' })
  }
}

