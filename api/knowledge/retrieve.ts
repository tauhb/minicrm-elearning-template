// api/knowledge/retrieve.ts — RAG retrieval endpoint (Sprint B)
//   POST /api/knowledge/retrieve  body: {kb_ids?, product_id?, query, top_k?, min_score?}
//     → returns {chunks: RagChunk[]}
//
// Called by:
//   • Sprint D chat widget (auto-inject retrieved chunks into system prompt)
//   • Ad-hoc "test retrieval" button in the KB admin UI

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { retrieve, retrieveForProduct } from '../../services/rag'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = ['owner', 'admin', 'sales', 'support']

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
  if (!caller || !ALLOWED_ROLES.includes(caller.role)) return res.status(403).json({ error: 'Không có quyền retrieve' })

  const { kb_ids, product_id, query, top_k, min_score } = (req.body || {}) as {
    kb_ids?: string[]; product_id?: string; query?: string; top_k?: number; min_score?: number
  }
  if (!query?.trim()) return res.status(400).json({ error: 'Thiếu query' })
  if (!kb_ids?.length && !product_id) return res.status(400).json({ error: 'Cần kb_ids[] hoặc product_id' })

  try {
    const opts = {
      topK: typeof top_k === 'number' ? Math.max(1, Math.min(50, top_k)) : 5,
      minScore: typeof min_score === 'number' ? min_score : 0.0,
    }
    const chunks = product_id
      ? await retrieveForProduct(product_id, query, opts)
      : await retrieve(kb_ids || [], query, opts)
    return res.json({ chunks, query, count: chunks.length })
  } catch (e: any) {
    console.error('[api/knowledge/retrieve]', e)
    return res.status(500).json({ error: e?.message || 'Retrieve thất bại' })
  }
}
