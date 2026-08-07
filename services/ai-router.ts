/**
 * services/ai-router.ts — Unified AI call interface for all providers
 *
 * Currently supports: openai-codex (ChatGPT subscription via OAuth)
 * Roadmap: anthropic-api, openai-api, groq, openrouter, deepseek, ...
 *
 * Usage:
 *   const result = await runCompletion({
 *     provider: 'openai-codex',
 *     model: 'gpt-5.6-sol',
 *     systemPrompt: 'You are a landing page copywriter.',
 *     userPrompt: 'Generate HTML for a sales page...',
 *   })
 */

import { createClient } from '@supabase/supabase-js'
import { tryDecrypt } from './crypto'
import { CODEX_BASE_URL, refreshAccessToken, computeExpiresAt, isExpiringSoon, DeviceTokenResponse } from './oauth-openai'
import { encrypt } from './crypto'

export type ProviderId = 'openai-codex'  // Extend with more later

export interface CompletionInput {
  provider: ProviderId
  model?: string
  systemPrompt?: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
}

export interface CompletionResult {
  text: string
  model: string
  provider: ProviderId
  usage?: { input_tokens?: number; output_tokens?: number }
}

// ─── Credential loader (with lazy refresh) ────────────────────────────────────

interface LoadedCred {
  accessToken: string
  baseUrl: string
  provider: ProviderId
}

async function loadCred(provider: ProviderId): Promise<LoadedCred> {
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: cred } = await admin.from('provider_credentials')
    .select('*').eq('provider', provider).maybeSingle()

  if (!cred || cred.status !== 'active') {
    throw new Error(`Provider ${provider} not connected. Connect via Settings → AI Providers.`)
  }

  let accessToken = tryDecrypt(cred.access_token_encrypted) || ''
  if (!accessToken) {
    throw new Error(`Provider ${provider} access_token could not be decrypted (check PROVIDER_ENCRYPTION_KEY)`)
  }

  // Refresh if expiring
  const expiresAt = cred.expires_at ? new Date(cred.expires_at) : null
  if (isExpiringSoon(expiresAt) && cred.refresh_token_encrypted) {
    const refreshToken = tryDecrypt(cred.refresh_token_encrypted)
    if (refreshToken) {
      try {
        const newTokens = await refreshAccessToken(refreshToken)
        accessToken = newTokens.access_token
        const newExpiresAt = computeExpiresAt(newTokens.expires_in)

        await admin.from('provider_credentials').update({
          access_token_encrypted: encrypt(newTokens.access_token),
          refresh_token_encrypted: newTokens.refresh_token ? encrypt(newTokens.refresh_token) : cred.refresh_token_encrypted,
          expires_at: newExpiresAt?.toISOString() || null,
          last_refreshed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('provider', provider)
      } catch (e: any) {
        // Mark expired if refresh failed
        await admin.from('provider_credentials').update({ status: 'expired' }).eq('provider', provider)
        throw new Error(`Token refresh failed: ${e.message}. Reconnect ${provider}.`)
      }
    }
  }

  // Update last_used_at (fire-and-forget)
  admin.from('provider_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('provider', provider)
    .then(() => {}, () => {})

  return {
    accessToken,
    baseUrl: cred.base_url || CODEX_BASE_URL,
    provider,
  }
}

// ─── Provider: openai-codex ──────────────────────────────────────────────────

/**
 * Extract ChatGPT-Account-ID from OAuth JWT claims.
 * Required for Cloudflare mitigation on chatgpt.com/backend-api/codex.
 */
function extractAccountIdFromJwt(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length < 2) return null
    const b64 = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4)
    const claims = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    return claims['https://api.openai.com/auth']?.chatgpt_account_id || null
  } catch {
    return null
  }
}

/**
 * Build Codex-specific headers (Cloudflare mitigation from Hermes pattern).
 */
function codexHeaders(accessToken: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=v1',
    'User-Agent': 'codex_cli_rs/0.0.0 (customer-portal-giftbox)',
    'originator': 'codex_cli_rs',
  }
  const acctId = extractAccountIdFromJwt(accessToken)
  if (acctId) h['ChatGPT-Account-ID'] = acctId
  return h
}

/**
 * Read SSE stream from Codex /responses and accumulate output_text.
 * Codex Responses API contract: store=false AND stream=true (non-streaming not supported).
 * Events: response.output_text.delta contains { delta: '...' }
 *         response.completed contains { response: { usage, ... } }
 */
async function readCodexStream(response: Response): Promise<{ text: string; usage?: any }> {
  if (!response.body) throw new Error('Codex response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  let text = ''
  let usage: any = undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // Split by double-newline (SSE event boundary)
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      // Each event has "event: X\ndata: {...}" lines
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data: ')) dataLines.push(line.slice(6))
      }
      if (!dataLines.length) continue
      const dataStr = dataLines.join('\n')
      if (dataStr === '[DONE]') continue
      try {
        const evt = JSON.parse(dataStr)
        const type = evt.type || ''
        if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
          text += evt.delta
        } else if (type === 'response.completed' && evt.response) {
          if (evt.response.usage) usage = evt.response.usage
          // Fallback: if we didn't get deltas, extract from output
          if (!text && Array.isArray(evt.response.output)) {
            for (const item of evt.response.output) {
              if (item.type === 'message' && Array.isArray(item.content)) {
                for (const c of item.content) {
                  if (c.type === 'output_text' && c.text) text += c.text
                }
              }
            }
          }
        }
      } catch {
        // Skip malformed event
      }
    }
  }
  return { text, usage }
}

async function callOpenAICodex(input: CompletionInput, cred: LoadedCred): Promise<CompletionResult> {
  const model = input.model || 'gpt-5.6-sol'

  // Codex Responses API contract (from Hermes reference):
  //   instructions: system prompt
  //   input: [{ role, content: [{type: 'input_text', text: '...'}] }]
  //   store: false (required)
  //   stream: true (required — Codex doesn't support non-streaming)
  const body: any = {
    model,
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: input.userPrompt }],
    }],
    max_output_tokens: input.maxTokens || 4096,
    store: false,
    stream: true,
  }
  if (input.systemPrompt) body.instructions = input.systemPrompt
  if (typeof input.temperature === 'number') body.temperature = input.temperature

  const res = await fetch(`${cred.baseUrl}/responses`, {
    method: 'POST',
    headers: { ...codexHeaders(cred.accessToken), 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Codex API failed: HTTP ${res.status} ${errText.slice(0, 300)}`)
  }

  const { text, usage } = await readCodexStream(res)

  return {
    text,
    model,
    provider: 'openai-codex',
    usage: usage ? {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    } : undefined,
  }
}

// ─── Provider: list models ───────────────────────────────────────────────────

export async function listModels(provider: ProviderId): Promise<string[]> {
  const cred = await loadCred(provider)

  if (provider === 'openai-codex') {
    // Codex /models endpoint returns available models for this account
    try {
      const res = await fetch(`${cred.baseUrl}/models?client_version=0.0.0`, {
        headers: codexHeaders(cred.accessToken),
      })
      if (!res.ok) {
        // Fallback to known default list
        return ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.1', 'gpt-4o', 'o1']
      }
      const data = await res.json()
      const ids = (data.data || []).map((m: any) => m.id).filter(Boolean)
      return ids.length > 0 ? ids : ['gpt-5.6-sol']
    } catch {
      return ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.1', 'gpt-4o']
    }
  }

  throw new Error(`Unknown provider: ${provider}`)
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function runCompletion(input: CompletionInput): Promise<CompletionResult> {
  const cred = await loadCred(input.provider)

  if (input.provider === 'openai-codex') {
    return callOpenAICodex(input, cred)
  }

  throw new Error(`Unsupported provider: ${input.provider}`)
}
