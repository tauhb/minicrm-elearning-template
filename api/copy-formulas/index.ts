// api/copy-formulas/index.ts — CRUD for copy_formulas (admin only)
//   GET  /api/copy-formulas              → list all active
//   GET  /api/copy-formulas?id=xxx       → get one (with prompt)
//   POST /api/copy-formulas              → create or update
//   DELETE /api/copy-formulas?id=xxx     → delete (blocked for builtin)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom'
}

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
  if (caller?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id')

  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await admin.from('copy_formulas').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      const { data } = await admin.from('copy_formulas')
        .select('id, key, name, description, page_type_filter, is_builtin, is_active, sort_order, updated_at')
        .order('sort_order').order('name')
      return res.json({ formulas: data || [] })
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await admin.from('copy_formulas').select('is_builtin, key').eq('id', id).maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Not found' })
      if (existing.is_builtin) return res.status(400).json({ error: `Cannot delete built-in formula "${existing.key}"` })
      const { error } = await admin.from('copy_formulas').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }
    if (req.method === 'POST') {
      const body = req.body || {}
      if (!body.name) return res.status(400).json({ error: 'name required' })
      if (!body.system_prompt) return res.status(400).json({ error: 'system_prompt required' })
      const key = body.key || slugify(body.name)
      const payload: any = {
        key, name: body.name, description: body.description || '',
        system_prompt: body.system_prompt,
        page_type_filter: Array.isArray(body.page_type_filter) ? body.page_type_filter : null,
        is_active: body.is_active !== false,
        sort_order: body.sort_order || 100,
        updated_at: new Date().toISOString(),
      }
      if (body.id) {
        const { data: existing } = await admin.from('copy_formulas').select('is_builtin, key').eq('id', body.id).maybeSingle()
        if (!existing) return res.status(404).json({ error: 'Not found' })
        if (existing.is_builtin && payload.key !== existing.key) {
          return res.status(400).json({ error: `Cannot change key of builtin "${existing.key}"` })
        }
        const { data, error } = await admin.from('copy_formulas').update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        const { data: dupe } = await admin.from('copy_formulas').select('id').eq('key', key).maybeSingle()
        if (dupe) return res.status(409).json({ error: `Key "${key}" đã tồn tại` })
        payload.is_builtin = false
        payload.created_by = user.id
        const { data, error } = await admin.from('copy_formulas').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
