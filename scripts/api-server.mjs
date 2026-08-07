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
    send(body) {
      if (!nodeRes.headersSent) {
        // If handler set Content-Type via setHeader, headers[] already has it.
        // Default was application/json; if handler wants text/html, they call setHeader first.
        nodeRes.writeHead(statusCode, headers)
        if (body == null) nodeRes.end()
        else if (typeof body === 'string' || Buffer.isBuffer(body)) nodeRes.end(body)
        else nodeRes.end(String(body))
      }
      return res
    },
    end(...args) {
      if (!nodeRes.headersSent) nodeRes.writeHead(statusCode, headers)
      nodeRes.end(...args)
      return res
    },
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

// --- AI / OAuth Handlers (mirror api/oauth/openai/*.ts + api/ai/*.ts) ---
import crypto2 from 'node:crypto'

const OPENAI_ISSUER = 'https://auth.openai.com'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const CODEX_UA = 'customer-portal-giftbox/1.0'

function encryptToken(plain) {
  const hex = process.env.PROVIDER_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) throw new Error('PROVIDER_ENCRYPTION_KEY must be 64 hex chars')
  const key = Buffer.from(hex, 'hex')
  const iv = crypto2.randomBytes(12)
  const cipher = crypto2.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

function decryptToken(payload) {
  if (!payload) return ''
  const hex = process.env.PROVIDER_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) throw new Error('PROVIDER_ENCRYPTION_KEY must be 64 hex chars')
  const key = Buffer.from(hex, 'hex')
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  const decipher = crypto2.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

async function assertAdmin(req, res) {
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing token' }); return null }
  const token = authHeader.slice(7)
  const userClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) { res.status(401).json({ error: 'Invalid token' }); return null }
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (caller?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return null }
  return user
}

function adminDbClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

async function handleOAuthOpenAIStart(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  try {
    const resp = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': CODEX_UA },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    })
    if (resp.status === 429) return res.status(429).json({ error: 'OpenAI rate limited (429)' })
    if (!resp.ok) return res.status(500).json({ error: `Device code request HTTP ${resp.status}` })
    const data = await resp.json()
    if (!data.user_code || !data.device_auth_id) return res.status(500).json({ error: 'Malformed device code response' })
    const interval = Math.max(3, Number(data.interval) || 5)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    const db = adminDbClient()
    const { data: session, error } = await db.from('oauth_device_sessions').insert({
      provider: 'openai-codex', device_auth_id: data.device_auth_id, user_code: data.user_code,
      verification_uri: `${OPENAI_ISSUER}/codex/device`, poll_interval_seconds: interval,
      expires_at: expiresAt.toISOString(), status: 'pending', created_by: user.id,
    }).select('id').single()
    if (error || !session) return res.status(500).json({ error: `Session persist failed: ${error?.message}` })
    return res.json({
      session_id: session.id, user_code: data.user_code,
      verification_uri: `${OPENAI_ISSUER}/codex/device`,
      poll_interval: interval, expires_at: expiresAt.toISOString(),
    })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

async function handleOAuthOpenAIPoll(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const { session_id } = req.body || {}
  if (!session_id) return res.status(400).json({ error: 'session_id required' })
  const db = adminDbClient()
  const { data: session } = await db.from('oauth_device_sessions').select('*').eq('id', session_id).maybeSingle()
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (new Date(session.expires_at) < new Date()) {
    await db.from('oauth_device_sessions').update({ status: 'expired' }).eq('id', session_id)
    return res.json({ status: 'expired' })
  }
  if (session.status !== 'pending') return res.json({ status: session.status })
  try {
    const pollResp = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': CODEX_UA },
      body: JSON.stringify({ device_auth_id: session.device_auth_id, user_code: session.user_code }),
    })
    if (pollResp.status === 403 || pollResp.status === 404) return res.json({ status: 'pending' })
    if (pollResp.status !== 200) return res.status(500).json({ status: 'error', error: `Poll HTTP ${pollResp.status}` })
    const pollData = await pollResp.json()
    const { authorization_code, code_verifier } = pollData
    if (!authorization_code || !code_verifier) return res.status(500).json({ status: 'error', error: 'Missing auth_code/verifier' })
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: authorization_code,
      redirect_uri: `${OPENAI_ISSUER}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID, code_verifier,
    })
    const tokResp = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CODEX_UA },
      body: body.toString(),
    })
    if (!tokResp.ok) return res.status(500).json({ status: 'error', error: `Token exchange HTTP ${tokResp.status}` })
    const tokens = await tokResp.json()
    if (!tokens.access_token) return res.status(500).json({ status: 'error', error: 'No access_token' })
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null
    await db.from('provider_credentials').upsert({
      provider: 'openai-codex', auth_type: 'oauth_device_code', display_name: 'ChatGPT (subscription)',
      status: 'active',
      access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      base_url: CODEX_BASE_URL, expires_at: expiresAt?.toISOString() || null,
      scopes: tokens.scope ? tokens.scope.split(' ') : null,
      connected_at: new Date().toISOString(), last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider' })
    await db.from('oauth_device_sessions').update({
      status: 'authorized', authorized_at: new Date().toISOString(),
    }).eq('id', session_id)
    return res.json({ status: 'authorized', provider: 'openai-codex', expires_at: expiresAt?.toISOString() || null })
  } catch (e) { return res.status(500).json({ status: 'error', error: e.message }) }
}

async function handleOAuthOpenAIStatus(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const db = adminDbClient()
  const { data: cred } = await db.from('provider_credentials')
    .select('provider, auth_type, display_name, status, base_url, expires_at, account_email, connected_at, last_refreshed_at, last_used_at')
    .eq('provider', 'openai-codex').maybeSingle()
  if (!cred) return res.json({ connected: false })
  const expired = cred.expires_at && new Date(cred.expires_at) < new Date()
  return res.json({ ...cred, connected: cred.status === 'active' && !expired, expired })
}

async function handleOAuthOpenAIDisconnect(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const db = adminDbClient()
  const { error } = await db.from('provider_credentials').delete().eq('provider', 'openai-codex')
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ success: true })
}

async function loadCredForRuntime(provider) {
  const db = adminDbClient()
  const { data: cred } = await db.from('provider_credentials').select('*').eq('provider', provider).maybeSingle()
  if (!cred || cred.status !== 'active') throw new Error(`Provider ${provider} not connected`)
  let accessToken = decryptToken(cred.access_token_encrypted)
  const expiresAt = cred.expires_at ? new Date(cred.expires_at) : null
  const expiringSoon = expiresAt && (expiresAt.getTime() - Date.now() < 120 * 1000)
  if (expiringSoon && cred.refresh_token_encrypted) {
    const refreshToken = decryptToken(cred.refresh_token_encrypted)
    const body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CODEX_CLIENT_ID,
    })
    const resp = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CODEX_UA },
      body: body.toString(),
    })
    if (resp.ok) {
      const tokens = await resp.json()
      accessToken = tokens.access_token
      const newExpires = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null
      await db.from('provider_credentials').update({
        access_token_encrypted: encryptToken(tokens.access_token),
        refresh_token_encrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : cred.refresh_token_encrypted,
        expires_at: newExpires?.toISOString() || null,
        last_refreshed_at: new Date().toISOString(),
      }).eq('provider', provider)
    }
  }
  db.from('provider_credentials').update({ last_used_at: new Date().toISOString() }).eq('provider', provider).then(()=>{},()=>{})
  return { accessToken, baseUrl: cred.base_url || CODEX_BASE_URL }
}

function _codexHeaders(accessToken) {
  const h = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=v1',
    'User-Agent': 'codex_cli_rs/0.0.0 (customer-portal-giftbox)',
    'originator': 'codex_cli_rs',
  }
  const acctId = extractAccountIdFromJwt(accessToken)
  if (acctId) h['ChatGPT-Account-ID'] = acctId
  return h
}

async function handleAIModels(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const url = new URL(req.url, 'http://localhost')
  const provider = url.searchParams.get('provider') || 'openai-codex'
  try {
    const cred = await loadCredForRuntime(provider)
    const resp = await fetch(`${cred.baseUrl}/models?client_version=0.0.0`, {
      headers: _codexHeaders(cred.accessToken),
    })
    if (!resp.ok) return res.json({ provider, models: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.1', 'gpt-4o'] })
    const data = await resp.json()
    const ids = (data.data || []).map(m => m.id).filter(Boolean)
    return res.json({ provider, models: ids.length ? ids : ['gpt-5.6-sol'] })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

async function _readCodexStream(response) {
  if (!response.body) throw new Error('Codex response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = '', text = '', usage
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const dataLines = []
      for (const line of rawEvent.split('\n')) if (line.startsWith('data: ')) dataLines.push(line.slice(6))
      if (!dataLines.length) continue
      const dataStr = dataLines.join('\n')
      if (dataStr === '[DONE]') continue
      try {
        const evt = JSON.parse(dataStr)
        if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') text += evt.delta
        else if (evt.type === 'response.completed' && evt.response) {
          if (evt.response.usage) usage = evt.response.usage
          if (!text && Array.isArray(evt.response.output)) {
            for (const item of evt.response.output) if (item.type === 'message' && Array.isArray(item.content))
              for (const c of item.content) if (c.type === 'output_text' && c.text) text += c.text
          }
        }
      } catch {}
    }
  }
  return { text, usage }
}

async function handleAIGenerate(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const { provider = 'openai-codex', model = 'gpt-5.6-sol', systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.7 } = req.body || {}
  if (!userPrompt) return res.status(400).json({ error: 'userPrompt required' })
  try {
    const cred = await loadCredForRuntime(provider)
    const body = {
      model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: userPrompt }] }],
      store: false, stream: true,
    }
    if (systemPrompt) body.instructions = systemPrompt
    // NOTE: Codex chatgpt.com/backend-api rejects max_output_tokens + temperature.
    const resp = await fetch(`${cred.baseUrl}/responses`, {
      method: 'POST',
      headers: { ..._codexHeaders(cred.accessToken), 'Accept': 'text/event-stream' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      return res.status(500).json({ error: `Codex HTTP ${resp.status}: ${t.slice(0, 300)}` })
    }
    const { text, usage } = await _readCodexStream(resp)
    return res.json({ text, model, provider, usage })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

// --- Generic dynamic loader for TS endpoints ---
// Uses tsx --import to allow importing .ts files at runtime.
// Maps /api/foo/bar → api/foo/bar.ts OR api/foo/bar/index.ts
async function handleViaImport(req, res, urlPath) {
  // Strip query string
  const cleanPath = urlPath.split('?')[0]  // e.g. /api/funnel-steps
  const relPath = cleanPath.replace(/^\/api\//, '')  // funnel-steps
  const parts = relPath.split('/').filter(Boolean)

  // Try: api/<parts>.ts, api/<parts>/index.ts
  const { existsSync } = await import('node:fs')
  const { resolve: pathResolve } = await import('node:path')

  const tryPaths = [
    pathResolve('api', ...parts) + '.ts',
    pathResolve('api', ...parts, 'index.ts'),
  ]
  const found = tryPaths.find(p => existsSync(p))
  if (!found) {
    return res.status(404).json({ error: `No handler for ${cleanPath}` })
  }

  try {
    const mod = await import(found + `?t=${Date.now()}`)  // cache-bust for dev hot-reload
    if (typeof mod.default !== 'function') {
      return res.status(500).json({ error: `${found} has no default export function` })
    }
    // Adapt: mockReq → VercelRequest-shape; res is already compatible
    await mod.default(req, res)
  } catch (e) {
    console.error(`[handleViaImport ${cleanPath}]`, e)
    return res.status(500).json({ error: e.message })
  }
}

// --- Copy Formulas CRUD ---
async function handleCopyFormulas(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const db = adminDbClient()
  const url = new URL(req.url, 'http://localhost')
  const id = url.searchParams.get('id')
  const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom'
  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await db.from('copy_formulas').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      const { data } = await db.from('copy_formulas')
        .select('id, key, name, description, is_builtin, is_active, sort_order, updated_at')
        .order('sort_order').order('name')
      return res.json({ formulas: data || [] })
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await db.from('copy_formulas').select('is_builtin, key').eq('id', id).maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Not found' })
      if (existing.is_builtin) return res.status(400).json({ error: `Cannot delete built-in formula "${existing.key}"` })
      const { error } = await db.from('copy_formulas').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }
    if (req.method === 'POST') {
      const body = req.body || {}
      if (!body.name) return res.status(400).json({ error: 'name required' })
      if (!body.system_prompt) return res.status(400).json({ error: 'system_prompt required' })
      const key = body.key || slugify(body.name)
      const payload = {
        key, name: body.name, description: body.description || '',
        system_prompt: body.system_prompt,
        is_active: body.is_active !== false,
        sort_order: body.sort_order || 100,
        updated_at: new Date().toISOString(),
      }
      if (body.id) {
        const { data: existing } = await db.from('copy_formulas').select('is_builtin, key').eq('id', body.id).maybeSingle()
        if (!existing) return res.status(404).json({ error: 'Not found' })
        if (existing.is_builtin && payload.key !== existing.key) return res.status(400).json({ error: `Cannot change key of builtin "${existing.key}"` })
        const { data, error } = await db.from('copy_formulas').update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        const { data: dupe } = await db.from('copy_formulas').select('id').eq('key', key).maybeSingle()
        if (dupe) return res.status(409).json({ error: `Key "${key}" đã tồn tại` })
        payload.is_builtin = false
        payload.created_by = user.id
        const { data, error } = await db.from('copy_formulas').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

// --- Funnel Types CRUD ---
async function handleFunnelTypes(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const db = adminDbClient()
  const url = new URL(req.url, 'http://localhost')
  const id = url.searchParams.get('id')

  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await db.from('funnel_types').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      const { data } = await db.from('funnel_types')
        .select('id, key, name, description, icon, color, suggested_steps, is_builtin, is_active, sort_order, updated_at')
        .order('sort_order').order('name')
      return res.json({ types: data || [] })
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await db.from('funnel_types').select('is_builtin, key').eq('id', id).maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Not found' })
      if (existing.is_builtin) return res.status(400).json({ error: `Cannot delete built-in type "${existing.key}"` })
      const { error } = await db.from('funnel_types').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }
    if (req.method === 'POST') {
      const body = req.body || {}
      if (!body.name) return res.status(400).json({ error: 'name required' })
      const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom'
      const key = body.key || slugify(body.name)
      const payload = {
        key, name: body.name, description: body.description || '',
        icon: body.icon || 'zap', color: body.color || '#B6FF00',
        system_prompt: body.system_prompt || '',
        suggested_steps: body.suggested_steps || [],
        is_active: body.is_active !== false,
        sort_order: body.sort_order || 100,
        updated_at: new Date().toISOString(),
      }
      if (body.id) {
        const { data: existing } = await db.from('funnel_types').select('is_builtin, key').eq('id', body.id).maybeSingle()
        if (!existing) return res.status(404).json({ error: 'Not found' })
        if (existing.is_builtin && payload.key !== existing.key) return res.status(400).json({ error: `Cannot change key of built-in type "${existing.key}"` })
        const { data, error } = await db.from('funnel_types').update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        const { data: dupe } = await db.from('funnel_types').select('id').eq('key', key).maybeSingle()
        if (dupe) return res.status(409).json({ error: `Key "${key}" đã tồn tại` })
        payload.is_builtin = false
        payload.created_by = user.id
        const { data, error } = await db.from('funnel_types').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

// --- Funnel Builder Handlers ---
const FUNNEL_TYPES = ['sales', 'leads', 'webinar']

const COMMON_RULES_F = `
QUY TẮC BẮT BUỘC:
- Output PHẢI là HTML hoàn chỉnh, bắt đầu <!DOCTYPE html>, có <head> + <body>
- KHÔNG dùng framework. Tailwind CSS qua CDN: <script src="https://cdn.tailwindcss.com"></script> trong <head>
- Font Inter qua Google Fonts, responsive mobile-first
- Copy TIẾNG VIỆT, KHÔNG dùng "anh/chị", chỉ dùng "bạn"
- CTA button phải có class \`data-cta="1"\` để tracking
- Form phải có \`data-form="1"\` và action="#"
- Self-contained, không dùng markdown wrapper, chỉ HTML thuần
`

const FUNNEL_SYSTEM_PROMPTS = {
  sales: `Bạn là copywriter direct-response cho sales page tiếng Việt VN. Áp dụng PAS+StoryBrand. Section: Hero→Pain→Solution→Benefits→Testimonials→Pricing→Bonuses→Guarantee→Urgency→FAQ→Final CTA. Giá charm (297k, 997k, 1.997k).${COMMON_RULES_F}`,
  leads: `Bạn là copywriter lead magnet landing tiếng Việt. Áp dụng AIDA. Section: Hero+form→What's inside→Who for→Social proof→Author→Final CTA. Form 2 field: name+email, không phone.${COMMON_RULES_F}`,
  webinar: `Bạn là copywriter webinar landing tiếng Việt. Section: Hero(title+date+promise)→What discover→Who for→Speaker→Agenda→Registration form(name+email+phone)→Urgency+countdown→FAQ→Final CTA.${COMMON_RULES_F}`,
}

function buildFunnelUserPrompt(type, input) {
  const lines = [
    `Loại funnel: ${type}`,
    `Sản phẩm/Tên: ${input.productName || '(chưa có)'}`,
    `Target: ${input.audience || '(chưa có)'}`,
    `Pain: ${input.painPoints || '(chưa có)'}`,
    `Big promise: ${input.bigPromise || '(chưa có)'}`,
    `USP: ${input.usp || '(chưa có)'}`,
    `CTA: ${input.cta || 'Đăng ký ngay'}`,
  ]
  if (input.brandColor) lines.push(`Màu chủ đạo: ${input.brandColor}`)
  if (type === 'sales') {
    lines.push(`Offer: ${input.offer || ''}`, `Giá: ${input.pricing || ''}`)
    if (input.bonuses) lines.push(`Bonuses: ${input.bonuses}`)
    if (input.guarantee) lines.push(`Guarantee: ${input.guarantee}`)
    if (input.testimonials) lines.push(`Testimonials: ${input.testimonials}`)
    if (input.urgency) lines.push(`Urgency: ${input.urgency}`)
  } else if (type === 'leads') {
    lines.push(`Lead magnet: ${input.leadMagnetName || ''}`, `Benefit: ${input.leadMagnetBenefit || ''}`)
  } else if (type === 'webinar') {
    lines.push(`Tên: ${input.webinarTitle || ''}`, `Ngày: ${input.webinarDate || ''}`)
    if (input.webinarSpeaker) lines.push(`Speaker: ${input.webinarSpeaker}`)
    if (input.webinarAgenda) lines.push(`Agenda: ${input.webinarAgenda}`)
  }
  lines.push('', 'Sinh HTML hoàn chỉnh. Không giải thích, không markdown, chỉ HTML.')
  return lines.join('\n')
}

function injectFunnelTracking(html, funnelId, portalBase) {
  const script = `
<script>
(function(){
  var FUNNEL_ID='${funnelId}';
  var TRACK_URL='${portalBase}/api/f/track';
  function send(type, extra){
    try {
      fetch(TRACK_URL, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({funnel_id:FUNNEL_ID,event_type:type,referrer:document.referrer,extra:extra||{}}),keepalive:true}).catch(function(){})
    } catch(e){}
  }
  send('visit');
  document.addEventListener('click',function(e){var el=e.target.closest('[data-cta]');if(el)send('cta_click',{text:(el.innerText||'').slice(0,80)});});
  document.addEventListener('submit',function(e){var f=e.target.closest('[data-form],form');if(f)send('form_submit',{form_id:f.id||''});},true);
})();
</script>`.trim()
  return html.includes('</body>') ? html.replace('</body>', `${script}\n</body>`) : html + '\n' + script
}

async function callCodexGenerate(systemPrompt, userPrompt) {
  const cred = await loadCredForRuntime('openai-codex')
  const acctId = extractAccountIdFromJwt(cred.accessToken)
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cred.accessToken}`,
    'OpenAI-Beta': 'responses=v1',
    'User-Agent': 'codex_cli_rs/0.0.0 (customer-portal-giftbox)',
    'originator': 'codex_cli_rs',
  }
  if (acctId) headers['ChatGPT-Account-ID'] = acctId
  const resp = await fetch(`${cred.baseUrl}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions: systemPrompt,
      input: [{ role: 'user', content: [{ type: 'input_text', text: userPrompt }] }],
      max_output_tokens: 16000,
      store: false,
      stream: false,
    }),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Codex HTTP ${resp.status}: ${t.slice(0, 300)}`)
  }
  const data = await resp.json()
  let text = data.output_text || ''
  if (!text && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) if (c.type === 'output_text' && c.text) text += c.text
      }
    }
  }
  return { text, usage: data.usage }
}

function extractAccountIdFromJwt(token) {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const b64 = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4)
    const claims = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    return claims['https://api.openai.com/auth']?.chatgpt_account_id || null
  } catch { return null }
}

async function handleFunnelGenerate(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const { funnel_id, type, input, iteration_instruction } = req.body || {}
  if (!FUNNEL_TYPES.includes(type)) return res.status(400).json({ error: 'type must be sales/leads/webinar' })
  if (!input) return res.status(400).json({ error: 'input required' })
  const db = adminDbClient()
  let previousHtml
  if (funnel_id && iteration_instruction) {
    const { data: existing } = await db.from('generated_funnels').select('html').eq('id', funnel_id).maybeSingle()
    previousHtml = existing?.html
  }
  const systemPrompt = FUNNEL_SYSTEM_PROMPTS[type]
  let userPrompt
  if (previousHtml && iteration_instruction) {
    userPrompt = `Đây là HTML hiện tại:\n\n\`\`\`html\n${previousHtml}\n\`\`\`\n\nYêu cầu sửa: "${iteration_instruction}"\n\nSinh lại toàn bộ HTML với thay đổi này. Chỉ output HTML, không giải thích.`
  } else {
    userPrompt = buildFunnelUserPrompt(type, input)
  }
  try {
    const result = await callCodexGenerate(systemPrompt, userPrompt)
    let html = result.text.trim()
    const fence = html.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/)
    if (fence) html = fence[1].trim()
    if (!html.toLowerCase().startsWith('<!doctype')) html = `<!DOCTYPE html>\n${html}`
    return res.json({
      html,
      meta: {
        provider: 'openai-codex', model: 'gpt-5.6-sol',
        inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens,
        generatedAt: new Date().toISOString(),
      }
    })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'funnel'
}

async function handleFunnelSave(req, res) {
  const user = await assertAdmin(req, res); if (!user) return
  const db = adminDbClient()
  const url = new URL(req.url, 'http://localhost')
  const id = url.searchParams.get('id')
  const action = url.searchParams.get('action')
  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await db.from('generated_funnels').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      const { data } = await db.from('generated_funnels')
        .select('id, slug, name, type, status, visits, cta_clicks, form_submits, created_at, updated_at, published_at')
        .order('updated_at', { ascending: false })
      return res.json({ funnels: data || [] })
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await db.from('generated_funnels').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }
    if (req.method === 'POST') {
      if (action === 'publish' && id) {
        const { data, error } = await db.from('generated_funnels').update({
          status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
      if (action === 'archive' && id) {
        const { data, error } = await db.from('generated_funnels').update({
          status: 'archived', updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
      const body = req.body || {}
      if (!body.name || !body.type) return res.status(400).json({ error: 'name + type required' })
      const slug = body.slug || slugify(body.name)
      if (!body.id) {
        const { data: existing } = await db.from('generated_funnels').select('id').eq('slug', slug).maybeSingle()
        if (existing) return res.status(409).json({ error: `Slug "${slug}" đã tồn tại` })
      }
      const payload = {
        slug, name: body.name, type: body.type, status: body.status || 'draft',
        copy_input: body.copy_input || {}, html: body.html || null,
        generation_meta: body.generation_meta || {}, custom_domain: body.custom_domain || null,
        created_by: user.id, updated_at: new Date().toISOString(),
      }
      if (body.id) {
        const { data, error } = await db.from('generated_funnels').update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        const { data, error } = await db.from('generated_funnels').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

async function handleFunnelPublicRender(req, res, nodeRes) {
  const url = new URL(req.url, 'http://localhost')
  const slug = url.searchParams.get('slug')
  if (!slug) { nodeRes.writeHead(400); nodeRes.end('slug required'); return }
  const db = adminDbClient()
  const { data: funnel } = await db.from('generated_funnels')
    .select('id, html, status, name').eq('slug', slug).maybeSingle()
  if (!funnel || funnel.status !== 'published' || !funnel.html) {
    nodeRes.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    nodeRes.end(`<!DOCTYPE html><meta charset=utf-8><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#fff"><h1>404</h1><p>Funnel không tìm thấy hoặc chưa publish.</p></body>`)
    return
  }
  const portalBase = process.env.CUSTOMER_PORTAL_URL || `http://${req.headers.host || 'localhost:5009'}`
  const html = injectFunnelTracking(funnel.html, funnel.id, portalBase)
  nodeRes.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  })
  nodeRes.end(html)
}

async function handleFunnelTrack(req, res) {
  const { funnel_id, event_type, extra, referrer } = req.body || {}
  if (!funnel_id || !['visit', 'cta_click', 'form_submit'].includes(event_type)) {
    return res.status(400).json({ error: 'invalid' })
  }
  const db = adminDbClient()
  const ua = req.headers['user-agent'] || ''
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown'
  const visitorId = crypto2.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)
  let utmSource, utmMedium, utmCampaign
  try {
    if (referrer) {
      const ru = new URL(referrer)
      utmSource = ru.searchParams.get('utm_source') || undefined
      utmMedium = ru.searchParams.get('utm_medium') || undefined
      utmCampaign = ru.searchParams.get('utm_campaign') || undefined
    }
  } catch {}
  await db.from('generated_funnel_events').insert({
    funnel_id, event_type, visitor_id: visitorId,
    user_agent: ua.slice(0, 500), referrer: (referrer || '').slice(0, 500),
    utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign,
    extra: extra || {},
  })
  const col = event_type === 'visit' ? 'visits' : event_type === 'cta_click' ? 'cta_clicks' : 'form_submits'
  const { data: current } = await db.from('generated_funnels').select(col).eq('id', funnel_id).maybeSingle()
  if (current) await db.from('generated_funnels').update({ [col]: (Number(current[col]) || 0) + 1 }).eq('id', funnel_id)
  return res.status(200).json({ ok: true })
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
    } else if (req.url === '/api/oauth/openai/start') {
      await handleOAuthOpenAIStart(mockReq, res)
    } else if (req.url === '/api/oauth/openai/poll') {
      await handleOAuthOpenAIPoll(mockReq, res)
    } else if (req.url === '/api/oauth/openai/status') {
      await handleOAuthOpenAIStatus(mockReq, res)
    } else if (req.url === '/api/oauth/openai/disconnect') {
      await handleOAuthOpenAIDisconnect(mockReq, res)
    } else if (req.url?.startsWith('/api/ai/models')) {
      await handleAIModels(mockReq, res)
    } else if (req.url === '/api/ai/generate') {
      await handleAIGenerate(mockReq, res)
    } else if (req.url?.startsWith('/api/funnel-types')) {
      await handleFunnelTypes(mockReq, res)
    } else if (req.url?.startsWith('/api/copy-formulas')) {
      await handleCopyFormulas(mockReq, res)
    } else if (req.url?.startsWith('/api/funnel-flows') || req.url?.startsWith('/api/funnel-steps')) {
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url === '/api/funnels/generate') {
      await handleFunnelGenerate(mockReq, res)
    } else if (req.url?.startsWith('/api/funnels/save')) {
      await handleFunnelSave(mockReq, res)
    } else if (req.url?.startsWith('/api/f/render')) {
      // Dynamic import — writes to res directly
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url === '/api/f/submit') {
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url === '/api/f/track') {
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url?.startsWith('/api/f/pay')) {
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url?.startsWith('/api/f/order-status')) {
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url === '/api/f/sepay-webhook') {
      await handleViaImport(mockReq, res, req.url)
    } else if (req.url?.startsWith('/api/f/preview')) {
      await handleViaImport(mockReq, res, req.url)
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
