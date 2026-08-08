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
import { Sparkles, Loader2 } from 'lucide-react'

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
  const modelOptions = selected?.suggested_models || []

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
          {showModelPicker && selected && modelOptions.length > 0 && onModelChange && (
            <select
              value={model || selected.default_model}
              onChange={e => onModelChange(e.target.value)}
              className={`${size} bg-neutral-900 border border-neutral-800 rounded text-white`}
              title="Model để dùng cho provider này"
            >
              {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
              {model && !modelOptions.includes(model) && (
                <option value={model}>{model} (custom)</option>
              )}
            </select>
          )}
        </div>
      )}
      {value === undefined && providers.length > 0 && (
        <p className="text-[10px] text-neutral-600">
          Auto: dùng {providers.find(p => p.is_default)?.label || providers[0]?.label} (default trong Cài đặt → AI Providers).
        </p>
      )}
    </div>
  )
}
