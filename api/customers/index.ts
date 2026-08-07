// api/customers/index.ts — Vercel Serverless Function
// Actions: resend-magic-link | deactivate | activate | update
// Guarded to admin/sales/owner. Uses service_role for writes.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = ['admin', 'sales', 'owner']
const ALLOWED_ACTIONS = new Set(['resend-magic-link', 'deactivate', 'activate', 'update'])

type UpdatePayload = Partial<{
  phone: string | null
  notes: string | null
  tags: string[]
  display_name: string
}>

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const action = (req.query.action as string) || ''
  const id = (req.query.id as string) || ''
  if (!ALLOWED_ACTIONS.has(action)) return res.status(400).json({ error: `Unknown action: ${action}` })
  if (!id) return res.status(400).json({ error: 'Thiếu id khách hàng' })

  // Auth
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
  if (!caller || !ALLOWED_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Chỉ admin/sales được thực hiện' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Load target customer
  const { data: customer, error: custErr } = await admin
    .from('customers')
    .select('id, email, display_name, status')
    .eq('id', id)
    .maybeSingle()
  if (custErr || !customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' })

  try {
    if (action === 'resend-magic-link') return await handleResendMagicLink(req, res, admin, user.id, customer)
    if (action === 'deactivate')        return await handleSetStatus(res, admin, user.id, customer, 'deactivated')
    if (action === 'activate')          return await handleSetStatus(res, admin, user.id, customer, 'active')
    if (action === 'update')            return await handleUpdate(req, res, admin, user.id, customer.id)
  } catch (err: any) {
    console.error('[api/customers]', action, err)
    return res.status(500).json({ error: err?.message || 'Lỗi không xác định' })
  }
}

// --- Handlers ---

async function handleResendMagicLink(
  req: VercelRequest,
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  actorId: string,
  customer: { id: string; email: string; display_name: string; status: string }
) {
  if (customer.status === 'deactivated') {
    return res.status(400).json({ error: 'Tài khoản đã ngừng hoạt động. Kích hoạt lại trước khi gửi link.' })
  }

  const origin = (req.headers.origin as string) || (process.env.PORTAL_URL || '')
  const portalUrl = origin
    ? (origin.startsWith('http') ? origin : `https://${origin}`)
    : 'http://localhost:5009'

  // Try to generate link (also triggers Supabase to send if SMTP configured)
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: customer.email,
    options: { redirectTo: portalUrl },
  })
  if (linkErr) return res.status(500).json({ error: `Không tạo được magic link: ${linkErr.message}` })

  const actionLink = (linkData as any)?.properties?.action_link || (linkData as any)?.action_link || null

  // Best-effort branded email via Resend (if configured)
  let deliveredVia: 'resend' | 'supabase' | 'none' = 'supabase'
  const { data: settingsRows } = await admin.from('app_settings').select('key, value').in('key', ['title', 'resend_api_key'])
  const settingsMap: Record<string, any> = {}
  ;(settingsRows || []).forEach((r: any) => { settingsMap[r.key] = r.value })
  const appName = settingsMap['title']?.value || 'Portal'
  const resendKey = process.env.RESEND_API_KEY || settingsMap['resend_api_key']?.value || ''

  if (resendKey && actionLink) {
    try {
      const resend = new Resend(resendKey)
      await resend.emails.send({
        from: `${appName} <onboarding@resend.dev>`,
        to: customer.email,
        subject: `Link đăng nhập ${appName}`,
        html: buildMagicLinkEmail({ appName, name: customer.display_name, link: actionLink, portalUrl }),
      })
      deliveredVia = 'resend'
    } catch (e: any) {
      console.warn('[api/customers] Resend send failed, falling back to Supabase SMTP:', e?.message)
      deliveredVia = 'supabase'
    }
  }

  await logAudit(admin, actorId, 'customer.resend_magic_link', customer.id, { delivered_via: deliveredVia })
  return res.json({ success: true, delivered_via: deliveredVia })
}

async function handleSetStatus(
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  actorId: string,
  customer: { id: string; status: string },
  newStatus: 'active' | 'deactivated'
) {
  if (customer.status === newStatus) {
    return res.json({ success: true, status: newStatus, unchanged: true })
  }
  const { error } = await admin
    .from('customers')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', customer.id)
  if (error) return res.status(500).json({ error: error.message })

  const action = newStatus === 'deactivated' ? 'customer.deactivate' : 'customer.activate'
  await logAudit(admin, actorId, action, customer.id, { previous_status: customer.status })
  return res.json({ success: true, status: newStatus })
}

async function handleUpdate(
  req: VercelRequest,
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  actorId: string,
  customerId: string
) {
  const body = (req.body || {}) as UpdatePayload
  const updates: Record<string, unknown> = {}
  if (typeof body.phone === 'string' || body.phone === null) updates.phone = body.phone
  if (typeof body.notes === 'string' || body.notes === null) updates.notes = body.notes
  if (Array.isArray(body.tags)) updates.tags = body.tags.filter(t => typeof t === 'string')
  if (typeof body.display_name === 'string' && body.display_name.trim()) updates.display_name = body.display_name.trim()

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Không có field hợp lệ để cập nhật' })
  updates.updated_at = new Date().toISOString()

  const { data, error } = await admin.from('customers').update(updates).eq('id', customerId).select().single()
  if (error) return res.status(500).json({ error: error.message })

  await logAudit(admin, actorId, 'customer.update', customerId, { fields: Object.keys(updates).filter(k => k !== 'updated_at') })
  return res.json({ success: true, customer: data })
}

// --- Helpers ---

async function logAudit(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await admin.from('admin_audit_log').insert({
      actor_id: actorId,
      action,
      target_type: 'customer',
      target_id: targetId,
      metadata,
    })
  } catch (e: any) {
    // Audit failure should not break the primary action
    console.warn('[api/customers] audit log failed:', e?.message)
  }
}

function buildMagicLinkEmail(p: { appName: string; name: string; link: string; portalUrl: string }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:12px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #1a1a1a">
          <p style="margin:0;font-size:22px;font-weight:700;color:#fff">${p.appName}</p>
        </td></tr>
        <tr><td style="padding:32px 40px">
          <p style="margin:0 0 16px;font-size:16px;color:#e5e5e5">Xin chào <strong>${p.name || 'bạn'}</strong>,</p>
          <p style="margin:0 0 24px;font-size:14px;color:#a0a0a0;line-height:1.6">
            Admin đã gửi cho bạn link đăng nhập một lần vào <strong style="color:#fff">${p.appName}</strong>. Link có hiệu lực trong 1 giờ.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${p.link}" style="display:inline-block;padding:14px 36px;background:#b6ff00;color:#000;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px">
              Đăng nhập ${p.appName} →
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center">
            Nếu bạn không yêu cầu link này, có thể bỏ qua email.
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #1a1a1a;text-align:center">
          <p style="margin:0;font-size:12px;color:#444">Được gửi từ ${p.appName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
