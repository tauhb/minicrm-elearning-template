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

async function callOpenAICodex(input: CompletionInput, cred: LoadedCred): Promise<CompletionResult> {
  const model = input.model || 'gpt-5.6-sol'

  const messages = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  messages.push({ role: 'user', content: input.userPrompt })

  // Codex uses /responses endpoint (Responses API)
  const res = await fetch(`${cred.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cred.accessToken}`,
      'OpenAI-Beta': 'responses=v1',
    },
    body: JSON.stringify({
      model,
      input: messages,
      max_output_tokens: input.maxTokens || 4096,
      temperature: input.temperature ?? 0.7,
      stream: false,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Codex API failed: HTTP ${res.status} ${text.slice(0, 300)}`)
  }

  const data = await res.json()

  // Extract text from Responses API format
  let text = ''
  if (data.output_text) {
    text = data.output_text
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && c.text) text += c.text
        }
      }
    }
  }

  return {
    text,
    model,
    provider: 'openai-codex',
    usage: data.usage ? {
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
    } : undefined,
  }
}

// ─── Provider: list models ───────────────────────────────────────────────────

export async function listModels(provider: ProviderId): Promise<string[]> {
  const cred = await loadCred(provider)

  if (provider === 'openai-codex') {
    // Codex /models endpoint returns available models for this account
    try {
      const res = await fetch(`${cred.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${cred.accessToken}`,
          'OpenAI-Beta': 'responses=v1',
        },
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
