// components/admin/ProviderPicker.tsx
// Reusable "Gửi qua / Dùng AI provider nào" dropdown for any per-operation flow.
// Fetches /api/ai-providers?action=usable — returns CONNECTED providers only,
// sorted default → openai-codex → most-recently used. Includes OAuth (Codex) which
// is hidden from the main AIProvidersView list.
//
// Usage:
//   const [providerId, setProviderId] = useState<string | undefined>()
//   const [model, setModel] = useState<string | undefined>()
//   <ProviderPicker value={providerId} onChange={setProviderId} model={model} onModelChange={setModel} />
//
// value === undefined → shows "(mặc định — auto chọn)" — caller passes undefined to
// runCompletion so the backend fallback chain kicks in.

import React, { useEffect, useState } from 'react'
import { supabase } from '../../services/supabase'
import { Sparkles, Loader2, RefreshCw } from 'lucide-react'

// Cross-instance in-memory cache: fetching /list-models is 1-2s per call, and multiple
// ProviderPicker instances (Distill + Auto-reply + Funnel step) end up asking for the
// same provider back-to-back. Cache lives for the tab session — cleared on hard reload.
const modelsCache = new Map<string, { models: string[]; ts: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000   // 5 min — fresh enough for user perception

export interface UsableProvider {
  id: string
  label: string
  auth_type: string   // 'oauth-device' | 'oauth_device_code' | 'api-key' — accept both variants
  default_model: string
  suggested_models: string[]
  is_default: boolean
  account_email?: string
  last_used_at?: string
}

interface Props {
  value: string | undefined                // provider id; undefined = auto (backend default chain)
  onChange: (id: string | undefined) => void
  model?: string
  onModelChange?: (m: string) => void
  showModelPicker?: boolean                // hide when caller doesn't care (default: true)
  compact?: boolean                        // smaller styling for embedded uses
  label?: string                           // dropdown label (default: "AI provider")
}

async function api<T = any>(path: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    headers: { ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export function ProviderPicker({
  value, onChange, model, onModelChange,
  showModelPicker = true, compact = false, label = 'AI provider',
}: Props) {
  const [providers, setProviders] = useState<UsableProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    api<{ providers: UsableProvider[] }>('/api/ai-providers?action=usable')
      .then(r => setProviders(r.providers || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const selected = value ? providers.find(p => p.id === value) : undefined

  // Live models — fetched from the provider's own /models endpoint on demand.
  // Falls back to registry suggested_models on error. In-memory cache dedupes
  // concurrent instances of ProviderPicker.
  const [liveModels, setLiveModels] = useState<string[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)

  const fetchModels = React.useCallback(async (pid: string, force = false) => {
    // Cache check
    const cached = modelsCache.get(pid)
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setLiveModels(cached.models)
      setFetchedAt(new Date(cached.ts))
      return
    }
    setModelsLoading(true); setModelsError(null)
    try {
      const r = await fetch(`/api/ai-providers?action=list-models&id=${encodeURIComponent(pid)}`, {
        method: 'POST', body: '{}',
        headers: {
          'Content-Type': 'application/json',
          ...(await (async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session ? { Authorization: `Bearer ${session.access_token}` } : {}
          })()),
        },
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !Array.isArray(data.models)) {
        throw new Error(data.error || `HTTP ${r.status}`)
      }
      modelsCache.set(pid, { models: data.models, ts: Date.now() })
      setLiveModels(data.models)
      setFetchedAt(new Date())
    } catch (e: any) {
      setModelsError(e.message || 'Không lấy được list models')
      setLiveModels(null)   // fall back to suggested_models via modelOptions below
    } finally {
      setModelsLoading(false)
    }
  }, [])

  // Auto-fetch when a real provider is selected (skip when value=undefined = auto)
  useEffect(() => {
    if (!selected) { setLiveModels(null); setFetchedAt(null); setModelsError(null); return }
    fetchModels(selected.id).catch(() => {})
  }, [selected?.id, fetchModels])

  const modelOptions = liveModels ?? selected?.suggested_models ?? []

  const size = compact ? 'text-xs py-1 px-2' : 'text-sm py-1.5 px-2.5'

  return (
    <div className="space-y-1.5">
      <label className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-neutral-500 uppercase tracking-wider block flex items-center gap-1.5`}>
        <Sparkles className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} /> {label}
      </label>
      {loading ? (
        <div className="text-xs text-neutral-500 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Đang tải providers...
        </div>
      ) : error ? (
        <div className="text-xs text-red-400">Lỗi tải providers: {error}</div>
      ) : providers.length === 0 ? (
        <div className="text-xs text-amber-400">
          Chưa kết nối provider nào. Vào <a href="/admin/settings#ai" className="underline">Cài đặt → AI Providers</a> hoặc connect ChatGPT OAuth.
        </div>
      ) : (
        <div className={`flex ${compact ? 'flex-col gap-1.5' : 'gap-2'} ${showModelPicker ? '' : 'w-full'}`}>
          <select
            value={value ?? ''}
            onChange={e => {
              const v = e.target.value || undefined
              onChange(v)
              // Reset model when provider changes — new set of models
              if (onModelChange && v !== value) {
                const p = providers.find(pp => pp.id === v)
                onModelChange(p?.default_model || '')
              }
            }}
            className={`${size} bg-neutral-900 border border-neutral-800 rounded text-white flex-1 min-w-0`}
          >
            <option value="">⭐ Mặc định (auto)</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.is_default ? ' · ⭐ default' : ''}
                {/oauth/i.test(p.auth_type) ? ' · OAuth' : ''}
              </option>
            ))}
          </select>
          {showModelPicker && selected && onModelChange && (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <select
                value={model || selected.default_model}
                onChange={e => onModelChange(e.target.value)}
                disabled={modelsLoading}
                className={`${size} bg-neutral-900 border border-neutral-800 rounded text-white flex-1 min-w-0`}
                title={liveModels
                  ? `Live: ${liveModels.length} models từ provider (fetched ${fetchedAt?.toLocaleTimeString('vi-VN') || ''})`
                  : 'Suggested list (chưa fetch từ provider)'}
              >
                {modelsLoading && modelOptions.length === 0 && <option>Đang tải models...</option>}
                {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                {model && !modelOptions.includes(model) && (
                  <option value={model}>{model} (custom)</option>
                )}
              </select>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); if (selected) fetchModels(selected.id, true) }}
                disabled={modelsLoading}
                className={`${compact ? 'p-1' : 'p-1.5'} rounded border border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600 disabled:opacity-40`}
                title={liveModels ? `Refresh (fetched ${fetchedAt?.toLocaleTimeString('vi-VN') || ''})` : 'Fetch live list from provider'}
              >
                {modelsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      )}
      {value === undefined && providers.length > 0 && (
        <p className="text-[10px] text-neutral-600">
          Auto: dùng {providers.find(p => p.is_default)?.label || providers[0]?.label} (default trong Cài đặt → AI Providers).
        </p>
      )}
      {selected && (
        <p className="text-[10px] flex items-center gap-1.5">
          {modelsLoading ? (
            <span className="text-neutral-500 flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> Fetching models từ {selected.label}…</span>
          ) : liveModels ? (
            <span className="text-green-500">✓ {liveModels.length} models live từ {selected.label}{fetchedAt ? ` · ${Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 1000))}s trước` : ''}</span>
          ) : modelsError ? (
            <span className="text-amber-500" title={modelsError}>⚠ Dùng suggested list ({modelOptions.length}) — provider không trả /models: {modelsError.slice(0, 60)}</span>
          ) : (
            <span className="text-neutral-600">📋 {modelOptions.length} suggested models</span>
          )}
        </p>
      )}
    </div>
  )
}
