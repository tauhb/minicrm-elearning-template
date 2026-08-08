// api/knowledge/distill.ts — Karpathy-style ingestion (Sprint B, Q3=B auto-accept)
//   POST /api/knowledge/distill  body: {kb_id, raw_text, source_kind?, source_ref?, product_hint?, provider_hint?}
//     → LLM extracts 1–8 structured entries → persist + auto-embed → return {entries_created, entries}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { distillRawText } from '../../services/kb-distiller'
import { embedAndStoreEntry } from '../../services/kb-embedder'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Thiếu token' })
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${authHeader.slice(7)}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Token không hợp lệ' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || !ALLOWED_ROLES.includes(caller.role)) return res.status(403).json({ error: 'Không có quyền distill' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { kb_id, raw_text, source_kind, source_ref, product_hint, provider_hint } = (req.body || {}) as {
    kb_id?: string; raw_text?: string
    source_kind?: string; source_ref?: any
    product_hint?: string; provider_hint?: string
  }
  if (!kb_id) return res.status(400).json({ error: 'Thiếu kb_id' })
  if (!raw_text?.trim()) return res.status(400).json({ error: 'Thiếu raw_text' })
  if (raw_text.length > 200_000) return res.status(400).json({ error: 'raw_text quá dài (>200k chars). Chia nhỏ và distill nhiều lần.' })

  // Verify KB exists
  const { data: kb } = await admin.from('knowledge_bases').select('id').eq('id', kb_id).maybeSingle()
  if (!kb) return res.status(404).json({ error: 'Không tìm thấy KB' })

  try {
    const drafts = await distillRawText(raw_text, { productHint: product_hint, providerHint: provider_hint })
    if (!drafts.length) return res.json({ entries_created: 0, entries: [], warning: 'Distiller không tạo được entry nào từ nội dung này.' })

    // Persist each draft. Auto-embed. Filename collisions inside the KB → append -N suffix.
    const created: any[] = []
    const skipped: any[] = []
    const embedErrors: any[] = []

    // Preload existing filenames for collision handling
    const { data: existing } = await admin.from('kb_entries').select('filename').eq('kb_id', kb_id)
    const taken = new Set<string>((existing || []).map(e => e.filename as string))

    for (const draft of drafts) {
      let filename = normalizeFilename(draft.filename)
      if (taken.has(filename)) {
        const base = filename.replace(/\.md$/i, '')
        for (let n = 2; n < 100; n++) {
          const candidate = `${base}-${n}.md`
          if (!taken.has(candidate)) { filename = candidate; break }
        }
      }
      taken.add(filename)

      const payload = {
        kb_id,
        filename,
        category: draft.category ? slugify(draft.category) : null,
        title: draft.title.slice(0, 120),
        summary: draft.summary.slice(0, 280),
        content: draft.content,
        tags: draft.tags || [],
        source_kind: source_kind || 'distilled',
        source_ref: source_ref || null,
        created_by: user.id,
      }

      const { data: entry, error } = await admin.from('kb_entries').insert(payload).select().single()
      if (error) {
        skipped.push({ filename, error: error.message })
        continue
      }
      try {
        const embedRes = await embedAndStoreEntry(entry.id)
        created.push({ ...entry, chunks_created: embedRes.chunks_created })
      } catch (e: any) {
        embedErrors.push({ entry_id: entry.id, filename, error: e?.message })
        created.push({ ...entry, chunks_created: 0 })
      }
    }

    return res.json({
      entries_created: created.length,
      entries: created,
      skipped,
      embed_errors: embedErrors,
    })
  } catch (e: any) {
    console.error('[api/knowledge/distill]', e)
    return res.status(500).json({ error: e?.message || 'Distill thất bại' })
  }
}
