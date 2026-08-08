/**
 * services/ai-router.ts — Unified AI call interface for all providers.
 *
 * Two code paths:
 *   - openai-codex: OAuth device flow + Codex-specific /responses + Cloudflare-mitigation headers.
 *   - Everything else: generic OpenAI-compat /chat/completions with SSE streaming.
 *
 * All provider configs (base_url, default model, quirks) live in ai-providers.ts.
 * Credentials live in provider_credentials table (api_key or oauth tokens, encrypted).
 *
 * Usage:
 *   const result = await runCompletion({
 *     provider: 'groq',                              // any id from ai-providers.ts
 *     model: 'llama-3.3-70b-versatile',             // optional; defaults to provider's default_model
 *     systemPrompt: 'You are a landing page copywriter.',
 *     userPrompt: 'Generate HTML for a sales page...',
 *   })
 *
 *   // Or omit provider entirely — resolves to the row with is_default=TRUE:
 *   const result = await runCompletion({ userPrompt: '...' })
 */

import { createClient } from '@supabase/supabase-js'
import { tryDecrypt, encrypt } from './crypto'
import { refreshAccessToken, computeExpiresAt, isExpiringSoon } from './oauth-openai'
import { AI_PROVIDERS, getProviderConfig, type ProviderConfig } from './ai-providers'

export type ProviderId = string   // Now open-ended — validated via AI_PROVIDERS at runtime

export interface CompletionInput {
  provider?: ProviderId          // If omitted, resolves to is_default credential
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

// ─── Credential loader (OAuth refresh + api-key passthrough) ──────────────────

interface LoadedCred {
  providerId: string
  config: ProviderConfig
  authValue: string              // Access token (OAuth) or API key (rest)
  effectiveBaseUrl: string       // credential.base_url override wins over provider default
  defaultModel: string           // credential.default_model override wins over provider default
}

function admin() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function loadCred(providerId?: string): Promise<LoadedCred> {
  const db = admin()

  const q = db.from('provider_credentials').select('*')
  const { data: cred } = providerId
    ? await q.eq('provider', providerId).maybeSingle()
    : await q.eq('is_default', true).maybeSingle()

  if (!cred) {
    if (providerId) throw new Error(`Provider ${providerId} not connected. Connect via Settings → AI Providers.`)
    throw new Error(`No default AI provider set. Choose one in Settings → AI Providers.`)
  }
  if (cred.status !== 'active' && cred.status !== 'expiring') {
    throw new Error(`Provider ${cred.provider} status=${cred.status}. Reconnect via Settings → AI Providers.`)
  }

  const config = getProviderConfig(cred.provider)

  // Auth value: api_key or access_token
  let authValue = ''
  if (config.auth_type === 'api-key') {
    authValue = tryDecrypt(cred.api_key_encrypted || '') || ''
    if (!authValue) throw new Error(`Provider ${cred.provider}: API key not set or could not decrypt (check PROVIDER_ENCRYPTION_KEY).`)
  } else {
    // oauth-device
    authValue = tryDecrypt(cred.access_token_encrypted || '') || ''
    if (!authValue) throw new Error(`Provider ${cred.provider}: access token could not decrypt.`)

    const expiresAt = cred.expires_at ? new Date(cred.expires_at) : null
    if (isExpiringSoon(expiresAt) && cred.refresh_token_encrypted) {
      const refreshToken = tryDecrypt(cred.refresh_token_encrypted)
      if (refreshToken) {
        try {
          const newTokens = await refreshAccessToken(refreshToken)
          authValue = newTokens.access_token
          await db.from('provider_credentials').update({
            access_token_encrypted: encrypt(newTokens.access_token),
            refresh_token_encrypted: newTokens.refresh_token ? encrypt(newTokens.refresh_token) : cred.refresh_token_encrypted,
            expires_at: computeExpiresAt(newTokens.expires_in)?.toISOString() || null,
            last_refreshed_at: new Date().toISOString(),
          }).eq('provider', cred.provider)
        } catch (e: any) {
          await db.from('provider_credentials').update({ status: 'expired' }).eq('provider', cred.provider)
          throw new Error(`Token refresh failed for ${cred.provider}: ${e.message}. Reconnect.`)
        }
      }
    }
  }

  // Fire-and-forget last_used update
  db.from('provider_credentials').update({ last_used_at: new Date().toISOString() }).eq('provider', cred.provider).then(() => {}, () => {})

  return {
    providerId: cred.provider,
    config,
    authValue,
    effectiveBaseUrl: cred.base_url || config.base_url,
    defaultModel: cred.default_model || config.default_model,
  }
}

// ─── openai-codex adapter (unchanged from prior implementation) ───────────────

function extractAccountIdFromJwt(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length < 2) return null
    const b64 = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4)
    const claims = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    return claims['https://api.openai.com/auth']?.chatgpt_account_id || null
  } catch { return null }
}

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

async function readCodexStream(response: Response): Promise<{ text: string; usage?: any }> {
  if (!response.body) throw new Error('Codex response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = '', text = ''
  let usage: any
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) if (line.startsWith('data: ')) dataLines.push(line.slice(6))
      if (!dataLines.length) continue
      const dataStr = dataLines.join('\n')
      if (dataStr === '[DONE]') continue
      try {
        const evt = JSON.parse(dataStr)
        if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') text += evt.delta
        else if (evt.type === 'response.completed' && evt.response) {
          if (evt.response.usage) usage = evt.response.usage
          if (!text && Array.isArray(evt.response.output)) {
            for (const item of evt.response.output) {
              if (item.type === 'message' && Array.isArray(item.content)) {
                for (const c of item.content) if (c.type === 'output_text' && c.text) text += c.text
              }
            }
          }
        }
      } catch { /* skip malformed */ }
    }
  }
  return { text, usage }
}

async function callOpenAICodex(input: CompletionInput, cred: LoadedCred): Promise<CompletionResult> {
  const model = input.model || cred.defaultModel
  const body: any = {
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: input.userPrompt }] }],
    store: false, stream: true,
  }
  if (input.systemPrompt) body.instructions = input.systemPrompt

  const res = await fetch(`${cred.effectiveBaseUrl}/responses`, {
    method: 'POST',
    headers: { ...codexHeaders(cred.authValue), 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Codex API failed: HTTP ${res.status} ${errText.slice(0, 300)}`)
  }
  const { text, usage } = await readCodexStream(res)
  return {
    text, model, provider: 'openai-codex',
    usage: usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : undefined,
  }
}

// ─── Generic OpenAI-compat adapter (Groq / OpenRouter / Kimi / Qwen / DeepSeek / Gemini) ──

/**
 * Read /chat/completions SSE stream, accumulate deltas.
 * Handles OpenAI-format events: {choices:[{delta:{content:'...'}}]}
 * DeepSeek reasoner variant: also has {choices:[{delta:{reasoning_content:'...'}}]} which
 * we skip when quirks.strip_reasoning is true.
 */
async function readOpenAICompatStream(response: Response, stripReasoning: boolean): Promise<{ text: string; usage?: any; model?: string }> {
  if (!response.body) throw new Error('response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = '', text = '', model: string | undefined
  let usage: any
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        const s = line.trimStart()
        if (s.startsWith('data: ')) dataLines.push(s.slice(6))
      }
      if (!dataLines.length) continue
      const dataStr = dataLines.join('\n').trim()
      if (dataStr === '[DONE]') continue
      try {
        const evt = JSON.parse(dataStr)
        if (evt.model && !model) model = evt.model
        const delta = evt.choices?.[0]?.delta
        if (delta) {
          if (typeof delta.content === 'string') text += delta.content
          if (!stripReasoning && typeof delta.reasoning_content === 'string') text += delta.reasoning_content
        }
        // Some providers put usage in the final event
        if (evt.usage) usage = evt.usage
      } catch { /* skip malformed chunks (Groq sometimes sends comment lines) */ }
    }
  }
  return { text, usage, model }
}

async function callOpenAICompat(input: CompletionInput, cred: LoadedCred): Promise<CompletionResult> {
  const model = input.model || cred.defaultModel
  const messages: any[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  messages.push({ role: 'user', content: input.userPrompt })

  const body: any = {
    model,
    messages,
    stream: true,
  }
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens

  // Anthropic quirk: needs x-api-key header instead of Bearer
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  }
  if (cred.providerId === 'anthropic') {
    headers['x-api-key'] = cred.authValue
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${cred.authValue}`
  }
  // OpenRouter recommends these for analytics + rate limits
  if (cred.providerId === 'openrouter') {
    headers['HTTP-Referer'] = process.env.CUSTOMER_PORTAL_URL || 'https://portal.local'
    headers['X-Title'] = 'AgentCRM Giftbox'
  }

  const res = await fetch(`${cred.effectiveBaseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${cred.providerId} API failed: HTTP ${res.status} ${errText.slice(0, 400)}`)
  }
  const { text, usage, model: reportedModel } = await readOpenAICompatStream(res, !!cred.config.quirks?.strip_reasoning)
  return {
    text,
    model: reportedModel || model,
    provider: cred.providerId,
    usage: usage ? {
      input_tokens: usage.prompt_tokens ?? usage.input_tokens,
      output_tokens: usage.completion_tokens ?? usage.output_tokens,
    } : undefined,
  }
}

// ─── list models ─────────────────────────────────────────────────────────────

export async function listModels(providerId: string): Promise<string[]> {
  const cred = await loadCred(providerId)

  if (cred.providerId === 'openai-codex') {
    try {
      const res = await fetch(`${cred.effectiveBaseUrl}/models?client_version=0.0.0`, { headers: codexHeaders(cred.authValue) })
      if (!res.ok) return cred.config.suggested_models
      const data = await res.json()
      const ids = (data.data || []).map((m: any) => m.id).filter(Boolean)
      return ids.length > 0 ? ids : cred.config.suggested_models
    } catch { return cred.config.suggested_models }
  }

  // Generic /models endpoint
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cred.providerId === 'anthropic') { headers['x-api-key'] = cred.authValue; headers['anthropic-version'] = '2023-06-01' }
    else headers['Authorization'] = `Bearer ${cred.authValue}`
    const res = await fetch(`${cred.effectiveBaseUrl}/models`, { headers })
    if (!res.ok) return cred.config.suggested_models
    const data = await res.json()
    const ids = (data.data || data.models || []).map((m: any) => m.id || m.name).filter(Boolean)
    return ids.length > 0 ? ids : cred.config.suggested_models
  } catch { return cred.config.suggested_models }
}

// ─── Test connection (used by Settings "Test" button) ─────────────────────────

export async function testConnection(providerId: string): Promise<{ ok: boolean; error?: string; model?: string; latency_ms?: number }> {
  const start = Date.now()
  try {
    const r = await runCompletion({
      provider: providerId,
      systemPrompt: 'Reply with exactly the word "OK" in uppercase, nothing else.',
      userPrompt: 'Test.',
      maxTokens: 5,
      temperature: 0,
    })
    return { ok: true, model: r.model, latency_ms: Date.now() - start }
  } catch (e: any) {
    return { ok: false, error: e.message, latency_ms: Date.now() - start }
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function runCompletion(input: CompletionInput): Promise<CompletionResult> {
  const cred = await loadCred(input.provider)
  if (cred.providerId === 'openai-codex') return callOpenAICodex(input, cred)
  return callOpenAICompat(input, cred)
}
