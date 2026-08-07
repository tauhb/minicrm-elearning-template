// api/tasks/index.ts — CRM Tasks CRUD (Wave 1 Track A)
//
// Backed by care_history table (migration 015 added kind/title/status/priority/due_at
// /completed_at/assigned_to/order_id columns). This handler always applies
// `kind='task'` filter — care_log rows are handled by CareHistoryTab.
//
// Query param `action` controls behavior:
//   GET                                       → list tasks (filters: status,
//                                               assignee, lead_id, customer_id,
//                                               due_before, overdue)
//   POST                                      → create task
//   POST ?action=complete&id=xxx              → status='done', completed_at=NOW
//   POST ?action=reopen&id=xxx                → status='open',  completed_at=null
//   POST ?action=cancel&id=xxx                → status='cancelled'
//   POST ?action=update&id=xxx                → partial update
//   DELETE ?id=xxx                            → delete task

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

const TASK_ROLES = ['owner', 'admin', 'sales', 'support']

const TASK_SELECT = `
  *,
  creator:customers!care_history_created_by_fkey(id, display_name, email),
  assignee:customers!care_history_assigned_to_fkey(id, display_name, email),
  lead:leads(id, name, email, phone),
  customer:customers!care_history_customer_id_fkey(id, display_name, email),
  order:payments!care_history_order_id_fkey(id, amount, status)
`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!caller || !TASK_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Không có quyền truy cập tasks' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id')
  const action = url.searchParams.get('action')

  try {
    // ───── GET (list / get one) ─────
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await admin
          .from('care_history')
          .select(TASK_SELECT)
          .eq('id', id)
          .eq('kind', 'task')
          .maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Task không tồn tại' })
        return res.json({ task: data })
      }

      const status    = url.searchParams.get('status')     // open|done|cancelled|all
      const assignee  = url.searchParams.get('assignee')   // 'me' | user_id | 'unassigned'
      const leadId    = url.searchParams.get('lead_id')
      const customerId = url.searchParams.get('customer_id')
      const dueBefore = url.searchParams.get('due_before')
      const overdue   = url.searchParams.get('overdue') === 'true'

      let q = admin
        .from('care_history')
        .select(TASK_SELECT)
        .eq('kind', 'task')
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500)

      if (status && status !== 'all') q = q.eq('status', status)
      else if (!status)               q = q.eq('status', 'open')

      if (assignee === 'me')             q = q.eq('assigned_to', user.id)
      else if (assignee === 'unassigned') q = q.is('assigned_to', null)
      else if (assignee)                 q = q.eq('assigned_to', assignee)

      if (leadId)     q = q.eq('lead_id', leadId)
      if (customerId) q = q.eq('customer_id', customerId)

      if (overdue) {
        q = q.lt('due_at', new Date().toISOString()).eq('status', 'open')
      } else if (dueBefore) {
        q = q.lte('due_at', dueBefore)
      }

      const { data, error } = await q
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ tasks: data || [] })
    }

    // ───── DELETE ─────
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await admin
        .from('care_history')
        .select('id, kind')
        .eq('id', id)
        .maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Task không tồn tại' })
      if (existing.kind !== 'task') return res.status(400).json({ error: 'Không thể xoá care_log qua endpoint này' })
      const { error } = await admin.from('care_history').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = req.body || {}

    // ───── POST actions: complete / reopen / cancel / update ─────
    if (action && id) {
      const { data: existing } = await admin
        .from('care_history')
        .select('id, kind')
        .eq('id', id)
        .maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Task không tồn tại' })
      if (existing.kind !== 'task') return res.status(400).json({ error: 'Row này không phải task' })

      if (action === 'complete') {
        const now = new Date().toISOString()
        const { data, error } = await admin
          .from('care_history')
          .update({ status: 'done', completed_at: now })
          .eq('id', id)
          .select(TASK_SELECT)
          .single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ task: data })
      }
      if (action === 'reopen') {
        const { data, error } = await admin
          .from('care_history')
          .update({ status: 'open', completed_at: null })
          .eq('id', id)
          .select(TASK_SELECT)
          .single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ task: data })
      }
      if (action === 'cancel') {
        const { data, error } = await admin
          .from('care_history')
          .update({ status: 'cancelled' })
          .eq('id', id)
          .select(TASK_SELECT)
          .single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ task: data })
      }
      if (action === 'update') {
        const patch: Record<string, any> = {}
        if (body.title !== undefined)        patch.title        = body.title || null
        if (body.description !== undefined)  patch.content      = body.description || null
        else if (body.content !== undefined) patch.content      = body.content || null
        if (body.due_at !== undefined)       patch.due_at       = body.due_at || null
        if (body.priority !== undefined)     patch.priority     = body.priority || 'medium'
        if (body.assigned_to !== undefined)  patch.assigned_to  = body.assigned_to || null
        if (body.type !== undefined)         patch.type         = body.type || 'follow_up'
        if (body.lead_id !== undefined)      patch.lead_id      = body.lead_id || null
        if (body.customer_id !== undefined)  patch.customer_id  = body.customer_id || null
        if (body.order_id !== undefined)     patch.order_id     = body.order_id || null
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Không có field nào để update' })
        const { data, error } = await admin
          .from('care_history')
          .update(patch)
          .eq('id', id)
          .select(TASK_SELECT)
          .single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ task: data })
      }

      return res.status(400).json({ error: `Unknown action: ${action}` })
    }

    // ───── POST (create) ─────
    const title = String(body.title || '').trim()
    if (!title) return res.status(400).json({ error: 'title required' })

    const payload: Record<string, any> = {
      kind: 'task',
      status: 'open',
      type: body.type || 'follow_up',
      title,
      content: body.description || body.content || null,
      priority: body.priority || 'medium',
      due_at: body.due_at || null,
      assigned_to: body.assigned_to || null,
      lead_id: body.lead_id || null,
      customer_id: body.customer_id || null,
      order_id: body.order_id || null,
      created_by: user.id,
    }

    const { data, error } = await admin
      .from('care_history')
      .insert(payload)
      .select(TASK_SELECT)
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ task: data })
  } catch (e: any) {
    console.error('[api/tasks]', e)
    return res.status(500).json({ error: e.message })
  }
}
