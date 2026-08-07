// api/chat/canned-responses/index.ts — CRUD chat canned responses
//   GET    /api/chat/canned-responses            → list
//   POST   /api/chat/canned-responses            → create OR update if body.id given
//   PATCH  /api/chat/canned-responses            → update (requires body.id)
//   DELETE /api/chat/canned-responses?id=xxx     → delete
//
// Roles allowed: admin, sales, support (matches migration 018 RLS)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

const ALLOWED_ROLES = ['admin', 'sales', 'support']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!ALLOWED_ROLES.includes(caller?.role as string)) {
    return res.status(403).json({ error: 'Admin/sales/support only' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id')

  try {
    if (req.method === 'GET') {
      const { data, error } = await admin
        .from('chat_canned_responses')
        .select('id, title, body, shortcut, created_by, created_at, updated_at')
        .order('title', { ascending: true })
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ canned_responses: data || [] })
    }

    if (req.method === 'DELETE') {
      const targetId = id || req.body?.id
      if (!targetId) return res.status(400).json({ error: 'id required' })
      const { error } = await admin.from('chat_canned_responses').delete().eq('id', targetId)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = req.body || {}
      const title = (body.title || '').trim()
      const messageBody = (body.body || '').trim()
      const shortcutRaw = (body.shortcut || '').trim()
      const shortcut = shortcutRaw
        ? shortcutRaw.replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
        : null

      const isUpdate = !!body.id || req.method === 'PATCH'

      if (isUpdate) {
        if (!body.id) return res.status(400).json({ error: 'id required for update' })
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (body.title !== undefined) patch.title = title
        if (body.body !== undefined) patch.body = messageBody
        if (body.shortcut !== undefined) patch.shortcut = shortcut
        const { data, error } = await admin
          .from('chat_canned_responses')
          .update(patch)
          .eq('id', body.id)
          .select()
          .single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }

      if (!title || !messageBody) {
        return res.status(400).json({ error: 'title và body là bắt buộc' })
      }
      const { data, error } = await admin
        .from('chat_canned_responses')
        .insert({
          title,
          body: messageBody,
          shortcut,
          created_by: user.id,
        })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Shortcut đã tồn tại, chọn tên khác.' })
        }
        return res.status(500).json({ error: error.message })
      }
      return res.json(data)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
