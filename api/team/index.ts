// api/team/index.ts — Vercel Serverless Function
// Wave 2 · Track E — Team / User Management
// GET  /api/team                           → list team members (owner/admin/sales/support)
// POST /api/team?action=invite             → create auth user + customers row + send magic link
// POST /api/team?action=change-role&id=xx  → change role (admin/sales/support; owner→owner-only)
// POST /api/team?action=deactivate&id=xx   → soft-deactivate (last owner protected)
// POST /api/team?action=activate&id=xx     → reactivate
// POST /api/team?action=resend-magic-link&id=xx → resend login link
// Guarded to owner|admin. Uses service_role for writes.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendWelcome } from '../../services/email'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const TEAM_ROLES = ['owner', 'admin', 'sales', 'support'] as const
const ASSIGNABLE_ROLES = ['admin', 'sales', 'support'] as const   // non-owner assignments
const ALL_ROLES        = ['owner', 'admin', 'sales', 'support'] as const

const ROLE_PRIORITY: Record<string, number> = {
  owner: 0, admin: 1, sales: 2, support: 3, student: 4, affiliate: 5,
}

type TeamRole = typeof TEAM_ROLES[number]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  // Parse from URL (works both on Vercel + dev api-server, which doesn't populate req.query)
  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action') || ''
  const id = url.searchParams.get('id') || ''

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

  const { data: caller } = await userClient
    .from('customers')
    .select('id, role, email')
    .eq('id', user.id)
    .maybeSingle()
  if (!caller || !['owner', 'admin'].includes(caller.role)) {
    return res.status(403).json({ error: 'Chỉ owner/admin được quản lý đội ngũ' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const callerCtx = {
    id: caller.id as string,
    role: caller.role as TeamRole,
    email: (caller as any).email as string,
  }

  try {
    if (req.method === 'GET') {
      return await handleList(res, admin)
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    if (action === 'invite')            return await handleInvite(req, res, admin, callerCtx)
    if (action === 'change-role')       return await handleChangeRole(req, res, admin, callerCtx, id)
    if (action === 'deactivate')        return await handleSetStatus(res, admin, callerCtx, id, 'deactivated')
    if (action === 'activate')          return await handleSetStatus(res, admin, callerCtx, id, 'active')
    if (action === 'resend-magic-link') return await handleResendMagicLink(req, res, admin, callerCtx, id)

    return res.status(400).json({ error: `Unknown action: ${action || '(missing)'}` })
  } catch (err: any) {
    console.error('[api/team]', action, err)
    return res.status(500).json({ error: err?.message || 'Lỗi không xác định' })
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleList(res: VercelResponse, admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from('customers')
    .select('id, email, display_name, role, status, phone, created_at, updated_at')
    .in('role', TEAM_ROLES as unknown as string[])
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  const sorted = (data || []).slice().sort((a: any, b: any) => {
    const rp = (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99)
    if (rp !== 0) return rp
    const an = (a.display_name || a.email || '').toLowerCase()
    const bn = (b.display_name || b.email || '').toLowerCase()
    return an.localeCompare(bn)
  })

  // Also pull last 20 team-related audit entries
  const { data: auditRows } = await admin
    .from('admin_audit_log')
    .select('id, actor_id, actor_email, action, target_type, target_id, changes, created_at')
    .like('action', 'team.%')
    .order('created_at', { ascending: false })
    .limit(20)

  return res.json({ members: sorted, audit: auditRows || [] })
}

async function handleInvite(
  req: VercelRequest,
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  caller: { id: string; role: TeamRole; email: string },
) {
  const body = (req.body || {}) as {
    email?: string
    display_name?: string
    role?: string
  }
  const email = (body.email || '').trim().toLowerCase()
  const display_name = (body.display_name || '').trim() || email.split('@')[0]
  const role = (body.role || '').trim() as TeamRole

  if (!email) return res.status(400).json({ error: 'Email bắt buộc' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' })
  if (!ASSIGNABLE_ROLES.includes(role as any)) {
    return res.status(400).json({ error: `Role không hợp lệ. Chọn: ${ASSIGNABLE_ROLES.join(', ')}` })
  }

  // Kiểm tra user đã tồn tại chưa
  const listRes = await admin.auth.admin.listUsers()
  const existingUsers = (listRes.data?.users || []) as Array<{ id: string; email?: string }>
  const existing = existingUsers.find(u => (u.email || '').toLowerCase() === email)

  let userId: string
  let created = false

  if (existing) {
    userId = existing.id
    // Nếu customer chưa có row hoặc role không phải team → upsert lên role mới
    const { data: existingCust } = await admin.from('customers').select('id, role, status').eq('id', userId).maybeSingle()
    if (existingCust) {
      const isDowngrade = ROLE_PRIORITY[existingCust.role] < ROLE_PRIORITY[role]
      // Không hạ cấp owner qua invite
      if (existingCust.role === 'owner') {
        return res.status(400).json({ error: 'User này đã là owner — không thể mời lại với vai trò khác' })
      }
      await admin.from('customers').update({
        role,
        status: 'active',
        updated_at: new Date().toISOString(),
        display_name: display_name || existingCust.role,
      }).eq('id', userId)
      // Note isDowngrade to keep API honest even if we don't act on it
      void isDowngrade
    } else {
      await admin.from('customers').insert({
        id: userId,
        email,
        display_name,
        role,
        payment_status: 'pending',
        status: 'active',
      })
      created = true
    }
  } else {
    // Random password (user sẽ dùng magic link để login)
    const finalPassword = Math.random().toString(36).slice(-12) + 'Aa1!'
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true,
    })
    if (createErr || !newUser?.user) {
      return res.status(500).json({ error: createErr?.message || 'Không tạo được tài khoản' })
    }
    userId = newUser.user.id
    created = true

    await admin.from('customers').insert({
      id: userId,
      email,
      display_name,
      role,
      payment_status: 'pending',
      status: 'active',
    })
  }

  // Gửi magic link welcome
  const origin = (req.headers.origin as string) || process.env.PORTAL_URL || 'http://localhost:5009'
  const portalUrl = origin.startsWith('http') ? origin : `https://${origin}`

  let emailSent = false
  let emailError: string | null = null
  try {
    const result = await sendWelcome({
      email,
      name: display_name,
      portalUrl,
      mode: 'magic-link',
      loginUrl: portalUrl,
    })
    emailSent = !!(result as any)?.ok
    emailError = (result as any)?.error || null
  } catch (e: any) {
    emailError = e?.message || String(e)
  }

  await logAudit(admin, caller, 'team.invite', userId, {
    email,
    display_name,
    role,
    created,
    email_sent: emailSent,
    email_error: emailError,
  })

  return res.json({ success: true, userId, email, created, email_sent: emailSent, email_error: emailError })
}

async function handleChangeRole(
  req: VercelRequest,
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  caller: { id: string; role: TeamRole; email: string },
  id: string,
) {
  if (!id) return res.status(400).json({ error: 'Thiếu id thành viên' })
  const body = (req.body || {}) as { role?: string }
  const newRole = (body.role || '').trim() as TeamRole
  if (!ALL_ROLES.includes(newRole as any)) {
    return res.status(400).json({ error: `Role không hợp lệ. Chọn: ${ALL_ROLES.join(', ')}` })
  }

  const { data: target, error: tErr } = await admin
    .from('customers')
    .select('id, role, email, display_name, status')
    .eq('id', id)
    .maybeSingle()
  if (tErr || !target) return res.status(404).json({ error: 'Không tìm thấy thành viên' })

  // Chỉ owner mới được set/gỡ role owner
  if ((newRole === 'owner' || target.role === 'owner') && caller.role !== 'owner') {
    return res.status(403).json({ error: 'Chỉ owner mới được thay đổi vai trò owner' })
  }

  // Không được self-demote owner cuối cùng
  if (target.role === 'owner' && newRole !== 'owner') {
    const ownerCount = await countActiveOwners(admin)
    if (ownerCount <= 1) {
      return res.status(400).json({ error: 'Không thể gỡ vai trò owner cuối cùng của hệ thống' })
    }
  }

  if (target.role === newRole) {
    return res.json({ success: true, role: newRole, unchanged: true })
  }

  const { error } = await admin
    .from('customers')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  await logAudit(admin, caller, 'team.change_role', id, {
    email: target.email,
    display_name: target.display_name,
    from_role: target.role,
    to_role: newRole,
  })

  return res.json({ success: true, role: newRole })
}

async function handleSetStatus(
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  caller: { id: string; role: TeamRole; email: string },
  id: string,
  newStatus: 'active' | 'deactivated',
) {
  if (!id) return res.status(400).json({ error: 'Thiếu id thành viên' })

  const { data: target, error: tErr } = await admin
    .from('customers')
    .select('id, role, email, display_name, status')
    .eq('id', id)
    .maybeSingle()
  if (tErr || !target) return res.status(404).json({ error: 'Không tìm thấy thành viên' })

  // Owner protection: chỉ owner được deactivate/activate owner khác
  if (target.role === 'owner' && caller.role !== 'owner') {
    return res.status(403).json({ error: 'Chỉ owner mới được thao tác với owner khác' })
  }

  // Không được deactivate owner cuối cùng
  if (newStatus === 'deactivated' && target.role === 'owner') {
    const ownerCount = await countActiveOwners(admin)
    if (ownerCount <= 1) {
      return res.status(400).json({ error: 'Không thể ngừng hoạt động owner cuối cùng của hệ thống' })
    }
  }

  // Không được self-deactivate
  if (newStatus === 'deactivated' && caller.id === id) {
    return res.status(400).json({ error: 'Không thể tự ngừng hoạt động chính mình' })
  }

  if ((target.status || 'active') === newStatus) {
    return res.json({ success: true, status: newStatus, unchanged: true })
  }

  const { error } = await admin
    .from('customers')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  const action = newStatus === 'deactivated' ? 'team.deactivate' : 'team.activate'
  await logAudit(admin, caller, action, id, {
    email: target.email,
    display_name: target.display_name,
    role: target.role,
    previous_status: target.status || 'active',
  })

  return res.json({ success: true, status: newStatus })
}

async function handleResendMagicLink(
  req: VercelRequest,
  res: VercelResponse,
  admin: ReturnType<typeof createClient>,
  caller: { id: string; role: TeamRole; email: string },
  id: string,
) {
  if (!id) return res.status(400).json({ error: 'Thiếu id thành viên' })

  const { data: target, error: tErr } = await admin
    .from('customers')
    .select('id, email, display_name, role, status')
    .eq('id', id)
    .maybeSingle()
  if (tErr || !target) return res.status(404).json({ error: 'Không tìm thấy thành viên' })
  if ((target.status || 'active') === 'deactivated') {
    return res.status(400).json({ error: 'Tài khoản đã ngừng hoạt động. Kích hoạt lại trước khi gửi link.' })
  }

  const origin = (req.headers.origin as string) || process.env.PORTAL_URL || 'http://localhost:5009'
  const portalUrl = origin.startsWith('http') ? origin : `https://${origin}`

  let emailSent = false
  let emailError: string | null = null
  try {
    const result = await sendWelcome({
      email: target.email,
      name: target.display_name || target.email.split('@')[0],
      portalUrl,
      mode: 'magic-link',
      loginUrl: portalUrl,
    })
    emailSent = !!(result as any)?.ok
    emailError = (result as any)?.error || null
  } catch (e: any) {
    emailError = e?.message || String(e)
  }

  await logAudit(admin, caller, 'team.resend_magic_link', id, {
    email: target.email,
    role: target.role,
    email_sent: emailSent,
    email_error: emailError,
  })

  return res.json({ success: true, email_sent: emailSent, email_error: emailError })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function countActiveOwners(admin: ReturnType<typeof createClient>): Promise<number> {
  const { count } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'owner')
    .or('status.is.null,status.eq.active')
  return count || 0
}

async function logAudit(
  admin: ReturnType<typeof createClient>,
  actor: { id: string; email: string },
  action: string,
  targetId: string,
  changes: Record<string, unknown>,
) {
  try {
    await admin.from('admin_audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      action,
      target_type: 'customer',
      target_id: targetId,
      changes,
    })
  } catch (e: any) {
    console.warn('[api/team] audit log failed:', e?.message)
  }
}
