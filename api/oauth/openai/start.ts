// api/oauth/openai/start.ts
// Start OpenAI Codex device auth flow.
// POST /api/oauth/openai/start (admin only)
// Response: { user_code, verification_uri, poll_interval, session_id, expires_at }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requestDeviceCode } from '../../../services/oauth-openai'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Admin only
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

  const { data: caller } = await userClient
    .from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || caller.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' })
  }

  // Kick off device flow
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const device = await requestDeviceCode()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min timeout

    const { data: session, error } = await admin.from('oauth_device_sessions')
      .insert({
        provider: 'openai-codex',
        device_auth_id: device.device_auth_id,
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        poll_interval_seconds: device.interval,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
        created_by: user.id,
      })
      .select('id')
      .single()

    if (error || !session) {
      return res.status(500).json({ error: `Session persist failed: ${error?.message}` })
    }

    return res.json({
      session_id: session.id,
      user_code: device.user_code,
      verification_uri: device.verification_uri,
      poll_interval: device.interval,
      expires_at: expiresAt.toISOString(),
    })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
