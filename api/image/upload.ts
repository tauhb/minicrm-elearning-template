// api/image/upload.ts — Upload image to Supabase Storage funnel-images bucket
// POST /api/image/upload (admin only)
// Body: application/json { filename, content_type, base64_data, funnel_id?, step_id? }
// Returns { url, path }
//
// Design: JSON base64 rather than multipart to keep this endpoint compatible with
// both Vercel serverless (limited multipart support in serverless) and our api-server.mjs dev mode.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']
const MAX_BYTES = 10 * 1024 * 1024   // 10 MB
const EXT_MAP: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (caller?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })

  const body = req.body || {}
  const contentType = String(body.content_type || '').toLowerCase()
  const base64Data = String(body.base64_data || '')
  const funnelId = String(body.funnel_id || 'shared')
  const stepId = String(body.step_id || 'shared')

  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ error: `Invalid content_type "${contentType}". Allowed: ${ALLOWED_TYPES.join(', ')}` })
  }
  if (!base64Data) return res.status(400).json({ error: 'base64_data required' })

  // Decode + size check
  const raw = base64Data.includes(',') ? base64Data.split(',').pop()! : base64Data
  const buf = Buffer.from(raw, 'base64')
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: `File too large (${(buf.length / 1024 / 1024).toFixed(1)} MB > 10 MB)` })

  const ext = EXT_MAP[contentType] || 'bin'
  const uuid = crypto.randomBytes(8).toString('hex')
  const path = `${funnelId}/${stepId}/${uuid}.${ext}`

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const { error: upErr } = await admin.storage
      .from('funnel-images')
      .upload(path, buf, { contentType, upsert: false })
    if (upErr) return res.status(500).json({ error: `Upload failed: ${upErr.message}` })

    const { data: pub } = admin.storage.from('funnel-images').getPublicUrl(path)
    return res.json({ url: pub?.publicUrl, path, size_bytes: buf.length })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
