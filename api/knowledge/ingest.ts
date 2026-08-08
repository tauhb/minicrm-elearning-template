// api/knowledge/ingest.ts
// Extract-and-discard: takes a raw source (image / PDF / URL / text), extracts text,
// runs the distiller, saves KB entries. Never persists the raw file — content flows
// through in-memory buffers only, discarded at request end.
//
//   POST /api/knowledge/ingest?kb_id=X
//   Body: multipart/form-data OR JSON:
//     - kind: 'text' | 'url' | 'pdf' | 'image'
//     - text: string        (kind=text)
//     - url:  string        (kind=url)
//     - file_base64: string (kind=pdf | image — data URL or raw base64)
//     - mime_type: string   (optional, for image)
//     - source_ref: any     (optional metadata to save alongside entries)
//
// Response: { entries_created: N, entry_ids: [...], distill_notes?: string }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { distillRawText } from '../../services/kb-distiller'
import { embedAndStoreEntry } from '../../services/kb-embedder'
import { AI_PROVIDERS } from '../../services/ai-providers'
import { tryDecrypt } from '../../services/crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

function b64ToBuffer(b64: string): Buffer {
  const clean = b64.replace(/^data:[^;]+;base64,/, '')
  return Buffer.from(clean, 'base64')
}

/** Fetch a URL + extract main article text via Readability. Falls back to plain HTML strip. */
async function extractFromUrl(url: string): Promise<{ text: string; title?: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (AgentCRM KB Ingest)' },
  })
  if (!res.ok) throw new Error(`Fetch URL failed: HTTP ${res.status}`)
  const html = await res.text()
  try {
    const { JSDOM } = await import('jsdom')
    const { Readability } = await import('@mozilla/readability')
    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    if (article?.textContent && article.textContent.trim().length > 100) {
      return { text: article.textContent, title: article.title || undefined }
    }
  } catch (e: any) {
    console.warn('[ingest] Readability failed, falling back to plain strip:', e.message)
  }
  // Fallback: strip tags + collapse whitespace
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { text: stripped }
}

/** Extract text from a PDF buffer via pdf-parse. */
async function extractFromPdf(buf: Buffer): Promise<{ text: string; pages?: number }> {
  const pdfParse = (await import('pdf-parse')).default
  const parsed = await pdfParse(buf)
  return { text: (parsed.text || '').trim(), pages: parsed.numpages }
}

/** Extract text from an image using a vision-capable provider (OpenAI GPT-4o family
 *  or Gemini). We call the provider's /chat/completions directly with a multi-part
 *  message — our generic ai-router adapter only handles text messages, so we bypass
 *  it here rather than force multi-modal into that abstraction. */
async function extractFromImage(buf: Buffer, mimeType: string): Promise<{ text: string }> {
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  // Prefer OpenAI (most reliable vision). Fall back to gemini if only that is connected.
  const preferred = ['openai', 'gemini']
  let cred: any = null, providerId = ''
  for (const pid of preferred) {
    const { data } = await admin.from('provider_credentials')
      .select('*').eq('provider', pid).eq('status', 'active').maybeSingle()
    if (data) { cred = data; providerId = pid; break }
  }
  if (!cred) {
    throw new Error('Cần kết nối OpenAI hoặc Gemini (Cài đặt → AI Providers) để trích xuất ảnh (vision).')
  }
  const cfg = AI_PROVIDERS[providerId]
  const apiKey = tryDecrypt(cred.api_key_encrypted || '')
  if (!apiKey) throw new Error(`Không giải mã được API key của "${providerId}".`)

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`
  const model = providerId === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash'
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Bạn là OCR + trợ lý mô tả ảnh. Trích xuất TOÀN BỘ chữ trong ảnh (nếu có) + ' +
          'mô tả ngắn các phần visual quan trọng (biểu đồ, bảng, screenshot UI). ' +
          'Output plain text tiếng Việt, không markdown wrapper.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Trích xuất nội dung từ ảnh này:' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0.1,
  }
  const res = await fetch(`${cred.base_url || cfg.base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Vision ${providerId} HTTP ${res.status}: ${err.slice(0, 300)}`)
  }
  const data: any = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  return { text: typeof text === 'string' ? text.trim() : String(text) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!['owner', 'admin', 'sales', 'support'].includes(caller?.role || '')) {
    return res.status(403).json({ error: 'Chỉ owner/admin/sales/support mới được ingest KB' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const kbId = url.searchParams.get('kb_id') || ''
  if (!kbId) return res.status(400).json({ error: 'kb_id required' })

  const { data: kb } = await admin.from('knowledge_bases').select('id, name, slug').eq('id', kbId).maybeSingle()
  if (!kb) return res.status(404).json({ error: 'KB không tồn tại' })

  const body = req.body || {}
  const kind = String(body.kind || '')
  const sourceRef = body.source_ref || null
  // Per-op AI picker: undefined → backend fallback chain
  const providerHint: string | undefined = body.provider_id || undefined
  const modelHint: string | undefined = body.model || undefined

  try {
    // ── Step 1: extract to text ──
    let extracted: { text: string; hint?: string } = { text: '' }
    if (kind === 'text') {
      extracted.text = String(body.text || '').trim()
      if (!extracted.text) return res.status(400).json({ error: 'text rỗng' })
    } else if (kind === 'url') {
      const target = String(body.url || '').trim()
      if (!/^https?:\/\//i.test(target)) return res.status(400).json({ error: 'url không hợp lệ (phải http/https)' })
      const r = await extractFromUrl(target)
      extracted.text = r.text
      extracted.hint = r.title ? `Nguồn: ${r.title} (${target})` : `Nguồn: ${target}`
    } else if (kind === 'pdf') {
      if (!body.file_base64) return res.status(400).json({ error: 'file_base64 required for kind=pdf' })
      const buf = b64ToBuffer(body.file_base64)
      const r = await extractFromPdf(buf)
      extracted.text = r.text
      extracted.hint = r.pages ? `PDF (${r.pages} trang)` : 'PDF'
    } else if (kind === 'image') {
      if (!body.file_base64) return res.status(400).json({ error: 'file_base64 required for kind=image' })
      const buf = b64ToBuffer(body.file_base64)
      const r = await extractFromImage(buf, String(body.mime_type || 'image/jpeg'))
      extracted.text = r.text
      extracted.hint = 'Trích từ ảnh (OCR + vision)'
    } else {
      return res.status(400).json({ error: `kind không hợp lệ: "${kind}". Dùng text|url|pdf|image.` })
    }

    if (!extracted.text || extracted.text.length < 50) {
      return res.status(400).json({
        error: `Không trích xuất được nội dung đủ dài (min 50 chars, có ${extracted.text.length}). ` +
               `Nếu là PDF ảnh scan, dùng kind=image.`,
      })
    }

    // ── Step 2: distill → structured entries ──
    const drafts = await distillRawText(extracted.text, {
      productHint: kb.name,
      providerHint,
      modelHint,
    })
    if (!drafts.length) {
      return res.status(500).json({ error: 'Distiller không tạo được entry nào. Nội dung có thể quá ngắn / không rõ chủ đề.' })
    }

    // ── Step 3: persist + embed. Never store raw file — extracted.text stays in memory. ──
    const entryIds: string[] = []
    for (const d of drafts) {
      // Ensure filename uniqueness within KB (append suffix on collision)
      let filename = d.filename
      let suffix = 1
      while (true) {
        const { data: exists } = await admin.from('kb_entries')
          .select('id').eq('kb_id', kbId).eq('filename', filename).maybeSingle()
        if (!exists) break
        filename = d.filename.replace(/\.md$/, '') + `-${suffix++}.md`
      }
      const { data: entry, error } = await admin.from('kb_entries').insert({
        kb_id: kbId,
        category: d.category || null,
        filename,
        title: d.title,
        summary: d.summary,
        content: d.content,
        tags: d.tags || [],
        source_kind: kind === 'text' ? 'manual' : 'distilled',
        source_ref: sourceRef || (extracted.hint ? { hint: extracted.hint, kind } : { kind }),
        created_by: user.id,
      }).select('id').single()
      if (error) {
        console.warn('[ingest] entry insert failed:', error.message)
        continue
      }
      entryIds.push(entry.id)
      // Auto-embed (surface per-entry errors but keep going)
      try {
        await embedAndStoreEntry(entry.id)
      } catch (e: any) {
        console.warn('[ingest] embed failed for', entry.id, ':', e.message)
      }
    }

    return res.json({
      entries_created: entryIds.length,
      entry_ids: entryIds,
      distill_notes: extracted.hint,
    })
  } catch (e: any) {
    console.error('[ingest] error:', e)
    return res.status(500).json({ error: e.message || 'Ingest failed' })
  }
}
