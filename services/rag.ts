/**
 * services/rag.ts — Sprint B
 *
 * Retrieval layer for chat/agent flows. Embeds the query with the KB's own
 * embedding provider (must match the provider used to build the chunks) and
 * calls the `kb_search` RPC for cosine top-K.
 */

import { createClient } from '@supabase/supabase-js'
import { embedTexts, type EmbedderConfig } from './kb-embedder'

export interface RagChunk {
  chunk_id: string
  entry_id: string
  entry_title: string
  entry_filename: string
  chunk_text: string
  score: number
}

function admin() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function embedQuery(query: string, cfg: EmbedderConfig): Promise<number[]> {
  const [v] = await embedTexts([query], cfg)
  if (!v) throw new Error('Embed query trả về rỗng')
  return v
}

/**
 * Retrieve top-K chunks for a query across one or more KBs.
 * All KBs must share the same embedding provider/model (they'd better — otherwise
 * the vectors live in different semantic spaces and cosine similarity is meaningless).
 * We enforce this by picking the first KB's config and rejecting mismatches.
 */
export async function retrieve(
  kbIds: string[],
  query: string,
  opts?: { topK?: number; minScore?: number }
): Promise<RagChunk[]> {
  if (!kbIds.length) return []
  if (!query?.trim()) return []
  const topK = opts?.topK ?? 5
  const minScore = opts?.minScore ?? 0.0

  const db = admin()
  const { data: kbs, error: kbErr } = await db.from('knowledge_bases')
    .select('id, embedding_provider, embedding_model, embedding_dim')
    .in('id', kbIds)
  if (kbErr) throw new Error(`Không tải được KB: ${kbErr.message}`)
  if (!kbs?.length) return []

  // Enforce uniform embedding config across the KBs in one query.
  const first = kbs[0]
  const mismatched = kbs.find(k =>
    k.embedding_provider !== first.embedding_provider ||
    k.embedding_model !== first.embedding_model ||
    k.embedding_dim !== first.embedding_dim
  )
  if (mismatched) {
    throw new Error(
      `Các KB trong request dùng embedding provider khác nhau ` +
      `(${first.embedding_provider}/${first.embedding_dim}d vs ${mismatched.embedding_provider}/${mismatched.embedding_dim}d). ` +
      `Chỉ retrieve từ các KB cùng cấu hình.`
    )
  }
  if (!first.embedding_provider || !first.embedding_model || !first.embedding_dim) {
    throw new Error('KB thiếu cấu hình embedding — không thể retrieve.')
  }

  const qVec = await embedQuery(query, {
    provider: first.embedding_provider,
    model: first.embedding_model,
    dim: first.embedding_dim,
  })

  const { data, error } = await db.rpc('kb_search', {
    p_kb_ids: kbIds,
    p_query_embedding: qVec as any,     // supabase-js serialises number[] → pgvector
    p_top_k: topK,
    p_min_score: minScore,
  })
  if (error) throw new Error(`kb_search RPC lỗi: ${error.message}`)

  return (data || []) as RagChunk[]
}

/**
 * Convenience wrapper: retrieve across every KB linked to a given product.
 * Priority is respected via product_knowledge_bases.priority (higher first) — but
 * we still merge chunks across KBs and let cosine similarity sort within the top-K.
 */
export async function retrieveForProduct(
  productId: string,
  query: string,
  opts?: { topK?: number; minScore?: number }
): Promise<RagChunk[]> {
  const db = admin()
  const { data: links, error } = await db.from('product_knowledge_bases')
    .select('kb_id, priority')
    .eq('product_id', productId)
    .order('priority', { ascending: false })
  if (error) throw new Error(`Không tải product_knowledge_bases: ${error.message}`)
  const kbIds = (links || []).map(l => l.kb_id as string)
  if (!kbIds.length) return []
  return retrieve(kbIds, query, opts)
}
