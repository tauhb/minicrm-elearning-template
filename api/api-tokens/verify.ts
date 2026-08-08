// api/api-tokens/verify.ts — Sprint E
// POST { token } → { valid, owner_email?, scopes?, reason? }
//
// Used by the MCP server on startup to validate the token the user
// configured.  Sanitised — never returns owner_id or token_id.  This
// endpoint is UNAUTHENTICATED (aside from providing the raw token
// itself, which acts as its own credential).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyApiToken } from '../../services/api-token-auth'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { token } = (req.body || {}) as { token?: string }
  if (!token) return res.status(400).json({ error: 'token required' })

  const result = await verifyApiToken(token)
  if (!result.valid) {
    return res.status(401).json({ valid: false, reason: result.reason || 'Invalid token' })
  }

  return res.status(200).json({
    valid: true,
    owner_email: result.owner_email || null,
    scopes: result.scopes || [],
  })
}
