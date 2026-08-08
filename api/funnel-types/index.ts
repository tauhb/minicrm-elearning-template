// api/funnel-types/index.ts — CRUD for funnel_types (admin only)
//
// GET  /api/funnel-types              → list all active types
// GET  /api/funnel-types?id=xxx       → get one full (with system_prompt)
// POST /api/funnel-types              → create or upsert (body has all fields)
// DELETE /api/funnel-types?id=xxx     → delete (blocked for is_builtin=true)

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
  if (!['owner','admin'].includes(caller?.role || '')) return res.status(403).json({ error: 'Admin only' })

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
        const { data, error } = await admin.from('funnel_types').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      // List (exclude system_prompt for perf)
      const { data } = await admin.from('funnel_types')
        .select('id, key, name, description, icon, color, suggested_steps, is_builtin, is_active, sort_order, updated_at')
        .order('sort_order').order('name')
      return res.json({ types: data || [] })
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await admin.from('funnel_types').select('is_builtin, key').eq('id', id).maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Not found' })
      if (existing.is_builtin) return res.status(400).json({ error: `Cannot delete built-in type "${existing.key}"` })
      const { error } = await admin.from('funnel_types').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      if (!body.name) return res.status(400).json({ error: 'name required' })
      const key = body.key || slugify(body.name)

      const payload: any = {
        key, name: body.name, description: body.description || '',
        icon: body.icon || 'zap', color: body.color || '#B6FF00',
        system_prompt: body.system_prompt || '',
        suggested_steps: body.suggested_steps || [],
        is_active: body.is_active !== false,
        sort_order: body.sort_order || 100,
        updated_at: new Date().toISOString(),
      }

      if (body.id) {
        // Update existing
        const { data: existing } = await admin.from('funnel_types').select('is_builtin, key').eq('id', body.id).maybeSingle()
        if (!existing) return res.status(404).json({ error: 'Not found' })
        // Prevent changing key on built-in
        if (existing.is_builtin && payload.key !== existing.key) {
          return res.status(400).json({ error: `Cannot change key of built-in type "${existing.key}"` })
        }
        const { data, error } = await admin.from('funnel_types')
          .update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        // Create — key must be unique
        const { data: dupe } = await admin.from('funnel_types').select('id').eq('key', key).maybeSingle()
        if (dupe) return res.status(409).json({ error: `Key "${key}" đã tồn tại` })
        payload.is_builtin = false  // Never allow user to create built-in
        payload.created_by = user.id
        const { data, error } = await admin.from('funnel_types').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
