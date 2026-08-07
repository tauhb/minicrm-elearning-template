// api/webhook-sepay.ts — LEGACY Vercel Serverless Function.
// Kept only for backward compatibility: existing SePay accounts may still POST here.
// NEW installs should point SePay at /api/f/sepay-webhook (funnel-aware, has idempotency,
// creates funnel_orders + payments in one flow).
// Wave 1 Track B will unify both endpoints; do not delete until then.
// URL: https://your-portal.vercel.app/api/webhook-sepay

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Admin client — dùng service_role key, chỉ chạy server-side
const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // SePay gửi POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getAdminClient()
  const payload  = req.body

  // 1. Log raw webhook
  const { data: event } = await supabase
    .from('webhook_events')
    .insert({ source: 'sepay', payload })
    .select('id')
    .single()

  try {
    // 2. Chỉ xử lý tiền vào (không xử lý tiền ra)
    if (payload.transferType !== 'in') {
      await supabase.from('webhook_events').update({ processed: true }).eq('id', event?.id)
      return res.json({ received: true, skipped: 'not incoming' })
    }

    // 3. Parse email + slug (course/product) từ description
    // Format SePay khuyến nghị: "THANHTOAN <slug> <email>" hoặc "THANHTOAN-K1 <email>" (legacy)
    const description: string = payload.description || payload.content || ''
    const emailMatch = description.match(/[\w.+-]+@[\w-]+\.\w+/)
    if (!emailMatch) {
      await supabase.from('webhook_events').update({ error: 'No email in description' }).eq('id', event?.id)
      return res.status(400).json({ error: 'No email found in description' })
    }
    const email = emailMatch[0].toLowerCase()

    // Trích slug candidate (token còn lại sau khi bỏ THANHTOAN + email)
    const tokens = description
      .replace(/THANHTOAN/i, '')
      .replace(emailMatch[0], '')
      .trim()
      .split(/[\s\-_]+/)
      .filter(Boolean)
    const slugCandidate = tokens.length > 0 ? tokens.join('-').toLowerCase() : null

    // Lookup course/product theo slug
    let courseId: string | null = null
    let productId: string | null = null
    if (slugCandidate) {
      const { data: course } = await supabase.from('courses').select('id, slug').eq('slug', slugCandidate).maybeSingle()
      if (course) {
        courseId = course.id
      } else {
        const { data: product } = await supabase.from('products').select('id, slug').eq('slug', slugCandidate).maybeSingle()
        if (product) productId = product.id
      }
    }

    // Fallback: nếu slug match pattern K\d+ (legacy cohort) → match default course với cohort đó
    let cohort: string | null = null
    if (!courseId && !productId) {
      const upper = (slugCandidate || '').toUpperCase()
      if (/^K\d+$/.test(upper)) {
        cohort = upper
        const { data: defaultCourse } = await supabase.from('courses').select('id').eq('slug', 'default').maybeSingle()
        courseId = defaultCourse?.id || null
      }
    }

    const ref = payload.referenceCode || payload.transactionID || ''

    // 4. Idempotency — không xử lý trùng
    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('gateway_ref', ref)
      .single()
    if (existing) {
      return res.json({ received: true, skipped: 'duplicate', ref })
    }

    // 5. Kiểm tra user đã tồn tại chưa
    const { data: users } = await supabase.auth.admin.listUsers()
    const existingUser = (users?.users ?? []).find((u: { email?: string }) => u.email === email)
    let userId: string

    if (existingUser) {
      // User đã có — chỉ cập nhật payment_status
      userId = existingUser.id
      await supabase.from('customers')
        .update({ payment_status: 'paid', payment_ref: ref })
        .eq('id', userId)
    } else {
      // 6. Tạo user mới
      const tempPass = `${Math.random().toString(36).slice(-8)}Aa1!`
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password: tempPass,
        email_confirm: true
      })
      if (createErr || !newUser?.user) {
        await supabase.from('webhook_events').update({ error: createErr?.message }).eq('id', event?.id)
        return res.status(500).json({ error: 'Failed to create user' })
      }
      userId = newUser.user.id

      // 7. Tạo customer profile (cohort/start_date không còn — đã chuyển sang customer_courses)
      await supabase.from('customers').insert({
        id: userId,
        email,
        display_name: email.split('@')[0],
        role: 'student',
        payment_status: 'paid',
        payment_ref: ref,
      })

      // 8. Gửi magic link để học viên đặt mật khẩu
      const siteUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : (process.env.SITE_URL || 'https://your-portal.vercel.app')
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: siteUrl }
      })
    }

    // 9. Enrollment nếu là course
    let enrollmentId: string | null = null
    if (courseId) {
      const today = new Date().toISOString().split('T')[0]
      const { data: enr } = await supabase.from('customer_courses').upsert({
        customer_id: userId,
        course_id: courseId,
        cohort,
        start_date: today,
        status: 'active',
      }, { onConflict: 'customer_id,course_id' }).select('id').single()
      enrollmentId = enr?.id || null
    }

    // 10. Grant nếu là digital product
    if (productId) {
      await supabase.from('customer_products').upsert({
        customer_id: userId,
        product_id: productId,
      }, { onConflict: 'customer_id,product_id' })
    }

    // 11. Ghi payment record
    const { data: paymentRecord } = await supabase.from('payments').insert({
      student_id     : userId,
      amount         : payload.transferAmount || 0,
      currency       : 'VND',
      status         : 'completed',
      gateway        : 'sepay',
      gateway_ref    : ref,
      gateway_payload: payload,
      course_id      : courseId,
      enrollment_id  : enrollmentId,
      product_id     : productId,
    }).select('id').single()

    // 11b. Affiliate attribution — LAST-CLICK, 30-day window
    // Ưu tiên REF token trong description (click cuối ngay trước khi mua)
    // Fallback: lead utm_campaign (first-click, khi visitor opt-in xa trước đó)
    try {
      const refFromDescription = tokens.find(t => t.toUpperCase().startsWith('REF-'))?.replace(/REF-/i, '').toUpperCase()

      let refCode = refFromDescription || null
      if (!refCode) {
        // Fallback: lookup utm trong leads
        const { data: lead } = await supabase
          .from('leads')
          .select('utm_source, utm_campaign')
          .eq('email', email)
          .maybeSingle()
        if (lead?.utm_source === 'affiliate' && lead?.utm_campaign) {
          refCode = lead.utm_campaign.toUpperCase()
        }
      }

      if (refCode) {
        const { data: affiliate } = await supabase
          .from('affiliates')
          .select('id, commission_rate, commission_type, fixed_amount')
          .eq('referral_code', refCode) // refCode đã uppercase phía trên
          .eq('status', 'approved')
          .maybeSingle()

        if (affiliate) {
          // Find latest valid click (last-click attribution, 30-day window)
          const { data: click } = await supabase
            .from('affiliate_clicks')
            .select('id, click_id')
            .eq('affiliate_id', affiliate.id)
            .eq('converted', false)
            .gte('expires_at', new Date().toISOString())
            .order('clicked_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const saleAmount = payload.transferAmount || 0
          const commissionAmount = affiliate.commission_type === 'fixed'
            ? (affiliate.fixed_amount || 0)
            : Math.round(saleAmount * (affiliate.commission_rate / 100))

          // Create conversion
          const { data: conversion } = await supabase
            .from('affiliate_conversions')
            .insert({
              affiliate_id: affiliate.id,
              click_id:     click?.click_id || null,
              payment_id:   paymentRecord?.id || null,
              customer_id:  userId,
              course_id:    courseId,
              product_id:   productId,
              sale_amount:  saleAmount,
              status:       'confirmed',
            })
            .select('id')
            .single()

          // Create commission (30-day hold)
          if (conversion) {
            await supabase.from('affiliate_commissions').insert({
              affiliate_id:     affiliate.id,
              conversion_id:    conversion.id,
              sale_amount:      saleAmount,
              commission_rate:  affiliate.commission_rate,
              commission_amount: commissionAmount,
            })
          }

          // Mark click as converted
          if (click) {
            await supabase
              .from('affiliate_clicks')
              .update({ converted: true, converted_at: new Date().toISOString() })
              .eq('click_id', click.click_id)
          }
        }
      }
    } catch (affiliateErr) {
      // Affiliate attribution lỗi không ảnh hưởng payment flow
      console.error('Affiliate attribution error:', affiliateErr)
    }

    // 12. Done
    await supabase.from('webhook_events').update({ processed: true }).eq('id', event?.id)
    return res.json({ success: true, userId, email, courseId, productId, cohort })

  } catch (error: any) {
    console.error('Webhook error:', error)
    if (event?.id) {
      await supabase.from('webhook_events').update({ error: error.message }).eq('id', event.id)
    }
    return res.status(500).json({ error: error.message })
  }
}
