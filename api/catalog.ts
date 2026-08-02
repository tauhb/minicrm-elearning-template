// api/catalog.ts — Vercel Serverless Function
// Trả danh sách courses + products để /setup minicrm command tự populate MINICRM.md
//
// GET https://your-portal.vercel.app/api/catalog
// Header: X-Webhook-Secret: <secret>

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const adminClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const db = adminClient()

  try {
    // Verify secret
    const incoming = req.headers['x-webhook-secret'] as string | undefined
    const { data: secretRow, error: secretErr } = await db
      .from('app_settings').select('value').eq('key', 'webhook_secret').maybeSingle()
    if (secretErr) throw secretErr

    const expected = process.env.WEBHOOK_SECRET || (secretRow?.value as any)?.value || ''
    if (!expected || incoming !== expected) {
      return res.status(401).json({ error: 'Invalid webhook secret' })
    }

    const [coursesRes, productsRes] = await Promise.all([
      db.from('courses').select('id, title, price').order('created_at', { ascending: false }),
      db.from('products').select('id, name, type, price').eq('status', 'active').order('created_at', { ascending: false }),
    ])

    if (coursesRes.error) throw coursesRes.error
    if (productsRes.error) throw productsRes.error

    return res.json({
      courses:  (coursesRes.data  || []).map((c: any) => ({ id: c.id, title: c.title, price: c.price })),
      products: (productsRes.data || []).map((p: any) => ({ id: p.id, name: p.name, type: p.type, price: p.price })),
    })
  } catch (err: any) {
    console.error('[catalog]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
