/**
 * services/kb-embedder.ts — Sprint B
 *
 * Chunking + embedding for KB entries.
 *
 * Design notes:
 *   • Text is split on paragraph boundaries first, then packed into ~500-token windows
 *     (~2000 chars) with 100-token (~400 char) overlap so retrieval catches boundaries.
 *   • ANY provider with `supports_embeddings: true` in ai-providers.ts works — migration
 *     026 loosened kb_chunks.embedding to variable-dim `vector`. Provider registry
 *     declares dim per provider (OpenAI 1536, Kimi 1536, Gemini 768, Qwen 1024).
 *   • Provider credentials come from `provider_credentials` (same table as ai-router).
 *     We do NOT go through ai-router itself — that's a chat-completion path. Embeddings
 *     hit `${base_url}/embeddings` directly (OpenAI-compat), which most providers ship.
 *   • Sanity check: whatever dim the API returns is the dim persisted onto the KB row.
 *     Retrieval side (rag.ts) refuses to search cross-dim.
 */

import { createClient } from '@supabase/supabase-js'
import { tryDecrypt } from './crypto'
import { getProviderConfig } from './ai-providers'

export interface EmbedderConfig {
  provider: string
  model: string
  dim: number
}

// ─── credential lookup (minimal, api-key only — no OAuth for embeddings) ─────

interface EmbedCred { baseUrl: string; apiKey: string; providerId: string }

function admin() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function loadEmbedCred(providerId: string): Promise<EmbedCred> {
  const db = admin()
  const { data: cred } = await db.from('provider_credentials')
    .select('*').eq('provider', providerId).maybeSingle()
  if (!cred) {
    throw new Error(
      `Provider "${providerId}" chưa được kết nối. Vào Cài đặt → AI Providers để kết nối API key trước.`
    )
  }
  if (cred.status !== 'active' && cred.status !== 'expiring') {
    throw new Error(`Provider "${providerId}" đang ở trạng thái "${cred.status}". Vào Cài đặt để kết nối lại.`)
  }
  const cfg = getProviderConfig(providerId)
  if (cfg.auth_type !== 'api-key') {
    throw new Error(`Provider "${providerId}" dùng OAuth — chưa hỗ trợ cho embeddings. Dùng openai/kimi (api-key).`)
  }
  const apiKey = tryDecrypt(cred.api_key_encrypted || '') || ''
  if (!apiKey) throw new Error(`Không giải mã được API key của "${providerId}". Kiểm tra PROVIDER_ENCRYPTION_KEY.`)
  return {
    baseUrl: cred.base_url || cfg.base_url,
    apiKey,
    providerId,
  }
}

// ─── chunking ────────────────────────────────────────────────────────────────

/**
 * Split text into chunks of ~500 tokens (~2000 chars) with ~100-token (~400 char) overlap.
 * Respects paragraph boundaries first, then splits within a paragraph if it exceeds the window.
 */
export async function chunkText(
  text: string,
  opts?: { chunkSize?: number; overlap?: number }
): Promise<string[]> {
  const chunkSize = opts?.chunkSize ?? 2000       // ~500 tokens
  const overlap   = opts?.overlap   ?? 400        // ~100 tokens
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  // 1) paragraph split
  const paragraphs = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  const chunks: string[] = []
  let buf = ''

  const flush = () => {
    if (!buf.trim()) return
    chunks.push(buf.trim())
    // keep the tail as overlap for the next chunk
    if (overlap > 0 && buf.length > overlap) {
      buf = buf.slice(-overlap)
    } else {
      buf = ''
    }
  }

  for (const p of paragraphs) {
    // If a single paragraph is bigger than the window, hard-slice it
    if (p.length > chunkSize) {
      if (buf.trim()) flush()
      let i = 0
      while (i < p.length) {
        const slice = p.slice(i, i + chunkSize)
        chunks.push(slice.trim())
        i += Math.max(1, chunkSize - overlap)
      }
      buf = ''  // hard-sliced chunks don't participate in overlap chain
      continue
    }

    // Would this paragraph exceed the current chunk window?
    if ((buf + '\n\n' + p).length > chunkSize && buf.trim()) {
      flush()
    }
    buf = buf ? buf + '\n\n' + p : p
  }
  if (buf.trim()) chunks.push(buf.trim())

  return chunks
}

// ─── embedding call ──────────────────────────────────────────────────────────

/**
 * Batch embedding call. OpenAI-compat `/embeddings` endpoint expects
 *   { input: string | string[], model: string }
 * and returns { data: [{ embedding: number[], index }] }.
 *
 * Kimi (Moonshot) and OpenAI both follow this exact shape at their `/v1/embeddings`.
 * Gemini's OpenAI-compat facade at /v1beta/openai/embeddings only ships 768-dim
 * (text-embedding-004), which is not compatible with our vector(1536) column — the
 * caller (rag/kb layer) rejects non-1536 dims before we even reach here.
 */
export async function embedTexts(texts: string[], cfg: EmbedderConfig): Promise<number[][]> {
  if (!texts.length) return []
  const cred = await loadEmbedCred(cfg.provider)

  // Batch in groups of 96 to stay well under provider limits.
  const BATCH = 96
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const res = await fetch(`${cred.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cred.apiKey}`,
      },
      body: JSON.stringify({ input: batch, model: cfg.model }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Embedding API (${cfg.provider}) HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }
    const data: any = await res.json()
    const rows = (data.data || []) as Array<{ embedding: number[]; index: number }>
    if (rows.length !== batch.length) {
      throw new Error(`Embedding API trả ${rows.length} vector cho ${batch.length} input`)
    }
    // Sort by index just in case provider doesn't preserve order (OpenAI does, but paranoid).
    rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const r of rows) {
      if (!Array.isArray(r.embedding) || r.embedding.length !== cfg.dim) {
        throw new Error(`Embedding size mismatch: expected ${cfg.dim}, got ${r.embedding?.length}`)
      }
      out.push(r.embedding)
    }
  }
  return out
}

// ─── embed + persist ─────────────────────────────────────────────────────────

/**
 * Load an entry, chunk its content, embed each chunk, and replace the entry's chunks.
 * Idempotent — safe to call after every content update.
 */
export async function embedAndStoreEntry(entryId: string): Promise<{ chunks_created: number }> {
  const db = admin()

  const { data: entry, error: entryErr } = await db.from('kb_entries')
    .select('id, kb_id, title, summary, content, filename')
    .eq('id', entryId)
    .maybeSingle()
  if (entryErr || !entry) throw new Error(`Không tìm thấy entry ${entryId}`)

  const { data: kb, error: kbErr } = await db.from('knowledge_bases')
    .select('id, embedding_provider, embedding_model, embedding_dim')
    .eq('id', entry.kb_id).maybeSingle()
  if (kbErr || !kb) throw new Error(`Không tìm thấy KB ${entry.kb_id}`)
  if (!kb.embedding_provider || !kb.embedding_model || !kb.embedding_dim) {
    throw new Error(`KB "${entry.kb_id}" thiếu cấu hình embedding_provider/model/dim`)
  }

  // Prepend title + summary so the first chunk carries semantic context even when
  // the body chunks are sliced far from the doc header.
  const body = `# ${entry.title}\n\n${entry.summary}\n\n${entry.content}`
  const chunks = await chunkText(body)
  if (!chunks.length) {
    // clear existing anyway
    await db.from('kb_chunks').delete().eq('entry_id', entryId)
    return { chunks_created: 0 }
  }

  const vectors = await embedTexts(chunks, {
    provider: kb.embedding_provider,
    model: kb.embedding_model,
    dim: kb.embedding_dim,
  })

  // Replace: delete old chunks, insert new. Do delete first so a mid-run failure
  // leaves an empty entry rather than a mix of old+new vectors.
  const { error: delErr } = await db.from('kb_chunks').delete().eq('entry_id', entryId)
  if (delErr) throw new Error(`Xoá chunks cũ thất bại: ${delErr.message}`)

  const rows = chunks.map((text, i) => ({
    entry_id: entryId,
    chunk_index: i,
    text,
    embedding: vectors[i],
    metadata: { title: entry.title, filename: entry.filename },
  }))

  // Chunked insert (Supabase caps single insert around ~1000 rows; be safe)
  const INSERT_BATCH = 200
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const slice = rows.slice(i, i + INSERT_BATCH)
    const { error: insErr } = await db.from('kb_chunks').insert(slice)
    if (insErr) throw new Error(`Lưu chunks thất bại: ${insErr.message}`)
  }

  // Touch updated_at on entry (chunks are downstream, but user sees "last indexed" here)
  await db.from('kb_entries').update({ updated_at: new Date().toISOString() }).eq('id', entryId)

  return { chunks_created: rows.length }
}
