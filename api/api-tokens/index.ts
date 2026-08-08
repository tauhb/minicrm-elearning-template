// api/api-tokens/index.ts — Sprint E · MCP API tokens
//
// GET    /api/api-tokens                   → list caller's own tokens
// POST   /api/api-tokens                   → create {name, scopes[], expires_at?}
//                                             returns raw token ONCE
// POST   /api/api-tokens?action=revoke&id  → set revoked_at = now()
// DELETE /api/api-tokens?id=xx             → hard delete
//
// Any authenticated customer manages their OWN tokens (RLS enforced by
// the api_tokens.owner_id = auth.uid() policy — but we still gate here
// so admin/service-role writes are explicit).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateRawToken, hashToken, tokenPrefix } from '../../services/api-token-auth'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

// Canonical scope list — MUST mirror mcp-server/src/scopes.ts
export const CANONICAL_SCOPES = [
  'leads.read', 'leads.write', 'leads.convert',
  'customers.read', 'customers.write', 'customers.deactivate',
  'tasks.read', 'tasks.write', 'tasks.complete',
  'orders.read', 'orders.refund',
  'funnels.read', 'funnels.publish',
  'chat.read', 'chat.reply',
  'knowledge.read', 'knowledge.write',
  'team.read', 'team.invite',
  'analytics.read',
] as const

const OWNER_ONLY_SCOPES = new Set(['*'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action') || ''
  const qsId = url.searchParams.get('id') || ''

  // Auth: any authenticated user
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Thiếu token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } },
  )
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return res.status(401).json({ error: 'Token không hợp lệ' })

  const { data: caller } = await userClient
    .from('customers')
    .select('id, role, email')
    .eq('id', user.id)
    .maybeSingle()
  if (!caller) return res.status(403).json({ error: 'Không tìm thấy tài khoản' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    if (req.method === 'GET') {
      const { data, error } = await admin
        .from('api_tokens')
        .select('id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ tokens: data || [] })
    }

    if (req.method === 'POST' && action === 'revoke') {
      const id = qsId || (req.body as any)?.id
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await admin
        .from('api_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_id', user.id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (req.method === 'POST') {
      const { name, scopes, expires_at } = (req.body || {}) as {
        name?: string
        scopes?: string[]
        expires_at?: string | null
      }
      if (!name || !name.trim()) return res.status(400).json({ error: 'name bắt buộc' })
      if (!Array.isArray(scopes) || scopes.length === 0) {
        return res.status(400).json({ error: 'scopes[] bắt buộc (ít nhất 1)' })
      }

      // Validate scopes
      const valid = new Set<string>([...CANONICAL_SCOPES, '*'])
      const bad = scopes.filter(s => !valid.has(s))
      if (bad.length) return res.status(400).json({ error: `Scope không hợp lệ: ${bad.join(', ')}` })

      // Owner-only gate for wildcard
      for (const s of scopes) {
        if (OWNER_ONLY_SCOPES.has(s) && caller.role !== 'owner') {
          return res.status(403).json({ error: `Scope "${s}" chỉ owner mới cấp được` })
        }
      }

      const raw = generateRawToken()
      const insert = {
        owner_id: user.id,
        name: name.trim().slice(0, 120),
        token_hash: hashToken(raw),
        token_prefix: tokenPrefix(raw),
        scopes,
        expires_at: expires_at || null,
      }
      const { data, error } = await admin
        .from('api_tokens')
        .insert(insert)
        .select('id, name, token_prefix, scopes, expires_at, created_at')
        .single()
      if (error) return res.status(500).json({ error: error.message })

      return res.status(201).json({
        token: data,
        raw_token: raw, // shown once, never persisted in raw form
        warning: 'Copy the raw token now — it will not be shown again.',
      })
    }

    if (req.method === 'DELETE') {
      if (!qsId) return res.status(400).json({ error: 'id required' })
      const { error } = await admin
        .from('api_tokens')
        .delete()
        .eq('id', qsId)
        .eq('owner_id', user.id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('[api-tokens]', err)
    return res.status(500).json({ error: err.message || 'Internal error' })
  }
}
