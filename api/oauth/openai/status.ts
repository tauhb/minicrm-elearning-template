// api/oauth/openai/status.ts — Get current ChatGPT OAuth connection status
// GET /api/oauth/openai/status (admin only)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

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
  if (!['owner','admin'].includes(caller?.role || '')) return res.status(403).json({ error: 'Admin only' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: cred } = await admin.from('provider_credentials')
    .select('provider, auth_type, display_name, status, base_url, expires_at, account_email, connected_at, last_refreshed_at, last_used_at')
    .eq('provider', 'openai-codex')
    .maybeSingle()

  if (!cred) {
    return res.json({ connected: false })
  }

  const expired = cred.expires_at && new Date(cred.expires_at) < new Date()

  return res.json({
    connected: cred.status === 'active' && !expired,
    provider: cred.provider,
    auth_type: cred.auth_type,
    display_name: cred.display_name,
    status: cred.status,
    base_url: cred.base_url,
    account_email: cred.account_email,
    connected_at: cred.connected_at,
    last_refreshed_at: cred.last_refreshed_at,
    last_used_at: cred.last_used_at,
    expires_at: cred.expires_at,
    expired,
  })
}
