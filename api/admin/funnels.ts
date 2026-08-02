// api/admin/funnels.ts
// CRUD funnels registry — admin nhập URL các funnel để affiliate có share link đầy đủ
// GET    /api/admin/funnels        — list all
// POST   /api/admin/funnels        — tạo mới
// PATCH  /api/admin/funnels        — update theo id
// DELETE /api/admin/funnels?id=    — xóa theo id

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const getAdminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function requireAdmin(req: VercelRequest, supabase: ReturnType<typeof getAdminClient>): Promise<string | null> {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const anonClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user } } = await anonClient.auth.getUser()
  if (!user) return null
  const { data: customer } = await supabase.from('customers').select('role').eq('id', user.id).maybeSingle()
  return customer?.role === 'admin' ? user.id : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getAdminClient()
  const adminId = await requireAdmin(req, supabase)
  if (!adminId) return res.status(403).json({ error: 'Forbidden' })

  // GET — list all
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('funnels')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ funnels: data || [] })
  }

  // POST — create
  if (req.method === 'POST') {
    const { slug, name, description, url, type, course_id, product_id, sort_order } = req.body
    if (!slug || !name || !url) return res.status(400).json({ error: 'slug, name, url là bắt buộc' })

    // Normalize URL (ensure no trailing slash)
    const cleanUrl = String(url).trim().replace(/\/+$/, '')

    const { data, error } = await supabase.from('funnels').insert({
      slug:        String(slug).trim().toLowerCase(),
      name,
      description,
      url:         cleanUrl,
      type:        type || 'sales',
      course_id:   course_id || null,
      product_id:  product_id || null,
      sort_order:  sort_order ?? 0,
      is_active:   true,
    }).select().single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ funnel: data })
  }

  // PATCH — update
  if (req.method === 'PATCH') {
    const { id, slug, name, description, url, type, course_id, product_id, sort_order, is_active } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })

    const updates: Record<string, any> = {}
    if (slug !== undefined)        updates.slug = String(slug).trim().toLowerCase()
    if (name !== undefined)        updates.name = name
    if (description !== undefined) updates.description = description
    if (url !== undefined)         updates.url = String(url).trim().replace(/\/+$/, '')
    if (type !== undefined)        updates.type = type
    if (course_id !== undefined)   updates.course_id = course_id || null
    if (product_id !== undefined)  updates.product_id = product_id || null
    if (sort_order !== undefined)  updates.sort_order = sort_order
    if (is_active !== undefined)   updates.is_active = is_active

    const { data, error } = await supabase.from('funnels').update(updates).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ funnel: data })
  }

  // DELETE
  if (req.method === 'DELETE') {
    const id = String(req.query.id || req.body?.id || '')
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('funnels').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
