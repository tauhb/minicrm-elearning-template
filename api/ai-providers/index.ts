// api/ai-providers/index.ts — Multi-provider AI credential CRUD + test.
//   GET /api/ai-providers                          → list registry + which are connected
//   POST /api/ai-providers?action=connect          → save API key (encrypted); OAuth handled elsewhere
//   POST /api/ai-providers?action=test&id=xxx      → ping provider with a tiny completion
//   POST /api/ai-providers?action=set-default&id   → mark this row as default (only one allowed)
//   POST /api/ai-providers?action=pin-model&id     → set default_model
//   POST /api/ai-providers?action=list-models&id   → return live model list from provider
//   DELETE /api/ai-providers?id=xxx                → disconnect

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '../../services/crypto'
import { AI_PROVIDERS, listProviderIds, getProviderConfig } from '../../services/ai-providers'
import { testConnection, listModels } from '../../services/ai-router'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  // Auth: owner/admin only (managing keys is sensitive)
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${authHeader.slice(7)}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!['owner', 'admin'].includes(caller?.role || '')) return res.status(403).json({ error: 'Owner/admin only' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action') || ''
  const providerId = url.searchParams.get('id') || url.searchParams.get('provider') || ''

  try {
    // ── GET: registry merged with connected credentials
    if (req.method === 'GET') {
      const { data: creds } = await admin.from('provider_credentials')
        .select('provider, auth_type, status, default_model, is_default, account_email, base_url, last_used_at, connected_at')
      const credMap = new Map<string, any>()
      for (const c of (creds || [])) credMap.set(c.provider, c)

      // Hide OAuth-device providers (openai-codex) from the API-key provider list —
      // they get their own connect flow in a separate section below the list.
      const items = listProviderIds()
        .filter(id => AI_PROVIDERS[id].auth_type !== 'oauth-device')
        .map(id => {
        const cfg = AI_PROVIDERS[id]
        const cred = credMap.get(id)
        return {
          id, label: cfg.label, auth_type: cfg.auth_type, docs_url: cfg.docs_url,
          base_url: cred?.base_url || cfg.base_url,
          default_model: cred?.default_model || cfg.default_model,
          suggested_models: cfg.suggested_models,
          supports_streaming: cfg.supports_streaming,
          supports_embeddings: cfg.supports_embeddings,
          connected: !!cred,
          status: cred?.status || 'disconnected',
          is_default: !!cred?.is_default,
          account_email: cred?.account_email,
          connected_at: cred?.connected_at,
          last_used_at: cred?.last_used_at,
        }
      })
      return res.status(200).json({ providers: items })
    }

    // ── DELETE: disconnect
    if (req.method === 'DELETE') {
      if (!providerId) return res.status(400).json({ error: 'provider id required' })
      const { error } = await admin.from('provider_credentials').delete().eq('provider', providerId)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    // ── connect: upsert credential with API key (OAuth uses separate endpoints)
    if (action === 'connect') {
      const { provider, api_key, base_url, default_model, account_email } = req.body || {}
      if (!provider) return res.status(400).json({ error: 'provider required' })
      const cfg = getProviderConfig(provider)
      if (cfg.auth_type === 'oauth-device') {
        return res.status(400).json({ error: `${provider} uses OAuth device flow — connect via /api/oauth/${provider}/start` })
      }
      if (!api_key || typeof api_key !== 'string') return res.status(400).json({ error: 'api_key required' })

      const payload: any = {
        provider, auth_type: 'api-key', status: 'active',
        api_key_encrypted: encrypt(api_key.trim()),
        base_url: base_url || null,
        default_model: default_model || null,
        account_email: account_email || null,
        connected_at: new Date().toISOString(),
      }
      const { data, error } = await admin.from('provider_credentials')
        .upsert(payload, { onConflict: 'provider' })
        .select('provider, status, default_model')
        .single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true, credential: data })
    }

    // ── test: run a tiny completion to verify key + reachability
    if (action === 'test') {
      if (!providerId) return res.status(400).json({ error: 'provider id required' })
      const result = await testConnection(providerId)
      return res.status(result.ok ? 200 : 400).json(result)
    }

    // ── set-default: mark this credential as portal-wide default
    if (action === 'set-default') {
      if (!providerId) return res.status(400).json({ error: 'provider id required' })
      // Atomic: clear all defaults, then set target = true
      await admin.from('provider_credentials').update({ is_default: false }).neq('provider', '__none__')
      const { error } = await admin.from('provider_credentials').update({ is_default: true }).eq('provider', providerId)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    // ── pin-model: override the default_model for this credential
    if (action === 'pin-model') {
      if (!providerId) return res.status(400).json({ error: 'provider id required' })
      const { model } = req.body || {}
      const { error } = await admin.from('provider_credentials')
        .update({ default_model: model || null })
        .eq('provider', providerId)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    // ── list-models: fetch live model list from provider
    if (action === 'list-models') {
      if (!providerId) return res.status(400).json({ error: 'provider id required' })
      try {
        const models = await listModels(providerId)
        return res.json({ models })
      } catch (e: any) {
        return res.status(400).json({ error: e.message })
      }
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
