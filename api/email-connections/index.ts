// api/email-connections/index.ts — Multi-provider email connection CRUD + test.
//
//   GET    /api/email-connections
//        → { connections: [...], providers: [...registry] }
//
//   POST   /api/email-connections
//        body { provider, name, from_email, from_name?, api_key, extra? }
//        → creates a new row (api_key encrypted)
//
//   PATCH  /api/email-connections?id=…
//        body { name?, from_email?, from_name?, api_key?, extra?, daily_limit? }
//        → api_key only re-encrypts when provided
//
//   POST   /api/email-connections?action=test&id=…
//        → run provider .verify() (or ping /account); update last_tested_at
//
//   POST   /api/email-connections?action=set-default&id=…&role=transactional|marketing
//        → atomic swap of the single default per role
//
//   POST   /api/email-connections?action=disable&id=…
//   POST   /api/email-connections?action=enable&id=…
//        → toggle status; enable refuses providers with disabled:true in registry
//
//   DELETE /api/email-connections?id=…
//        → hard delete; refuses if row is a default (400)
//
// Owner/admin only.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { encrypt, tryDecryptOrRaw } from '../../services/crypto'
import { EMAIL_PROVIDERS, getEmailProviderConfig, listEmailProviderIds } from '../../services/email-providers'
import * as resendAdapter from '../../services/email-adapters/resend'
import * as brevoAdapter  from '../../services/email-adapters/brevo'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

function pickAdapter(providerId: string) {
  if (providerId === 'resend') return resendAdapter
  if (providerId === 'brevo')  return brevoAdapter
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  // ── Auth (owner/admin) ─────────────────────────────────────────────────────
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${authHeader.slice(7)}` } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!['owner', 'admin'].includes(caller?.role || '')) {
    return res.status(403).json({ error: 'Owner/admin only' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action') || ''
  const id = url.searchParams.get('id') || ''

  try {
    // ── GET: list all connections + registry meta ─────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await admin.from('email_connections')
        .select('id, provider, name, from_email, from_name, extra, status, is_default_transactional, is_default_marketing, daily_limit, monthly_sent, monthly_reset_at, last_used_at, last_tested_at, last_test_error, created_at, updated_at')
        .order('created_at', { ascending: true })
      if (error) return res.status(500).json({ error: error.message })

      const providers = listEmailProviderIds().map(pid => ({ ...EMAIL_PROVIDERS[pid] }))
      // Enrich each connection with its provider config for the UI
      const connections = (data || []).map(row => {
        const cfg = EMAIL_PROVIDERS[row.provider]
        return { ...row, provider_label: cfg?.label || row.provider, provider_config: cfg }
      })
      return res.status(200).json({ connections, providers })
    }

    // ── POST create (no action) ───────────────────────────────────────────
    if (req.method === 'POST' && !action) {
      const { provider, name, from_email, from_name, api_key, extra, daily_limit } = req.body || {}
      if (!provider)   return res.status(400).json({ error: 'provider required' })
      if (!name)       return res.status(400).json({ error: 'name required' })
      if (!from_email) return res.status(400).json({ error: 'from_email required' })

      const cfg = EMAIL_PROVIDERS[provider]
      if (!cfg)         return res.status(400).json({ error: `Unknown provider: ${provider}` })
      if (cfg.disabled) return res.status(400).json({ error: `Provider ${provider} chưa hỗ trợ (coming soon)` })
      if (cfg.auth === 'api-key' && !api_key) return res.status(400).json({ error: 'api_key required for this provider' })

      const payload: any = {
        provider, name: String(name).trim(),
        from_email: String(from_email).trim(),
        from_name: from_name ? String(from_name).trim() : null,
        extra: extra || {},
        daily_limit: daily_limit || null,
        status: 'active',
        created_by: user.id,
      }
      if (api_key) payload.api_key_encrypted = encrypt(String(api_key).trim())

      const { data, error } = await admin.from('email_connections')
        .insert(payload)
        .select('id, provider, name, from_email, from_name, status, is_default_transactional, is_default_marketing, created_at')
        .single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(201).json({ success: true, connection: data })
    }

    // ── PATCH: update name / from / api_key / extra ───────────────────────
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const b = req.body || {}
      const patch: Record<string, any> = { updated_at: new Date().toISOString() }
      if (typeof b.name === 'string')       patch.name       = b.name.trim()
      if (typeof b.from_email === 'string') patch.from_email = b.from_email.trim()
      if ('from_name' in b)                 patch.from_name  = b.from_name ? String(b.from_name).trim() : null
      if ('extra' in b)                     patch.extra      = b.extra || {}
      if ('daily_limit' in b)               patch.daily_limit = b.daily_limit || null
      if (typeof b.api_key === 'string' && b.api_key.trim()) {
        patch.api_key_encrypted = encrypt(b.api_key.trim())
      }
      const { data, error } = await admin.from('email_connections')
        .update(patch).eq('id', id)
        .select('id, provider, name, from_email, from_name, status, is_default_transactional, is_default_marketing, updated_at')
        .single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true, connection: data })
    }

    // ── DELETE (refuse if default) ────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: row } = await admin.from('email_connections')
        .select('is_default_transactional, is_default_marketing').eq('id', id).maybeSingle()
      if (!row) return res.status(404).json({ error: 'Not found' })
      if (row.is_default_transactional || row.is_default_marketing) {
        return res.status(400).json({
          error: 'Không thể xoá connection đang là default. Đặt connection khác làm default trước, rồi xoá.',
        })
      }
      const { error } = await admin.from('email_connections').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    // ── POST actions ──────────────────────────────────────────────────────
    if (action === 'test') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: row } = await admin.from('email_connections')
        .select('*').eq('id', id).maybeSingle()
      if (!row) return res.status(404).json({ error: 'Not found' })
      const adapter = pickAdapter(row.provider)
      if (!adapter) return res.status(400).json({ error: `No adapter for ${row.provider}` })

      const apiKey = tryDecryptOrRaw(row.api_key_encrypted) || ''
      const start = Date.now()
      const result = adapter.verify
        ? await adapter.verify({
            api_key: apiKey, from_email: row.from_email, from_name: row.from_name, extra: row.extra,
          })
        : { ok: false, error: 'Provider does not support verify' }
      const latency = Date.now() - start

      await admin.from('email_connections').update({
        last_tested_at: new Date().toISOString(),
        last_test_error: result.ok ? null : (result.error || 'unknown'),
      }).eq('id', id)

      return res.status(result.ok ? 200 : 400).json({ ...result, latency_ms: latency })
    }

    if (action === 'set-default') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const role = (url.searchParams.get('role') || 'transactional').toLowerCase()
      if (role !== 'transactional' && role !== 'marketing') {
        return res.status(400).json({ error: 'role must be transactional | marketing' })
      }
      const field = role === 'marketing' ? 'is_default_marketing' : 'is_default_transactional'
      // Atomic swap: clear all, then set target. Use two updates — partial unique
      // index enforces exactly-one, and clearing first avoids a conflict.
      const clearRes = await admin.from('email_connections').update({ [field]: false })
        .eq(field, true)
      if (clearRes.error) return res.status(500).json({ error: clearRes.error.message })
      const setRes = await admin.from('email_connections').update({ [field]: true }).eq('id', id)
      if (setRes.error) return res.status(500).json({ error: setRes.error.message })
      return res.json({ success: true, role, id })
    }

    if (action === 'disable') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: row } = await admin.from('email_connections')
        .select('is_default_transactional, is_default_marketing').eq('id', id).maybeSingle()
      if (!row) return res.status(404).json({ error: 'Not found' })
      if (row.is_default_transactional || row.is_default_marketing) {
        return res.status(400).json({ error: 'Không thể vô hiệu hoá connection đang là default. Đặt connection khác làm default trước.' })
      }
      const { error } = await admin.from('email_connections').update({ status: 'disabled' }).eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (action === 'enable') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: row } = await admin.from('email_connections').select('provider').eq('id', id).maybeSingle()
      if (!row) return res.status(404).json({ error: 'Not found' })
      const cfg = EMAIL_PROVIDERS[row.provider]
      if (cfg?.disabled) return res.status(400).json({ error: `Provider ${row.provider} chưa hỗ trợ` })
      const { error } = await admin.from('email_connections').update({ status: 'active' }).eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
