// api/funnels/save.ts — CRUD for generated funnels (admin only)
//
// GET /api/funnels/save              → list all funnels
// GET /api/funnels/save?id=xxx       → get one
// POST /api/funnels/save             → create or upsert (body has all fields)
// POST /api/funnels/save?action=publish&id=xxx → publish (status=published, set published_at)
// POST /api/funnels/save?action=archive&id=xxx → archive
// DELETE /api/funnels/save?id=xxx    → delete

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'funnel'
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
  const action = url.searchParams.get('action')

  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await admin.from('generated_funnels').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      const { data } = await admin.from('generated_funnels')
        .select('id, slug, name, type, status, visits, cta_clicks, form_submits, created_at, updated_at, published_at')
        .order('updated_at', { ascending: false })
      return res.json({ funnels: data || [] })
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await admin.from('generated_funnels').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method === 'POST') {
      // Publish / archive actions
      if (action === 'publish' && id) {
        const { data, error } = await admin.from('generated_funnels').update({
          status: 'published',
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
      if (action === 'archive' && id) {
        const { data, error } = await admin.from('generated_funnels').update({
          status: 'archived', updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }

      // Regular create/upsert
      const body = req.body || {}
      if (!body.name || !body.type) return res.status(400).json({ error: 'name + type required' })

      const slug = body.slug || slugify(body.name)

      // Check slug uniqueness (if new or slug changed)
      if (!body.id) {
        const { data: existing } = await admin.from('generated_funnels').select('id').eq('slug', slug).maybeSingle()
        if (existing) return res.status(409).json({ error: `Slug "${slug}" đã tồn tại` })
      }

      const payload = {
        slug,
        name: body.name,
        type: body.type,
        status: body.status || 'draft',
        copy_input: body.copy_input || {},
        html: body.html || null,
        generation_meta: body.generation_meta || {},
        custom_domain: body.custom_domain || null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }

      if (body.id) {
        // Update
        const { data, error } = await admin.from('generated_funnels')
          .update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        // Insert
        const { data, error } = await admin.from('generated_funnels')
          .insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
