// services/api-token-auth.ts
// Sprint E · MCP server — verify raw API tokens presented by external agents.
//
// Contract:
//   verifyApiToken('acrm_xxx...') → { valid, owner_id?, scopes?, reason? }
//
// The raw token is hashed with SHA-256 and looked up in `api_tokens`.
// Row is rejected if revoked or expired.  On success we fire-and-forget
// bump last_used_at.
//
// requireScope() implements the wildcard `*` rule: any token holding `*`
// bypasses granular scope checks (owner-issued full-access tokens).
//
// This helper is used by both the local dev api-server (via dynamic
// import) and the /api/api-tokens/verify.ts endpoint.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const RAW_TOKEN_PREFIX = 'acrm_'
export const TOKEN_PREFIX_LEN = 13 // "acrm_" + 8 hex chars shown to user

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Generate a fresh raw token — `acrm_` + 32 lowercase hex chars. */
export function generateRawToken(): string {
  return RAW_TOKEN_PREFIX + crypto.randomBytes(16).toString('hex')
}

/** Public prefix for display: `acrm_` + first 8 hex chars of the random tail. */
export function tokenPrefix(raw: string): string {
  return raw.slice(0, TOKEN_PREFIX_LEN)
}

export interface VerifyResult {
  valid: boolean
  owner_id?: string
  owner_email?: string
  token_id?: string
  scopes?: string[]
  reason?: string
}

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function verifyApiToken(rawToken: string): Promise<VerifyResult> {
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false, reason: 'Missing token' }
  }
  const trimmed = rawToken.trim()
  if (!trimmed.startsWith(RAW_TOKEN_PREFIX)) {
    return { valid: false, reason: 'Malformed token (missing prefix)' }
  }

  const db = adminDb()
  const hash = hashToken(trimmed)
  const { data: row, error } = await db
    .from('api_tokens')
    .select('id, owner_id, scopes, revoked_at, expires_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (error) return { valid: false, reason: `Lookup error: ${error.message}` }
  if (!row) return { valid: false, reason: 'Unknown token' }
  if (row.revoked_at) return { valid: false, reason: 'Token revoked' }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, reason: 'Token expired' }
  }

  // Fire-and-forget last_used_at bump — don't await.
  db.from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => {}, () => {})

  // Best-effort owner email (never blocking).
  let owner_email: string | undefined
  const { data: cust } = await db
    .from('customers')
    .select('email')
    .eq('id', row.owner_id)
    .maybeSingle()
  if (cust?.email) owner_email = cust.email

  return {
    valid: true,
    owner_id: row.owner_id,
    owner_email,
    token_id: row.id,
    scopes: row.scopes || [],
  }
}

export function requireScope(scopes: string[] | undefined, required: string): boolean {
  if (!scopes || !Array.isArray(scopes)) return false
  return scopes.includes('*') || scopes.includes(required)
}
