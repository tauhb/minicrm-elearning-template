// api/knowledge/entries/index.ts — KB Entry CRUD (Sprint B)
//   GET    /api/knowledge/entries?kb_id=xxx           → list entries in a KB
//   POST   /api/knowledge/entries                     → create + auto-embed
//   PATCH  /api/knowledge/entries?id=xxx              → update (re-embed if content changed)
//   DELETE /api/knowledge/entries?id=xxx              → delete (cascades chunks)
//   POST   /api/knowledge/entries?action=reembed&id=xxx → force re-embed

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { embedAndStoreEntry } from '../../../services/kb-embedder'

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
    .slice(0, 60) || 'entry'
}

function normalizeFilename(name: string): string {
  let s = String(name || '').trim().toLowerCase()
  s = s.replace(/\.(md|markdown)$/i, '')
  s = slugify(s)
  return `${s}.md`
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
    return res.status(403).json({ error: 'Không có quyền quản lý entry' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id') || ''
  const kbId = url.searchParams.get('kb_id') || ''
  const action = url.searchParams.get('action') || ''

  try {
    // ── LIST ──
    if (req.method === 'GET') {
      if (!kbId) return res.status(400).json({ error: 'Thiếu kb_id' })
      const { data, error } = await admin.from('kb_entries')
        .select('id, kb_id, category, filename, title, summary, tags, source_kind, source_ref, is_active, created_at, updated_at')
        .eq('kb_id', kbId)
        .order('updated_at', { ascending: false })
      if (error) return res.status(500).json({ error: error.message })

      // chunk counts (optional but useful for the table)
      const ids = (data || []).map(e => e.id)
      const chunkCounts: Record<string, number> = {}
      if (ids.length) {
        const { data: chunks } = await admin.from('kb_chunks').select('entry_id').in('entry_id', ids)
        for (const c of (chunks || [])) chunkCounts[c.entry_id] = (chunkCounts[c.entry_id] || 0) + 1
      }
      const enriched = (data || []).map(e => ({ ...e, chunk_count: chunkCounts[e.id] || 0 }))
      return res.json({ entries: enriched })
    }

    // ── FORCE RE-EMBED ──
    if (req.method === 'POST' && action === 'reembed') {
      if (!id) return res.status(400).json({ error: 'Thiếu id' })
      const result = await embedAndStoreEntry(id)
      return res.json({ success: true, ...result })
    }

    // ── CREATE ──
    if (req.method === 'POST') {
      const b = (req.body || {}) as {
        kb_id?: string; filename?: string; category?: string; title?: string
        summary?: string; content?: string; tags?: string[]
        source_kind?: string; source_ref?: any
      }
      if (!b.kb_id) return res.status(400).json({ error: 'Thiếu kb_id' })
      if (!b.title?.trim()) return res.status(400).json({ error: 'Thiếu title' })
      if (!b.summary?.trim()) return res.status(400).json({ error: 'Thiếu summary' })
      if (!b.content?.trim()) return res.status(400).json({ error: 'Thiếu content' })

      const payload = {
        kb_id: b.kb_id,
        filename: normalizeFilename(b.filename || b.title),
        category: b.category ? slugify(b.category) : null,
        title: b.title.trim().slice(0, 120),
        summary: b.summary.trim().slice(0, 280),
        content: b.content,
        tags: Array.isArray(b.tags) ? b.tags.filter(t => typeof t === 'string') : [],
        source_kind: b.source_kind || 'manual',
        source_ref: b.source_ref || null,
        created_by: user.id,
      }

      const { data, error } = await admin.from('kb_entries').insert(payload).select().single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: `Filename "${payload.filename}" đã tồn tại trong KB này.` })
        return res.status(500).json({ error: error.message })
      }

      // Auto-embed. If it fails, keep the entry but report the error — user can retry via "re-embed".
      let embedResult: { chunks_created: number } | null = null
      let embedError: string | null = null
      try {
        embedResult = await embedAndStoreEntry(data.id)
      } catch (e: any) {
        embedError = e?.message || 'Embed thất bại'
        console.error('[api/knowledge/entries] auto-embed failed', e)
      }
      return res.json({ entry: data, embed: embedResult, embed_error: embedError })
    }

    // ── UPDATE ──
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'Thiếu id' })
      const b = (req.body || {}) as any
      const { data: existing } = await admin.from('kb_entries').select('id, content').eq('id', id).maybeSingle()
      if (!existing) return res.status(404).json({ error: 'Không tìm thấy entry' })

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (typeof b.title === 'string' && b.title.trim()) updates.title = b.title.trim().slice(0, 120)
      if (typeof b.summary === 'string') updates.summary = b.summary.trim().slice(0, 280)
      if (typeof b.content === 'string') updates.content = b.content
      if (typeof b.filename === 'string' && b.filename.trim()) updates.filename = normalizeFilename(b.filename)
      if (typeof b.category === 'string' || b.category === null) updates.category = b.category ? slugify(b.category) : null
      if (Array.isArray(b.tags)) updates.tags = b.tags.filter((t: any) => typeof t === 'string')
      if (typeof b.is_active === 'boolean') updates.is_active = b.is_active

      const { data, error } = await admin.from('kb_entries').update(updates).eq('id', id).select().single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Filename trùng — trong cùng KB filename phải unique' })
        return res.status(500).json({ error: error.message })
      }

      // Re-embed if content, title or summary changed (they all feed the vector).
      const contentTouched =
        (typeof b.content === 'string' && b.content !== existing.content) ||
        typeof b.title === 'string' ||
        typeof b.summary === 'string'

      let embedResult: { chunks_created: number } | null = null
      let embedError: string | null = null
      if (contentTouched) {
        try { embedResult = await embedAndStoreEntry(id) }
        catch (e: any) { embedError = e?.message; console.error('[api/knowledge/entries] re-embed failed', e) }
      }
      return res.json({ entry: data, embed: embedResult, embed_error: embedError })
    }

    // ── DELETE ──
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Thiếu id' })
      const { error } = await admin.from('kb_entries').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    console.error('[api/knowledge/entries]', e)
    return res.status(500).json({ error: e?.message || 'Lỗi không xác định' })
  }
}
