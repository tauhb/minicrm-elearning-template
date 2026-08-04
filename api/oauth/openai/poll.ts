// api/oauth/openai/poll.ts
// Poll for user authorization. Client should call this every N seconds
// (using poll_interval from /start) until status !== 'pending'.
//
// POST /api/oauth/openai/poll { session_id }
// Response: { status: 'pending' | 'authorized' | 'expired' | 'error', ... }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { pollDeviceAuthorization, exchangeCodeForTokens, computeExpiresAt, CODEX_BASE_URL } from '../../../services/oauth-openai'
import { encrypt } from '../../../services/crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  const { session_id } = req.body || {}
  if (!session_id) return res.status(400).json({ error: 'session_id required' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: session } = await admin.from('oauth_device_sessions')
    .select('*').eq('id', session_id).maybeSingle()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    await admin.from('oauth_device_sessions').update({ status: 'expired' }).eq('id', session_id)
    return res.json({ status: 'expired', error: 'Session expired (>15 min)' })
  }

  if (session.status === 'authorized') return res.json({ status: 'authorized' })
  if (session.status === 'expired') return res.json({ status: 'expired' })
  if (session.status === 'cancelled') return res.json({ status: 'cancelled' })

  try {
    // Poll OpenAI once
    const pollResult = await pollDeviceAuthorization(session.device_auth_id, session.user_code)

    if (pollResult.status === 'pending') {
      return res.json({ status: 'pending' })
    }

    if (pollResult.status === 'error') {
      return res.status(500).json({ status: 'error', error: pollResult.error })
    }

    // Authorized — exchange code for tokens
    const tokens = await exchangeCodeForTokens(pollResult.authorization_code!, pollResult.code_verifier!)
    const expiresAt = computeExpiresAt(tokens.expires_in)

    // Persist to provider_credentials (upsert on provider)
    const encAccess = encrypt(tokens.access_token)
    const encRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null

    const { error: credErr } = await admin.from('provider_credentials').upsert({
      provider: 'openai-codex',
      auth_type: 'oauth_device_code',
      display_name: 'ChatGPT (subscription)',
      status: 'active',
      access_token_encrypted: encAccess,
      refresh_token_encrypted: encRefresh,
      base_url: CODEX_BASE_URL,
      expires_at: expiresAt?.toISOString() || null,
      scopes: tokens.scope ? tokens.scope.split(' ') : null,
      connected_at: new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider' })

    if (credErr) {
      return res.status(500).json({ error: `Persist tokens failed: ${credErr.message}` })
    }

    // Mark session authorized
    await admin.from('oauth_device_sessions').update({
      status: 'authorized',
      authorized_at: new Date().toISOString(),
    }).eq('id', session_id)

    return res.json({
      status: 'authorized',
      provider: 'openai-codex',
      expires_at: expiresAt?.toISOString() || null,
    })
  } catch (e: any) {
    return res.status(500).json({ status: 'error', error: e.message })
  }
}
