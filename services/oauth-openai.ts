/**
 * services/oauth-openai.ts — OpenAI Codex OAuth Device Flow
 *
 * Reference: Hermes Agent (nousresearch/hermes-agent, hermes_cli/auth.py)
 *
 * Flow (RFC 8628 variant used by OpenAI Codex CLI):
 *   1. Request device code: POST auth.openai.com/api/accounts/deviceauth/usercode
 *   2. Show user_code → user visits auth.openai.com/codex/device
 *   3. Poll auth.openai.com/api/accounts/deviceauth/token until 200
 *   4. Exchange authorization_code for tokens at auth.openai.com/oauth/token
 *
 * ⚠️ Uses public Codex CLI client_id. OpenAI could restrict this.
 *   Grey-area unofficial but currently functional.
 */

export const OPENAI_ISSUER = 'https://auth.openai.com'
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export const DEVICE_USER_URL = `${OPENAI_ISSUER}/codex/device`

export interface DeviceCodeResponse {
  user_code: string
  device_auth_id: string
  interval: number
  verification_uri: string
}

export interface DeviceTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  scope?: string
}

export interface PollResult {
  status: 'pending' | 'authorized' | 'expired' | 'error'
  tokens?: DeviceTokenResponse
  error?: string
}

const UA = 'customer-portal-giftbox/1.0'

/**
 * Step 1 — Request device code from OpenAI.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  })

  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after') || '60'
    throw new Error(
      `OpenAI rate-limited login (429). Retry after ${retryAfter}s.`
    )
  }

  if (!res.ok) {
    throw new Error(`Device code request failed: HTTP ${res.status}`)
  }

  const data = await res.json()
  const user_code = data.user_code
  const device_auth_id = data.device_auth_id
  const interval = Math.max(3, Number(data.interval) || 5)

  if (!user_code || !device_auth_id) {
    throw new Error('Device code response missing user_code or device_auth_id')
  }

  return {
    user_code,
    device_auth_id,
    interval,
    verification_uri: DEVICE_USER_URL,
  }
}

/**
 * Step 3 — Poll for user authorization (one attempt; caller retries).
 * Returns { status: 'pending' } if still waiting, or 'authorized' with tokens.
 */
export async function pollDeviceAuthorization(
  deviceAuthId: string,
  userCode: string
): Promise<{ status: 'pending' | 'authorized' | 'error'; authorization_code?: string; code_verifier?: string; error?: string }> {
  const res = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  })

  if (res.status === 200) {
    const data = await res.json()
    const authorization_code = data.authorization_code
    const code_verifier = data.code_verifier
    if (!authorization_code || !code_verifier) {
      return { status: 'error', error: 'Auth response missing authorization_code/code_verifier' }
    }
    return { status: 'authorized', authorization_code, code_verifier }
  }

  // 403 / 404 = user hasn't completed sign-in yet
  if (res.status === 403 || res.status === 404) {
    return { status: 'pending' }
  }

  return { status: 'error', error: `Polling returned HTTP ${res.status}` }
}

/**
 * Step 4 — Exchange authorization_code for tokens.
 */
export async function exchangeCodeForTokens(
  authorization_code: string,
  code_verifier: string
): Promise<DeviceTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorization_code,
    redirect_uri: `${OPENAI_ISSUER}/deviceauth/callback`,
    client_id: CODEX_CLIENT_ID,
    code_verifier,
  })

  const res = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: body.toString(),
  })

  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after') || '60'
    throw new Error(`OpenAI rate-limited token exchange (429). Retry after ${retryAfter}s.`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token exchange failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Token exchange did not return access_token')
  }
  return data as DeviceTokenResponse
}

/**
 * Refresh an expired access_token using refresh_token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<DeviceTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_CLIENT_ID,
  })

  const res = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Refresh failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Refresh did not return access_token')
  }
  return data as DeviceTokenResponse
}

/**
 * Compute expires_at from expires_in (seconds).
 */
export function computeExpiresAt(expiresInSeconds?: number): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null
  return new Date(Date.now() + expiresInSeconds * 1000)
}

/**
 * Check if a token is expiring soon (needs refresh).
 */
export function isExpiringSoon(expiresAt: Date | null, skewSeconds: number = 120): boolean {
  if (!expiresAt) return false
  return expiresAt.getTime() - Date.now() < skewSeconds * 1000
}
