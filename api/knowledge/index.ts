// api/knowledge/index.ts — KB CRUD (Sprint B)
//   GET    /api/knowledge              → list all KBs with entry_count + last_updated
//   POST   /api/knowledge              → create {name, slug, description, embedding_provider, embedding_model, embedding_dim}
//   PATCH  /api/knowledge?id=xxx       → update {name?, description?}
//   DELETE /api/knowledge?id=xxx       → cascade delete

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

const ALLOWED_ROLES = ['owner', 'admin', 'sales', 'support']

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'kb'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Thiếu token' })
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${authHeader.slice(7)}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Token không hợp lệ' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || !ALLOWED_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Không có quyền quản lý kho kiến thức' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id') || ''
  const action = url.searchParams.get('action') || ''

  try {
    // ── ELIGIBLE EMBEDDING PROVIDERS (for the KB create picker) ──
    // Returns registry providers with supports_embeddings=true, annotated with
    // whether their credential is connected. UI uses this to render the dropdown
    // (disabled + "Kết nối trước" hint for not-connected rows).
    if (req.method === 'GET' && action === 'embedding-providers') {
      const { AI_PROVIDERS } = await import('../../services/ai-providers')
      const { data: creds } = await admin.from('provider_credentials')
        .select('provider, status')
      const credMap = new Map((creds || []).map(c => [c.provider, c.status]))
      const items = Object.values(AI_PROVIDERS)
        .filter(p => p.supports_embeddings)
        .map(p => ({
          id: p.id,
          label: p.label,
          embedding_model: p.embedding_model,
          embedding_dim: p.embedding_dim,
          connected: credMap.has(p.id),
          status: credMap.get(p.id) || 'disconnected',
          docs_url: p.docs_url,
        }))
      return res.json({ providers: items })
    }

    // ── LIST ──
    if (req.method === 'GET') {
      const { data: kbs, error } = await admin.from('knowledge_bases')
        .select('id, slug, name, description, embedding_provider, embedding_model, embedding_dim, created_at, updated_at')
        .order('updated_at', { ascending: false })
      if (error) return res.status(500).json({ error: error.message })

      // Batch count entries per KB
      const ids = (kbs || []).map(k => k.id)
      const counts: Record<string, { entry_count: number; last_entry_at: string | null }> = {}
      if (ids.length) {
        const { data: rows } = await admin.from('kb_entries')
          .select('kb_id, updated_at')
          .in('kb_id', ids)
          .eq('is_active', true)
        for (const kbId of ids) counts[kbId] = { entry_count: 0, last_entry_at: null }
        for (const r of (rows || [])) {
          const c = counts[r.kb_id]
          if (!c) continue
          c.entry_count += 1
          if (!c.last_entry_at || (r.updated_at && r.updated_at > c.last_entry_at)) c.last_entry_at = r.updated_at
        }
      }

      const items = (kbs || []).map(k => ({
        ...k,
        entry_count: counts[k.id]?.entry_count ?? 0,
        last_entry_at: counts[k.id]?.last_entry_at ?? null,
      }))
      return res.json({ knowledge_bases: items })
    }

    // ── CREATE ──
    if (req.method === 'POST') {
      const { name, slug, description, embedding_provider, embedding_model, embedding_dim } = (req.body || {}) as {
        name?: string; slug?: string; description?: string
        embedding_provider?: string; embedding_model?: string; embedding_dim?: number
      }
      if (!name?.trim()) return res.status(400).json({ error: 'Tên KB bắt buộc' })

      const provider = embedding_provider || 'openai'
      // Look up provider registry for defaults + capability check
      const { AI_PROVIDERS } = await import('../../services/ai-providers')
      const providerCfg = AI_PROVIDERS[provider]
      if (!providerCfg) {
        return res.status(400).json({ error: `Provider "${provider}" không tồn tại trong registry.` })
      }
      if (!providerCfg.supports_embeddings) {
        const eligible = Object.values(AI_PROVIDERS).filter(p => p.supports_embeddings).map(p => p.id).join(', ')
        return res.status(400).json({ error: `Provider "${provider}" không hỗ trợ embeddings. Chọn 1 trong: ${eligible}.` })
      }
      const model = embedding_model || providerCfg.embedding_model!
      const dim   = embedding_dim   || providerCfg.embedding_dim!
      if (!model || !dim) {
        return res.status(400).json({ error: `Provider "${provider}" thiếu embedding_model hoặc embedding_dim trong registry.` })
      }

      // Verify the credential is connected — better UX than "fetch failed" later
      const { data: cred } = await admin.from('provider_credentials')
        .select('provider, status').eq('provider', provider).maybeSingle()
      if (!cred) {
        return res.status(400).json({ error: `Provider "${provider}" chưa được kết nối. Vào Cài đặt → AI Providers để kết nối API key trước khi tạo KB.` })
      }
      if (cred.status !== 'active' && cred.status !== 'expiring') {
        return res.status(400).json({ error: `Provider "${provider}" đang ở trạng thái "${cred.status}". Kết nối lại rồi thử.` })
      }

      const finalSlug = slugify(slug || name)
      const payload = {
        name: name.trim(),
        slug: finalSlug,
        description: description?.trim() || null,
        embedding_provider: provider,
        embedding_model: model,
        embedding_dim: dim,
        created_by: user.id,
      }
      const { data, error } = await admin.from('knowledge_bases').insert(payload).select().single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: `Slug "${finalSlug}" đã tồn tại. Đặt slug khác.` })
        return res.status(500).json({ error: error.message })
      }
      return res.json({ knowledge_base: data })
    }

    // ── UPDATE ──
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'Thiếu id' })
      const { name, description } = (req.body || {}) as { name?: string; description?: string }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (typeof name === 'string' && name.trim()) updates.name = name.trim()
      if (typeof description === 'string' || description === null) updates.description = description
      if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Không có field hợp lệ' })

      const { data, error } = await admin.from('knowledge_bases').update(updates).eq('id', id).select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ knowledge_base: data })
    }

    // ── DELETE ──
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Thiếu id' })
      const { error } = await admin.from('knowledge_bases').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    console.error('[api/knowledge]', e)
    return res.status(500).json({ error: e?.message || 'Lỗi không xác định' })
  }
}
