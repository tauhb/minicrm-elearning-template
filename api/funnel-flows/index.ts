// api/funnel-flows/index.ts — CRUD for funnel_flows (admin only)
//   GET  /api/funnel-flows              → list all
//   GET  /api/funnel-flows?id=xxx       → get one with steps aggregated
//   POST /api/funnel-flows              → create/upsert
//   POST /api/funnel-flows?action=publish&id=xxx   → publish all steps atomically
//   POST /api/funnel-flows?action=archive&id=xxx   → archive
//   DELETE /api/funnel-flows?id=xxx     → delete (cascade to steps)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { encrypt, tryDecrypt } from '../../services/crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'funnel'
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
        const { data, error } = await admin.from('funnel_flows').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        const { data: steps } = await admin.from('funnel_steps')
          .select('*').eq('funnel_id', id).order('step_number')
        return res.json({ ...data, steps: steps || [] })
      }
      const { data } = await admin.from('funnel_flows')
        .select('id, slug, name, type_key, status, style_preset, custom_domain, created_at, updated_at, published_at')
        .order('updated_at', { ascending: false })
      return res.json({ funnels: data || [] })
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await admin.from('funnel_flows').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method === 'POST') {
      if (action === 'publish' && id) {
        const { data, error } = await admin.from('funnel_flows').update({
          status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
      if (action === 'archive' && id) {
        const { data, error } = await admin.from('funnel_flows').update({
          status: 'archived', updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }

      const body = req.body || {}
      if (!body.name) return res.status(400).json({ error: 'name required' })
      if (!body.type_key) return res.status(400).json({ error: 'type_key required' })
      const slug = body.slug || slugify(body.name)

      const payload: any = {
        slug, name: body.name, type_key: body.type_key,
        status: body.status || 'draft',
        style_preset: body.style_preset || {},
        shared_context: body.shared_context || {},
        payment_mode: body.payment_mode || 'collect_only',
        tags_to_apply: body.tags_to_apply || [],
        custom_prompt: body.custom_prompt || null,
        custom_domain: body.custom_domain || null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }

      // Handle payment_config — encrypt webhook_secret if provided (as plaintext)
      if (body.payment_config !== undefined) {
        const pc = { ...body.payment_config }
        if (typeof pc.webhook_secret === 'string' && pc.webhook_secret.trim()) {
          try {
            pc.webhook_secret_encrypted = encrypt(pc.webhook_secret.trim())
          } catch (e: any) {
            return res.status(500).json({ error: `Encryption failed: ${e.message}. Set PROVIDER_ENCRYPTION_KEY.` })
          }
        }
        delete pc.webhook_secret   // Never store plaintext
        payload.payment_config = pc
      }

      if (body.id) {
        const { data, error } = await admin.from('funnel_flows')
          .update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        const { data: dupe } = await admin.from('funnel_flows').select('id').eq('slug', slug).maybeSingle()
        if (dupe) return res.status(409).json({ error: `Slug "${slug}" đã tồn tại` })
        const { data, error } = await admin.from('funnel_flows').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })

        // Auto-suggest steps from type's suggested_steps (transparent to user)
        if (body.auto_suggest !== false && data) {
          try {
            const { data: type } = await admin.from('funnel_types')
              .select('suggested_steps').eq('key', data.type_key).maybeSingle()
            const suggested = ((type?.suggested_steps || []) as any[])
            if (suggested.length) {
              const rows = suggested.map((s: any) => ({
                funnel_id: data.id,
                step_number: s.step_number, slug: s.slug, name: s.name,
                page_type: s.page_type,
                has_form: !!s.has_form,
                form_mode: s.form_mode || (s.has_form ? 'inline' : 'none'),
                form_fields: s.form_fields || [],
                form_success_step_slug: s.form_success_step_slug || null,
                content_source: 'ai_draft', copy_input: {}, html: null,
              }))
              await admin.from('funnel_steps').insert(rows)
            }
          } catch (e: any) {
            console.warn('[flow create] auto-suggest steps failed:', e.message)
            // Non-blocking — flow still created
          }
        }
        return res.json(data)
      }
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
