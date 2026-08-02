/**
 * Local dev API server — chạy song song với Vite
 * Mimics Vercel serverless functions tại http://localhost:3001/api/*
 * Được proxy qua Vite server (port 5009 → 3001 cho /api/*)
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const PORT = Number(process.env.PORT) || 3001
const DIST_DIR = resolve('dist')
const SERVE_STATIC = existsSync(DIST_DIR)  // Auto-serve dist/ in production (Railway)

// --- Static MIME map ---
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
}

// --- Load .env / .env.local (ưu tiên .env.local) ---
for (const file of ['.env', '.env.local']) {
  if (existsSync(file)) {
    readFileSync(file, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) {
        const val = m[2].replace(/^['"]|['"]$/g, '').trim()
        if (val) process.env[m[1]] = val
      }
    })
  }
}

// --- Mock VercelResponse ---
function makeRes(nodeRes) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
  let statusCode = 200
  const res = {
    setHeader(k, v) { headers[k] = v; return res },
    status(code) { statusCode = code; return res },
    json(data) {
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(statusCode, headers)
        nodeRes.end(JSON.stringify(data))
      }
      return res
    },
    end(...args) { nodeRes.end(...args); return res },
  }
  return res
}

// --- Handlers ---
async function handleAdminCreateCustomer(req, res) {
  const {
    email, display_name, role = 'student',
    email_mode = 'magic_link', password: customPassword,
    send_magic_link,
    enroll_course_id, enroll_cohort, enroll_start_date,
    grant_product_id, grant_product_ids,
    convert_lead_id, lead_id: lead_id_body,
    amount, order_note,
  } = req.body || {}

  const lead_id = convert_lead_id || lead_id_body
  const productIds = [...(grant_product_ids || []), ...(grant_product_id ? [grant_product_id] : [])].filter(Boolean)

  if (!email) return res.status(400).json({ error: 'Email bắt buộc' })
  if (email_mode === 'password' && !customPassword) return res.status(400).json({ error: 'Mật khẩu bắt buộc' })

  const authHeader = req.headers['authorization'] || ''
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Thiếu token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } }
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return res.status(401).json({ error: 'Token không hợp lệ' })

  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || !['admin', 'sales'].includes(caller.role)) return res.status(403).json({ error: 'Không có quyền' })

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // App settings
  const { data: settingsRows } = await admin.from('app_settings').select('key, value').in('key', ['title', 'resend_api_key'])
  const settingsMap = {}
  ;(settingsRows || []).forEach(r => { settingsMap[r.key] = r.value })
  const appName = settingsMap['title']?.value || 'Portal'
  const resendApiKey = process.env.RESEND_API_KEY || settingsMap['resend_api_key']?.value || ''

  const emailLower = email.trim().toLowerCase()

  // Tìm user hiện có
  const listRes = await admin.auth.admin.listUsers()
  const existing = (listRes.data?.users || []).find(u => u.email === emailLower)

  let userId, created = false
  const finalPassword = email_mode === 'password' ? customPassword : (Math.random().toString(36).slice(-10) + 'Aa1!')

  if (existing) {
    userId = existing.id
    if (email_mode === 'password') await admin.auth.admin.updateUserById(userId, { password: finalPassword })
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: emailLower, password: finalPassword, email_confirm: true,
    })
    if (createErr || !newUser?.user) return res.status(500).json({ error: createErr?.message || 'Không tạo được tài khoản' })
    userId = newUser.user.id
    created = true
  }

  const paymentStatus = (amount && amount > 0) ? 'paid' : 'pending'
  await admin.from('customers').upsert({
    id: userId, email: emailLower,
    display_name: display_name || emailLower.split('@')[0],
    role, payment_status: paymentStatus,
  })

  let enrollmentId = null
  if (enroll_course_id) {
    const { data: enr } = await admin.from('customer_courses').upsert({
      customer_id: userId, course_id: enroll_course_id,
      cohort: enroll_cohort || null, start_date: enroll_start_date || null,
      status: 'active', granted_by: user.id,
    }, { onConflict: 'customer_id,course_id' }).select('id').single()
    enrollmentId = enr?.id || null
  }

  if (productIds.length > 0) {
    await Promise.all(productIds.map(pid =>
      admin.from('customer_products').upsert({ customer_id: userId, product_id: pid, granted_by: user.id }, { onConflict: 'customer_id,product_id' })
    ))
  }

  if (amount && Number(amount) > 0) {
    await admin.from('payments').insert({
      student_id: userId, lead_id: lead_id || null, course_id: enroll_course_id || null,
      enrollment_id: enrollmentId, product_id: productIds[0] || null,
      amount: Number(amount), currency: 'VND', status: 'completed',
      gateway: 'manual', gateway_ref: `MANUAL-${Date.now()}`, order_note: order_note || null,
    })
  }

  if (lead_id) {
    await admin.from('leads').update({ converted_at: new Date().toISOString(), converted_to: userId }).eq('id', lead_id)
    await admin.from('care_history').insert({ lead_id, type: 'note', content: 'Chuyển đổi thành Khách hàng', created_by: user.id })
  }

  const portalUrl = `http://localhost:5009`
  const customerName = display_name || emailLower.split('@')[0]

  if (email_mode === 'password' && resendApiKey) {
    const resend = new Resend(resendApiKey)
    await resend.emails.send({
      from: `${appName} <onboarding@resend.dev>`,
      to: emailLower,
      subject: `Thông tin đăng nhập ${appName}`,
      html: buildWelcomeEmail({ appName, name: customerName, email: emailLower, password: finalPassword, portalUrl }),
    }).catch(e => console.warn('Resend warning:', e.message))
  } else if ((email_mode === 'magic_link' || send_magic_link) && created) {
    await admin.auth.admin.generateLink({ type: 'magiclink', email: emailLower, options: { redirectTo: portalUrl } })
  }

  return res.json({ success: true, userId, email: emailLower, created })
}

// Mirror sang Google Sheets — fire-and-forget
function mirrorToSheets(payload) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!url) return
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
  }).catch(err => console.warn('[mirror-sheets]', err?.message))
}

// --- Webhook helpers ---
const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function verifyWebhookSecret(req, res) {
  const incoming = req.headers['x-webhook-secret']
  const db = getAdminClient()
  const { data: row } = await db.from('app_settings').select('value').eq('key', 'webhook_secret').maybeSingle()
  const expected = process.env.WEBHOOK_SECRET || row?.value?.value || ''
  if (!expected || incoming !== expected) {
    res.status(401).json({ error: 'Invalid webhook secret' })
    return false
  }
  return true
}

async function handleWebhookLead(req, res) {
  const db = getAdminClient()
  const ok = await verifyWebhookSecret(req, res)
  if (!ok) return

  const { name, email, phone, source = 'landing_page',
    utm_source, utm_campaign, utm_medium, utm_term, utm_content,
    tags = [], notes, page_url } = req.body || {}

  if (!email) return res.status(400).json({ error: 'email là bắt buộc' })
  const emailLower = email.trim().toLowerCase()

  const { data: evt } = await db.from('webhook_events')
    .insert({ source: 'webhook_lead', payload: req.body, processed: false })
    .select('id').single()

  try {
    const { data: existing } = await db.from('leads').select('id, tags').eq('email', emailLower).maybeSingle()
    if (existing) {
      if (tags?.length) {
        const merged = [...new Set([...(existing.tags || []), ...tags])]
        await db.from('leads').update({ tags: merged }).eq('id', existing.id)
      }
      if (evt) await db.from('webhook_events').update({ processed: true }).eq('id', evt.id)
      mirrorToSheets({ name, email: emailLower, phone, source, utm_source, utm_campaign, utm_medium })
      return res.json({ success: true, lead_id: existing.id, existing: true })
    }

    const { data: stages } = await db.from('pipeline_stages').select('id').order('order_index', { ascending: true }).limit(1)
    const { data: lead, error } = await db.from('leads').insert({
      name: name || emailLower.split('@')[0], email: emailLower, phone: phone || null, source,
      utm_source: utm_source || null, utm_campaign: utm_campaign || null,
      utm_medium: utm_medium || null, utm_term: utm_term || null, utm_content: utm_content || null,
      tags: Array.isArray(tags) ? tags : [], notes: notes || null,
      pipeline_stage_id: stages?.[0]?.id || null, score: 10,
    }).select().single()

    if (error) throw error
    await db.from('care_history').insert({
      lead_id: lead.id, type: 'note',
      content: `Lead mới qua webhook${utm_campaign ? ` — ${utm_campaign}` : ''}${page_url ? ` — ${page_url}` : ''}`,
    })
    if (evt) await db.from('webhook_events').update({ processed: true }).eq('id', evt.id)
    mirrorToSheets({ name: lead.name, email: emailLower, phone, source, utm_source, utm_campaign, utm_medium })
    return res.json({ success: true, lead_id: lead.id, existing: false })
  } catch (err) {
    if (evt) await db.from('webhook_events').update({ processed: false, error: err.message }).eq('id', evt.id)
    return res.status(500).json({ error: err.message })
  }
}

async function handleWebhookProvision(req, res) {
  const db = getAdminClient()
  const ok = await verifyWebhookSecret(req, res)
  if (!ok) return

  const { email, name, course_id, cohort, start_date, product_id,
    amount, currency = 'VND', gateway_ref, send_magic_link = true } = req.body || {}

  if (!email) return res.status(400).json({ error: 'email là bắt buộc' })
  const emailLower = email.trim().toLowerCase()

  const { data: evt } = await db.from('webhook_events')
    .insert({ source: 'webhook_provision', payload: req.body, processed: false })
    .select('id').single()

  try {
    if (gateway_ref) {
      const { data: dup } = await db.from('payments').select('id').eq('gateway_ref', gateway_ref).maybeSingle()
      if (dup) {
        if (evt) await db.from('webhook_events').update({ processed: true }).eq('id', evt.id)
        return res.json({ success: true, skipped: true, reason: 'gateway_ref đã tồn tại' })
      }
    }

    const { data: settingsRows } = await db.from('app_settings').select('key, value').in('key', ['title', 'resend_api_key'])
    const sm = {}
    ;(settingsRows || []).forEach(r => { sm[r.key] = r.value })
    const appName = sm['title']?.value || 'Portal'
    const resendKey = process.env.RESEND_API_KEY || sm['resend_api_key']?.value || ''

    const listRes = await db.auth.admin.listUsers()
    const existing = (listRes.data?.users || []).find(u => u.email === emailLower)
    let userId, isNewUser = false

    if (existing) {
      userId = existing.id
    } else {
      const randPass = Math.random().toString(36).slice(-10) + 'Aa1!'
      const { data: newUser, error: createErr } = await db.auth.admin.createUser({ email: emailLower, password: randPass, email_confirm: true })
      if (createErr || !newUser?.user) throw new Error(createErr?.message || 'Không tạo được tài khoản')
      userId = newUser.user.id
      isNewUser = true
    }

    await db.from('customers').upsert({ id: userId, email: emailLower, display_name: name || emailLower.split('@')[0], role: 'student', payment_status: (amount && Number(amount) > 0) ? 'paid' : 'pending' })

    let enrollmentId = null
    if (course_id) {
      const { data: enr } = await db.from('customer_courses').upsert({ customer_id: userId, course_id, cohort: cohort || null, start_date: start_date || null, status: 'active' }, { onConflict: 'customer_id,course_id' }).select('id').single()
      enrollmentId = enr?.id || null
    }

    if (product_id) {
      await db.from('customer_products').upsert({ customer_id: userId, product_id }, { onConflict: 'customer_id,product_id' })
    }

    if (amount && Number(amount) > 0) {
      await db.from('payments').insert({ student_id: userId, course_id: course_id || null, product_id: product_id || null, enrollment_id: enrollmentId, amount: Number(amount), currency, status: 'completed', gateway: 'webhook', gateway_ref: gateway_ref || `WH-${Date.now()}` })
    }

    const { data: matchedLead } = await db.from('leads').select('id').eq('email', emailLower).is('converted_at', null).maybeSingle()
    if (matchedLead) {
      await db.from('leads').update({ converted_at: new Date().toISOString(), converted_to: userId }).eq('id', matchedLead.id)
    }

    const portalUrl = `http://localhost:5009`
    if (send_magic_link && isNewUser) {
      if (resendKey) {
        const resend = new Resend(resendKey)
        await resend.emails.send({ from: `${appName} <onboarding@resend.dev>`, to: emailLower, subject: `Truy cập ${appName}`, html: `<p>Xin chào, tài khoản của bạn đã sẵn sàng. Truy cập: <a href="${portalUrl}">${portalUrl}</a></p>` }).catch(e => console.warn('Resend:', e.message))
      } else {
        await db.auth.admin.generateLink({ type: 'magiclink', email: emailLower, options: { redirectTo: portalUrl } })
      }
    }

    if (evt) await db.from('webhook_events').update({ processed: true }).eq('id', evt.id)
    return res.json({ success: true, userId, email: emailLower, isNewUser })
  } catch (err) {
    console.error('[webhook/provision]', err)
    if (evt) await db.from('webhook_events').update({ processed: false, error: err.message }).eq('id', evt.id)
    return res.status(500).json({ error: err.message })
  }
}

// ─────────────────────────────────────────────
// Affiliate Module Handlers (local dev)
// ─────────────────────────────────────────────

const adminClient = () => createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function requireAdminUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const db = adminClient()
  const { data: { user } } = await createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  ).auth.getUser()
  if (!user) return null
  const { data: c } = await db.from('customers').select('role').eq('id', user.id).maybeSingle()
  return c?.role === 'admin' || c?.role === 'sales' ? user.id : null
}

async function handleAdminAffiliates(req, res) {
  const db = adminClient()
  const adminId = await requireAdminUser(req)
  if (!adminId) return res.status(403).json({ error: 'Forbidden' })

  // Parse query string từ URL
  const url = new URL(req.url, 'http://localhost')
  const previewId = url.searchParams.get('affiliate_id')

  // Preview mode: admin xem dashboard của 1 affiliate cụ thể
  if (req.method === 'GET' && previewId) {
    const { data: affiliate } = await db.from('affiliates').select('*').eq('id', previewId).maybeSingle()
    if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' })

    const refcode = affiliate.referral_code
    const [
      { count: totalClicks },
      { count: totalConversions },
      { data: commissions },
      { data: payouts },
      { data: referredLeads },
      { data: conversions },
      { data: funnels },
    ] = await Promise.all([
      db.from('affiliate_clicks').select('*', { count: 'exact', head: true }).eq('affiliate_id', previewId),
      db.from('affiliate_conversions').select('*', { count: 'exact', head: true }).eq('affiliate_id', previewId).eq('status', 'confirmed'),
      db.from('affiliate_commissions').select('commission_amount, payout_status, available_at').eq('affiliate_id', previewId),
      db.from('affiliate_payouts').select('total_amount, status, paid_at, created_at').eq('affiliate_id', previewId).order('created_at', { ascending: false }).limit(10),
      db.from('leads').select('id, name, email, source, created_at, converted_at, pipeline_stage_id, score').eq('utm_source', 'affiliate').eq('utm_campaign', refcode).order('created_at', { ascending: false }).limit(50),
      db.from('affiliate_conversions').select('id, sale_amount, status, converted_at, course:courses(title), product:products(name)').eq('affiliate_id', previewId).order('converted_at', { ascending: false }).limit(20),
      db.from('funnels').select('id, slug, name, description, url, type').eq('is_active', true).order('sort_order', { ascending: true }),
    ])

    const now = new Date()
    const pendingAmount   = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) > now).reduce((s, c) => s + c.commission_amount, 0)
    const availableAmount = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) <= now).reduce((s, c) => s + c.commission_amount, 0)
    const paidAmount      = (commissions || []).filter(c => c.payout_status === 'paid').reduce((s, c) => s + c.commission_amount, 0)
    const baseUrl = process.env.PORTAL_URL || 'http://localhost:5009'

    return res.json({
      affiliate: { id: affiliate.id, status: affiliate.status, referral_code: refcode, referral_url: `${baseUrl}/?ref=${refcode}`, commission_rate: affiliate.commission_rate, payout_method: affiliate.payout_method, display_name: affiliate.display_name },
      stats: {
        total_clicks: totalClicks || 0,
        total_leads: (referredLeads || []).length,
        total_conversions: totalConversions || 0,
        conversion_rate: (referredLeads || []).length > 0 ? (((totalConversions || 0) / (referredLeads || []).length) * 100).toFixed(1) : '0',
        commissions: { pending: pendingAmount, available: availableAmount, paid: paidAmount },
      },
      referred_leads: (referredLeads || []).map(l => ({ ...l, is_converted: !!l.converted_at })),
      orders: (conversions || []).map(c => ({ id: c.id, sale_amount: c.sale_amount, status: c.status, converted_at: c.converted_at, product_name: c.course?.title || c.product?.name || 'Sản phẩm' })),
      payouts: payouts || [],
      funnels: (funnels || []).map(f => ({ id: f.id, slug: f.slug, name: f.name, description: f.description, type: f.type, url: f.url, share_url: `${f.url}/?ref=${refcode}` })),
      _preview: true,
    })
  }

  if (req.method === 'GET') {
    const { data: affiliates, error } = await db
      .from('affiliates')
      .select(`
        *,
        customer:customers!affiliates_customer_id_fkey(id, email, display_name),
        lead:leads(id, name, email),
        clicks:affiliate_clicks(count),
        conversions:affiliate_conversions(count),
        commissions:affiliate_commissions(commission_amount, payout_status)
      `)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })

    const enriched = (affiliates || []).map(a => {
      const comms = a.commissions || []
      return {
        ...a,
        // Fallback hiển thị: customer trước, fallback sang lead
        customer: a.customer || (a.lead ? { id: null, email: a.lead.email, display_name: a.lead.name } : null),
        total_earned: comms.reduce((s, c) => s + (c.commission_amount || 0), 0),
        total_paid:   comms.filter(c => c.payout_status === 'paid').reduce((s, c) => s + (c.commission_amount || 0), 0),
      }
    })

    // Stats tổng: doanh thu + đơn hàng từ tất cả affiliate
    const { data: allConversions } = await db
      .from('affiliate_conversions')
      .select('id, sale_amount, status, converted_at, affiliate_id, course:courses(title), product:products(name), customer:customers(email, display_name), affiliate:affiliates(display_name, referral_code)')
      .eq('status', 'confirmed')
      .order('converted_at', { ascending: false })

    const totalRevenue = (allConversions || []).reduce((s, c) => s + (c.sale_amount || 0), 0)
    const totalOrders  = (allConversions || []).length

    return res.json({
      affiliates: enriched,
      stats: { total_revenue: totalRevenue, total_orders: totalOrders },
      orders: (allConversions || []).map(c => ({
        id: c.id,
        sale_amount: c.sale_amount,
        converted_at: c.converted_at,
        product_name: c.course?.title || c.product?.name || 'Sản phẩm',
        customer_name: c.customer?.display_name || c.customer?.email || '—',
        customer_email: c.customer?.email || '—',
        affiliate_name: c.affiliate?.display_name || '—',
        affiliate_code: c.affiliate?.referral_code || '—',
      })),
    })
  }

  if (req.method === 'POST') {
    const { lead_id, customer_id, commission_rate } = req.body
    if (!lead_id && !customer_id) return res.status(400).json({ error: 'lead_id hoặc customer_id là bắt buộc' })

    if (lead_id) {
      const { data: lead } = await db.from('leads').select('id, name, email, refcode').eq('id', lead_id).maybeSingle()
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      const { data: existing } = await db.from('affiliates').select('id, status').eq('lead_id', lead_id).maybeSingle()
      if (existing) return res.status(409).json({ error: 'Lead đã là affiliate', affiliate: existing })

      const referral_code = lead.refcode
      let authUserId
      const { data: { users } } = await db.auth.admin.listUsers()
      const existingUser = users?.find(u => u.email === lead.email)
      if (existingUser) {
        authUserId = existingUser.id
        const { data: existingCust } = await db.from('customers').select('id, role').eq('id', authUserId).maybeSingle()
        if (!existingCust) {
          await db.from('customers').insert({ id: authUserId, email: lead.email, display_name: lead.name, role: 'affiliate', payment_status: 'pending' })
        }
      } else {
        const { data: newUser, error: createErr } = await db.auth.admin.createUser({ email: lead.email, email_confirm: true, user_metadata: { display_name: lead.name } })
        if (createErr || !newUser?.user) return res.status(500).json({ error: createErr?.message || 'Không tạo được user' })
        authUserId = newUser.user.id
        await db.from('customers').insert({ id: authUserId, email: lead.email, display_name: lead.name, role: 'affiliate', payment_status: 'pending' })
      }

      const { data: affiliate, error: affErr } = await db.from('affiliates').insert({
        customer_id: authUserId, lead_id, display_name: lead.name, referral_code,
        commission_rate: commission_rate ?? 30, payout_method: 'bank_transfer', payout_details: {},
        status: 'approved', approved_at: new Date().toISOString(), approved_by: adminId,
      }).select().single()
      if (affErr) return res.status(500).json({ error: affErr.message })

      // Magic link email
      const portalUrl = process.env.PORTAL_URL || `http://localhost:5009`
      await db.auth.admin.generateLink({ type: 'magiclink', email: lead.email, options: { redirectTo: `${portalUrl}/affiliate` } })
      await db.from('leads').update({ converted_to: authUserId, converted_at: new Date().toISOString() }).eq('id', lead_id)

      return res.status(201).json({ affiliate, referral_url: `/?ref=${referral_code}`, message: `Magic link đã gửi tới ${lead.email}` })
    }

    // Customer case
    const { data: customer } = await db.from('customers').select('id, display_name, email').eq('id', customer_id).maybeSingle()
    if (!customer) return res.status(404).json({ error: 'Customer not found' })
    const { data: existingByCust } = await db.from('affiliates').select('id').eq('customer_id', customer_id).maybeSingle()
    if (existingByCust) return res.status(409).json({ error: 'Đã là affiliate', affiliate: existingByCust })

    const { data: matchedLead } = await db.from('leads').select('id, refcode').eq('email', customer.email).maybeSingle()
    let referral_code = matchedLead?.refcode || ''
    if (!referral_code) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      for (let i = 0; i < 5; i++) {
        referral_code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        const { data: conflict } = await db.from('affiliates').select('id').eq('referral_code', referral_code).maybeSingle()
        if (!conflict) break
      }
    }

    const { data: affiliate, error } = await db.from('affiliates').insert({
      customer_id, lead_id: matchedLead?.id || null, display_name: customer.display_name, referral_code,
      commission_rate: commission_rate ?? 30, payout_method: 'bank_transfer', payout_details: {},
      status: 'approved', approved_at: new Date().toISOString(), approved_by: adminId,
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ affiliate, referral_url: `/?ref=${referral_code}` })
  }

  if (req.method === 'PATCH') {
    const { id, status, commission_rate, payout_method, payout_details } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const updates = { updated_at: new Date().toISOString() }
    if (status) {
      updates.status = status
      if (status === 'approved') { updates.approved_at = new Date().toISOString(); updates.approved_by = adminId }
    }
    if (commission_rate !== undefined) updates.commission_rate = commission_rate
    if (payout_method)  updates.payout_method  = payout_method
    if (payout_details) updates.payout_details = payout_details
    const { data, error } = await db.from('affiliates').update(updates).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ affiliate: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleAdminAffiliatesPayouts(req, res) {
  const db = adminClient()
  const adminId = await requireAdminUser(req)
  if (!adminId) return res.status(403).json({ error: 'Forbidden' })

  if (req.method === 'GET') {
    const { data: commissions } = await db
      .from('affiliate_commissions')
      .select('*, affiliate:affiliates(id, display_name, referral_code, payout_method, payout_details, customer:customers(email))')
      .eq('payout_status', 'pending')
      .lte('available_at', new Date().toISOString())
      .order('available_at', { ascending: true })

    const byAffiliate = {}
    for (const c of commissions || []) {
      const aid = c.affiliate.id
      if (!byAffiliate[aid]) byAffiliate[aid] = { affiliate: c.affiliate, commissions: [], total: 0 }
      byAffiliate[aid].commissions.push(c)
      byAffiliate[aid].total += c.commission_amount
    }
    const { data: existingPayouts } = await db.from('affiliate_payouts').select('*').eq('status', 'pending').order('created_at', { ascending: false })
    return res.json({ available_by_affiliate: Object.values(byAffiliate), pending_payouts: existingPayouts || [] })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleAffiliateRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const userClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })

  const db = adminClient()
  const { data: existing } = await db.from('affiliates').select('id, status').eq('customer_id', user.id).maybeSingle()
  if (existing) return res.status(409).json({ error: 'Already registered', status: existing.status, affiliate_id: existing.id })

  const { display_name, bio, payout_method, payout_details } = req.body
  if (!display_name) return res.status(400).json({ error: 'display_name required' })

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let referral_code = ''
  for (let i = 0; i < 5; i++) {
    referral_code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    const { data: conflict } = await db.from('affiliates').select('id').eq('referral_code', referral_code).maybeSingle()
    if (!conflict) break
  }

  const { data: affiliate, error } = await db.from('affiliates').insert({
    customer_id: user.id, display_name, bio, referral_code,
    payout_method: payout_method || 'bank_transfer', payout_details: payout_details || {},
    status: 'pending',
  }).select().single()
  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json({ message: 'Đăng ký thành công. Vui lòng chờ admin phê duyệt.', affiliate })
}

async function handleAffiliateDashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const userClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })

  const db = adminClient()
  const { data: affiliate } = await db.from('affiliates').select('*').eq('customer_id', user.id).maybeSingle()
  if (!affiliate) return res.status(404).json({ error: 'Not an affiliate' })

  const refcode = affiliate.referral_code

  const [
    { count: totalClicks },
    { count: totalConversions },
    { data: commissions },
    { data: payouts },
    { data: referredLeads },
    { data: conversions },
    { data: funnels },
  ] = await Promise.all([
    db.from('affiliate_clicks').select('*', { count: 'exact', head: true }).eq('affiliate_id', affiliate.id),
    db.from('affiliate_conversions').select('*', { count: 'exact', head: true }).eq('affiliate_id', affiliate.id).eq('status', 'confirmed'),
    db.from('affiliate_commissions').select('commission_amount, payout_status, available_at').eq('affiliate_id', affiliate.id),
    db.from('affiliate_payouts').select('total_amount, status, paid_at, created_at').eq('affiliate_id', affiliate.id).order('created_at', { ascending: false }).limit(10),
    db.from('leads').select('id, name, email, source, created_at, converted_at, pipeline_stage_id, score').eq('utm_source', 'affiliate').eq('utm_campaign', refcode).order('created_at', { ascending: false }).limit(50),
    db.from('affiliate_conversions').select('id, sale_amount, status, converted_at, course:courses(title), product:products(name)').eq('affiliate_id', affiliate.id).order('converted_at', { ascending: false }).limit(20),
    db.from('funnels').select('id, slug, name, description, url, type').eq('is_active', true).order('sort_order', { ascending: true }),
  ])

  const now = new Date()
  const pendingAmount   = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) > now).reduce((s, c) => s + c.commission_amount, 0)
  const availableAmount = (commissions || []).filter(c => c.payout_status === 'pending' && new Date(c.available_at) <= now).reduce((s, c) => s + c.commission_amount, 0)
  const paidAmount      = (commissions || []).filter(c => c.payout_status === 'paid').reduce((s, c) => s + c.commission_amount, 0)
  const baseUrl = process.env.PORTAL_URL || 'http://localhost:5009'

  return res.json({
    affiliate: { id: affiliate.id, status: affiliate.status, referral_code: refcode, referral_url: `${baseUrl}/?ref=${refcode}`, commission_rate: affiliate.commission_rate, payout_method: affiliate.payout_method },
    stats: {
      total_clicks: totalClicks || 0,
      total_leads: (referredLeads || []).length,
      total_conversions: totalConversions || 0,
      conversion_rate: (referredLeads || []).length > 0 ? (((totalConversions || 0) / (referredLeads || []).length) * 100).toFixed(1) : '0',
      commissions: { pending: pendingAmount, available: availableAmount, paid: paidAmount },
    },
    referred_leads: (referredLeads || []).map(l => ({ ...l, is_converted: !!l.converted_at })),
    orders: (conversions || []).map(c => ({ id: c.id, sale_amount: c.sale_amount, status: c.status, converted_at: c.converted_at, product_name: c.course?.title || c.product?.name || 'Sản phẩm' })),
    payouts: payouts || [],
    funnels: (funnels || []).map(f => ({ id: f.id, slug: f.slug, name: f.name, description: f.description, type: f.type, url: f.url, share_url: `${f.url}/?ref=${refcode}` })),
  })
}

async function handleTrackingRef(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const url = new URL(req.url, 'http://localhost')
  const code = (url.searchParams.get('code') || '').toUpperCase().trim()
  if (!code) return res.status(400).json({ error: 'Missing ref code' })

  const db = adminClient()
  const { data: affiliate } = await db.from('affiliates').select('id, status').eq('referral_code', code).maybeSingle()
  if (!affiliate) return res.status(404).json({ error: 'Invalid referral code' })
  if (affiliate.status !== 'approved') return res.status(403).json({ error: 'Affiliate not active' })

  const clickId = crypto.randomUUID()
  await db.from('affiliate_clicks').insert({
    affiliate_id: affiliate.id, click_id: clickId,
    visitor_ip: req.headers['x-forwarded-for'] || null,
    user_agent: req.headers['user-agent'], referrer: req.headers['referer'], landing_url: req.headers['referer'],
  })
  return res.json({ click_id: clickId, referral_code: code, expires_in: 30 * 24 * 60 * 60 })
}

async function handleAdminFunnels(req, res) {
  const db = adminClient()
  const adminId = await requireAdminUser(req)
  if (!adminId) return res.status(403).json({ error: 'Forbidden' })

  const url = new URL(req.url, 'http://localhost')

  if (req.method === 'GET') {
    const { data, error } = await db.from('funnels').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ funnels: data || [] })
  }

  if (req.method === 'POST') {
    const { slug, name, description, url: funnelUrl, type, course_id, product_id, sort_order } = req.body
    if (!slug || !name || !funnelUrl) return res.status(400).json({ error: 'slug, name, url là bắt buộc' })
    const cleanUrl = String(funnelUrl).trim().replace(/\/+$/, '')

    const { data, error } = await db.from('funnels').insert({
      slug: String(slug).trim().toLowerCase(),
      name, description, url: cleanUrl,
      type: type || 'sales',
      course_id: course_id || null,
      product_id: product_id || null,
      sort_order: sort_order ?? 0,
      is_active: true,
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ funnel: data })
  }

  if (req.method === 'PATCH') {
    const { id, slug, name, description, url: funnelUrl, type, course_id, product_id, sort_order, is_active } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const updates = {}
    if (slug !== undefined)        updates.slug = String(slug).trim().toLowerCase()
    if (name !== undefined)        updates.name = name
    if (description !== undefined) updates.description = description
    if (funnelUrl !== undefined)   updates.url = String(funnelUrl).trim().replace(/\/+$/, '')
    if (type !== undefined)        updates.type = type
    if (course_id !== undefined)   updates.course_id = course_id || null
    if (product_id !== undefined)  updates.product_id = product_id || null
    if (sort_order !== undefined)  updates.sort_order = sort_order
    if (is_active !== undefined)   updates.is_active = is_active
    const { data, error } = await db.from('funnels').update(updates).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ funnel: data })
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') || req.body?.id
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await db.from('funnels').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleCatalog(req, res) {
  const db = getAdminClient()
  const ok = await verifyWebhookSecret(req, res)
  if (!ok) return

  try {
    const [coursesRes, productsRes] = await Promise.all([
      db.from('courses').select('id, title, price').order('created_at', { ascending: false }),
      db.from('products').select('id, name, type, price').eq('status', 'active').order('created_at', { ascending: false }),
    ])

    if (coursesRes.error) throw coursesRes.error
    if (productsRes.error) throw productsRes.error

    return res.json({
      courses:  (coursesRes.data  || []).map(c => ({ id: c.id, title: c.title,  price: c.price })),
      products: (productsRes.data || []).map(p => ({ id: p.id, name: p.name, type: p.type, price: p.price })),
    })
  } catch (err) {
    console.error('[catalog]', err)
    return res.status(500).json({ error: err.message })
  }
}

// --- Email Handlers (mirror api/email/*.ts for dev + Railway) ---
const TEMPLATES_DIR = resolve('emails/templates')
const _tplCache = new Map()

function loadTpl(name) {
  if (_tplCache.has(name)) return _tplCache.get(name)
  const p = join(TEMPLATES_DIR, `${name}.html`)
  if (!existsSync(p)) throw new Error(`Template not found: ${name}.html`)
  const c = readFileSync(p, 'utf8')
  _tplCache.set(name, c)
  return c
}

function renderTpl(tpl, data) {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k, b) => data[k] ? b : '')
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] != null ? String(data[k]) : '')
  return out
}

function renderEmail(template, data) {
  const layout = loadTpl('_layout')
  const content = renderTpl(loadTpl(template), data)
  return renderTpl(layout, { ...data, content })
}

const VALID_EMAIL_TEMPLATES = ['welcome-magic-link','welcome-credentials','password-reset','enrollment','payment-confirmation','certificate','broadcast']

async function getAppNameAndResendKey() {
  let appName = 'Portal', resendKey = process.env.RESEND_API_KEY || ''
  try {
    const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data } = await db.from('app_settings').select('key, value').in('key', ['title', 'resend_api_key'])
    if (data) {
      const m = {}
      data.forEach(r => { m[r.key] = r.value })
      appName = m.title?.value || appName
      if (!resendKey) resendKey = m.resend_api_key?.value || ''
    }
  } catch {}
  return { appName, resendKey }
}

async function handleEmailSend(req, res) {
  const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const incoming = req.headers['x-webhook-secret']
  const { data: secretRow } = await db.from('app_settings').select('value').eq('key', 'webhook_secret').maybeSingle()
  const expected = process.env.WEBHOOK_SECRET || secretRow?.value?.value || ''
  if (!expected || incoming !== expected) return res.status(401).json({ error: 'Invalid webhook secret' })

  const { to, subject, template, data, from, replyTo } = req.body || {}
  if (!to || !subject || !template) return res.status(400).json({ error: 'to, subject, template required' })
  if (!VALID_EMAIL_TEMPLATES.includes(template)) return res.status(400).json({ error: `Invalid template. Valid: ${VALID_EMAIL_TEMPLATES.join(', ')}` })

  const { appName, resendKey } = await getAppNameAndResendKey()
  if (!resendKey) return res.status(500).json({ error: 'No RESEND_API_KEY configured' })

  try {
    const html = renderEmail(template, { appName, ...(data || {}) })
    const resend = new Resend(resendKey)
    const r = await resend.emails.send({
      from: from || `${appName} <onboarding@resend.dev>`,
      to: Array.isArray(to) ? to : [to],
      subject, html, replyTo,
    })
    if (r.error) return res.status(500).json({ error: r.error.message, provider: 'resend' })
    return res.json({ success: true, id: r.data?.id, provider: 'resend' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

async function handleEmailBroadcast(req, res) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)
  const userClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || caller.role !== 'admin') return res.status(403).json({ error: 'Admin only' })

  const { audience, course_id, emails, subject, body: bodyText, ctaUrl, ctaText } = req.body || {}
  if (!audience || !subject || !bodyText) return res.status(400).json({ error: 'audience, subject, body required' })

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  let recipients = []
  if (audience === 'all-students') {
    const { data } = await admin.from('customers').select('email, display_name').eq('role', 'student').not('email', 'is', null)
    recipients = (data || []).map(r => ({ email: r.email, name: r.display_name || r.email.split('@')[0] }))
  } else if (audience === 'course') {
    if (!course_id) return res.status(400).json({ error: 'course_id required' })
    const { data } = await admin.from('customer_courses').select('customers!inner(email, display_name)').eq('course_id', course_id).eq('status', 'active')
    recipients = (data || []).map(r => ({ email: r.customers.email, name: r.customers.display_name || r.customers.email.split('@')[0] }))
  } else if (audience === 'custom') {
    if (!Array.isArray(emails) || !emails.length) return res.status(400).json({ error: 'emails[] required' })
    recipients = emails.map(e => ({ email: e, name: e.split('@')[0] }))
  } else {
    return res.status(400).json({ error: `Unknown audience: ${audience}` })
  }

  if (recipients.length === 0) return res.json({ success: true, sent: 0, failed: 0, message: 'No recipients' })

  const { appName, resendKey } = await getAppNameAndResendKey()
  if (!resendKey) return res.status(500).json({ error: 'No RESEND_API_KEY' })

  const resend = new Resend(resendKey)
  const portalUrl = req.headers.origin || process.env.CUSTOMER_PORTAL_URL || ''
  let sent = 0, failed = 0
  const errors = []
  const BATCH = 10, SLEEP = 1000

  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH)
    const results = await Promise.all(batch.map(async r => {
      try {
        const html = renderEmail('broadcast', {
          appName, name: r.name, body: bodyText,
          ctaUrl: ctaUrl || '', ctaText: ctaText || 'Xem chi tiết',
          unsubscribeUrl: `${portalUrl}/unsubscribe?email=${encodeURIComponent(r.email)}`,
        })
        const out = await resend.emails.send({
          from: `${appName} <onboarding@resend.dev>`,
          to: [r.email], subject, html,
        })
        return { email: r.email, ok: !out.error, error: out.error?.message }
      } catch (e) { return { email: r.email, ok: false, error: e.message } }
    }))
    for (const x of results) { if (x.ok) sent++; else { failed++; errors.push({ email: x.email, error: x.error }) } }
    if (i + BATCH < recipients.length) await new Promise(r => setTimeout(r, SLEEP))
  }

  return res.json({ success: true, sent, failed, total: recipients.length, errors: errors.slice(0, 20) })
}

async function handleHealth(req, res) {
  const checks = {}
  let allOk = true
  checks.supabase_url = process.env.VITE_SUPABASE_URL ? 'set' : 'missing'
  checks.supabase_anon = process.env.VITE_SUPABASE_ANON_KEY ? 'set' : 'missing'
  checks.supabase_service = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'missing'
  checks.resend = process.env.RESEND_API_KEY ? 'set' : 'unset'
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    try {
      const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
      const { error } = await db.from('app_settings').select('key').limit(1)
      checks.db = error ? `error: ${error.message}` : 'ok'
      if (error) allOk = false
    } catch (e) { checks.db = `exception: ${e.message}`; allOk = false }
  } else { checks.db = 'skipped'; allOk = false }
  return res.status(200).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7) || process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0,7) || 'dev',
    checks,
  })
}

// --- Static file serving (Railway prod mode) ---
function serveStatic(req, nodeRes) {
  if (!SERVE_STATIC) return false
  const url = new URL(req.url, 'http://localhost')
  let filePath = join(DIST_DIR, url.pathname)
  // SPA fallback: if file doesn't exist and no extension, serve index.html
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (!extname(url.pathname)) filePath = join(DIST_DIR, 'index.html')
    else { nodeRes.writeHead(404); nodeRes.end('Not found'); return true }
  }
  const ext = extname(filePath).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  try {
    const content = readFileSync(filePath)
    nodeRes.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    })
    nodeRes.end(content)
    return true
  } catch {
    nodeRes.writeHead(500); nodeRes.end('Static serve error'); return true
  }
}

// --- HTTP Server ---
const server = http.createServer(async (req, nodeRes) => {
  const res = makeRes(nodeRes)

  // CORS preflight
  nodeRes.setHeader('Access-Control-Allow-Origin', '*')
  nodeRes.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-webhook-secret')
  nodeRes.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    nodeRes.writeHead(200)
    nodeRes.end()
    return
  }

  // Parse body
  let body = ''
  for await (const chunk of req) body += chunk
  let parsedBody = {}
  try { parsedBody = body ? JSON.parse(body) : {} } catch {}

  const mockReq = { method: req.method, url: req.url, headers: req.headers, body: parsedBody }

  try {
    if (req.url === '/api/admin-create-customer') {
      await handleAdminCreateCustomer(mockReq, res)
    } else if (req.url === '/api/webhook/lead') {
      await handleWebhookLead(mockReq, res)
    } else if (req.url === '/api/webhook/provision') {
      await handleWebhookProvision(mockReq, res)
    } else if (req.url === '/api/catalog') {
      await handleCatalog(mockReq, res)
    } else if (req.url?.startsWith('/api/admin/affiliates/payouts')) {
      await handleAdminAffiliatesPayouts(mockReq, res)
    } else if (req.url?.startsWith('/api/admin/affiliates')) {
      await handleAdminAffiliates(mockReq, res)
    } else if (req.url?.startsWith('/api/admin/funnels')) {
      await handleAdminFunnels(mockReq, res)
    } else if (req.url === '/api/affiliates/register') {
      await handleAffiliateRegister(mockReq, res)
    } else if (req.url === '/api/affiliates/dashboard') {
      await handleAffiliateDashboard(mockReq, res)
    } else if (req.url?.startsWith('/api/tracking/ref')) {
      await handleTrackingRef(mockReq, res)
    } else if (req.url === '/api/email/send') {
      await handleEmailSend(mockReq, res)
    } else if (req.url === '/api/email/broadcast') {
      await handleEmailBroadcast(mockReq, res)
    } else if (req.url === '/api/health' || req.url?.startsWith('/api/health?')) {
      await handleHealth(mockReq, res)
    } else if (!req.url?.startsWith('/api/')) {
      // Non-API request: try static (Railway prod) then 404
      if (serveStatic(req, nodeRes)) return
      res.status(404).json({ error: 'Not found' })
    } else {
      res.status(404).json({ error: 'Not found' })
    }
  } catch (err) {
    console.error('[api-server]', err)
    res.status(500).json({ error: err.message })
  }
})

server.listen(PORT, () => {
  const mode = SERVE_STATIC ? 'production (serving dist/)' : 'dev (API only)'
  console.log(`\x1b[32m✓\x1b[0m API server on http://localhost:${PORT} — mode: ${mode}`)
})
