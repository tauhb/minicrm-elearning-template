// api/chat/inboxes/index.ts — CRUD chat_inboxes (admin)
//   GET  /api/chat/inboxes            → list
//   GET  /api/chat/inboxes?id=xxx     → get one
//   POST /api/chat/inboxes            → create/update
//   DELETE /api/chat/inboxes?id=xxx   → delete

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
  if (!['admin', 'sales'].includes(caller?.role as string)) return res.status(403).json({ error: 'Admin/sales only' })

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
        const { data, error } = await admin.from('chat_inboxes').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      const { data } = await admin.from('chat_inboxes')
        .select('id, name, channel_type, channel_config, external_id, website_token, is_active, greeting_enabled, greeting_message, auto_assign_to, created_at, updated_at')
        .order('created_at', { ascending: false })
      return res.json({ inboxes: data || [] })
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await admin.from('chat_inboxes').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      if (!body.name) return res.status(400).json({ error: 'name required' })
      // Sanitize channel_config: never persist the placeholder "***stored***"
      // sentinel returned by the client after a webhook-configure round-trip.
      // If the client is editing an existing inbox with a stored token, keep
      // the existing encrypted value.
      let incomingConfig = body.channel_config || {}
      if (body.id && incomingConfig?.bot_token_encrypted === '***stored***') {
        const { data: existing } = await admin.from('chat_inboxes')
          .select('channel_config').eq('id', body.id).maybeSingle()
        const existingCfg = (existing?.channel_config as any) || {}
        incomingConfig = { ...incomingConfig, bot_token_encrypted: existingCfg.bot_token_encrypted }
      }

      const payload: any = {
        name: body.name,
        channel_type: body.channel_type || 'website',
        channel_config: incomingConfig,
        external_id: body.external_id ?? null,
        greeting_enabled: body.greeting_enabled !== false,
        greeting_message: body.greeting_message || 'Xin chào! Chúng tôi có thể giúp gì?',
        working_hours_enabled: !!body.working_hours_enabled,
        out_of_office_message: body.out_of_office_message || null,
        timezone: body.timezone || 'Asia/Ho_Chi_Minh',
        auto_assign_to: body.auto_assign_to || null,
        is_active: body.is_active !== false,
        updated_at: new Date().toISOString(),
      }
      if (body.id) {
        const { data, error } = await admin.from('chat_inboxes').update(payload).eq('id', body.id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      } else {
        payload.created_by = user.id
        const { data, error } = await admin.from('chat_inboxes').insert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
