// api/knowledge/attach.ts — link/unlink KBs to products (Sprint B)
//   GET    /api/knowledge/attach?product_id=xxx        → list KBs attached to a product
//   GET    /api/knowledge/attach?kb_id=xxx             → list products attached to a KB
//   POST   /api/knowledge/attach  body: {product_id, kb_id, priority?}
//   DELETE /api/knowledge/attach?product_id=X&kb_id=Y

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

const ALLOWED_ROLES = ['owner', 'admin']

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
  if (!caller || !ALLOWED_ROLES.includes(caller.role)) return res.status(403).json({ error: 'Chỉ owner/admin được gán KB vào sản phẩm' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const productId = url.searchParams.get('product_id') || ''
  const kbId = url.searchParams.get('kb_id') || ''

  try {
    // ── LIST ──
    if (req.method === 'GET') {
      if (productId) {
        const { data, error } = await admin.from('product_knowledge_bases')
          .select('kb_id, priority, created_at, knowledge_bases(id, name, slug, description)')
          .eq('product_id', productId)
          .order('priority', { ascending: false })
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ links: data || [] })
      }
      if (kbId) {
        const { data, error } = await admin.from('product_knowledge_bases')
          .select('product_id, priority, created_at, products(id, name, type, status)')
          .eq('kb_id', kbId)
          .order('priority', { ascending: false })
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ links: data || [] })
      }
      return res.status(400).json({ error: 'Truyền product_id hoặc kb_id' })
    }

    // ── ATTACH ──
    if (req.method === 'POST') {
      const { product_id, kb_id, priority } = (req.body || {}) as { product_id?: string; kb_id?: string; priority?: number }
      if (!product_id || !kb_id) return res.status(400).json({ error: 'Cần cả product_id và kb_id' })

      const { data, error } = await admin.from('product_knowledge_bases')
        .upsert(
          { product_id, kb_id, priority: typeof priority === 'number' ? priority : 0 },
          { onConflict: 'product_id,kb_id' }
        )
        .select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ link: data })
    }

    // ── DETACH ──
    if (req.method === 'DELETE') {
      if (!productId || !kbId) return res.status(400).json({ error: 'Truyền cả ?product_id= và ?kb_id=' })
      const { error } = await admin.from('product_knowledge_bases')
        .delete().eq('product_id', productId).eq('kb_id', kbId)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    console.error('[api/knowledge/attach]', e)
    return res.status(500).json({ error: e?.message || 'Lỗi không xác định' })
  }
}
