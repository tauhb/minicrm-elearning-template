// components/admin/AIProvidersView.tsx — Sprint A
// Self-serve UI: connect multiple AI providers, test, pin models, set portal default.
// Rendered inside Settings > AI tab (alongside the existing OAuth Codex flow).

import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import {
  Check, X, Zap, Loader2, KeyRound, ExternalLink, Trash2, Star, Play,
  ChevronRight,
} from 'lucide-react'

interface Provider {
  id: string; label: string; auth_type: 'oauth-device' | 'api-key'
  docs_url: string; base_url: string
  default_model: string; suggested_models: string[]
  supports_streaming: boolean; supports_embeddings: boolean
  connected: boolean; status: string; is_default: boolean
  account_email?: string
  connected_at?: string; last_used_at?: string
}

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export default function AIProvidersView() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api<{ providers: Provider[] }>('/api/ai-providers')
      setProviders(r.providers)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const connect = async (providerId: string, apiKey: string, defaultModel?: string) => {
    setConnectingId(providerId)
    try {
      await api('/api/ai-providers?action=connect', {
        method: 'POST',
        body: JSON.stringify({ provider: providerId, api_key: apiKey, default_model: defaultModel || null }),
      })
      await load()
    } catch (e: any) { alert(`Kết nối thất bại: ${e.message}`) }
    finally { setConnectingId(null) }
  }

  const test = async (providerId: string) => {
    setTestingId(providerId)
    try {
      const r = await api<{ ok: boolean; error?: string; model?: string; latency_ms?: number }>(
        `/api/ai-providers?action=test&id=${encodeURIComponent(providerId)}`,
        { method: 'POST', body: '{}' }
      )
      alert(r.ok
        ? `✓ ${providerId}: OK (${r.model}, ${r.latency_ms}ms)`
        : `✗ ${providerId}: ${r.error}`)
    } catch (e: any) { alert(`Test fail: ${e.message}`) }
    finally { setTestingId(null) }
  }

  const setDefault = async (providerId: string) => {
    try {
      await api(`/api/ai-providers?action=set-default&id=${encodeURIComponent(providerId)}`, { method: 'POST', body: '{}' })
      await load()
    } catch (e: any) { alert(e.message) }
  }

  const pinModel = async (providerId: string, model: string) => {
    try {
      await api(`/api/ai-providers?action=pin-model&id=${encodeURIComponent(providerId)}`, {
        method: 'POST', body: JSON.stringify({ model }),
      })
      await load()
    } catch (e: any) { alert(e.message) }
  }

  const disconnect = async (providerId: string) => {
    if (!confirm(`Ngắt kết nối ${providerId}? API key sẽ bị xoá.`)) return
    try {
      await api(`/api/ai-providers?id=${encodeURIComponent(providerId)}`, { method: 'DELETE' })
      await load()
    } catch (e: any) { alert(e.message) }
  }

  if (loading) return <div className="p-8 text-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">AI Providers</h3>
        <p className="text-xs text-gray-500 mb-4">
          Kết nối nhiều nhà cung cấp AI. Chọn 1 làm mặc định (dùng cho funnel/content khi không chỉ định provider cụ thể).
          <br />
          <strong className="text-gray-400">Bảo mật:</strong> API key được mã hoá AES-256-GCM trước khi lưu, không log ra bất kỳ đâu.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {providers.map(p => (
          <div key={p.id} className="border border-gray-800 rounded-lg overflow-hidden">
            {/* Row header */}
            <div className={`flex items-center gap-3 px-4 py-3 ${p.connected ? 'bg-gray-900' : 'bg-gray-950'}`}>
              <button
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="text-gray-500 hover:text-white transition"
              >
                <ChevronRight className={`w-4 h-4 transition-transform ${expanded === p.id ? 'rotate-90' : ''}`} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{p.label}</span>
                  <code className="text-[10px] text-gray-600 font-mono">{p.id}</code>
                  {p.is_default && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 flex items-center gap-1">
                      <Star className="w-2.5 h-2.5" /> Mặc định
                    </span>
                  )}
                  {p.auth_type === 'oauth-device' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      OAuth
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-3">
                  <span>{p.default_model}</span>
                  {p.supports_embeddings && <span className="text-purple-400">embed</span>}
                  {p.connected && p.last_used_at && (
                    <span>dùng lần cuối: {new Date(p.last_used_at).toLocaleString('vi-VN')}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {p.connected ? (
                  <>
                    <button
                      onClick={() => test(p.id)}
                      disabled={testingId === p.id}
                      className="p-1.5 text-gray-500 hover:text-green-400 hover:bg-gray-800 rounded transition disabled:opacity-40"
                      title="Test connection"
                    >
                      {testingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    {!p.is_default && (
                      <button
                        onClick={() => setDefault(p.id)}
                        className="p-1.5 text-gray-500 hover:text-yellow-400 hover:bg-gray-800 rounded transition"
                        title="Đặt làm mặc định"
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => disconnect(p.id)}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition"
                      title="Ngắt kết nối"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/30 flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Đã kết nối
                    </span>
                  </>
                ) : (
                  <a
                    href={p.docs_url} target="_blank" rel="noreferrer"
                    className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition flex items-center gap-1"
                  >
                    <ExternalLink className="w-2.5 h-2.5" /> Lấy API key
                  </a>
                )}
              </div>
            </div>

            {/* Expanded body */}
            {expanded === p.id && (
              <div className="px-4 py-3 border-t border-gray-800 bg-gray-950 space-y-3">
                {p.auth_type === 'oauth-device' ? (
                  <div className="text-xs text-gray-400">
                    Provider này dùng OAuth device flow (đăng nhập bằng tài khoản ChatGPT). Vào tab <strong>OAuth</strong> ở trên để kết nối.
                  </div>
                ) : !p.connected ? (
                  <ConnectForm
                    provider={p}
                    submitting={connectingId === p.id}
                    onSubmit={(apiKey, model) => connect(p.id, apiKey, model)}
                  />
                ) : (
                  <ModelPicker
                    provider={p}
                    onPin={(m) => pinModel(p.id, m)}
                  />
                )}
                <div className="text-[10px] text-gray-600 flex items-center justify-between pt-2 border-t border-gray-800/50">
                  <span>base_url: <code className="text-gray-500">{p.base_url}</code></span>
                  {p.connected_at && <span>Kết nối: {new Date(p.connected_at).toLocaleDateString('vi-VN')}</span>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Connect form: paste API key + optional model default ─────────────────────

function ConnectForm({ provider, submitting, onSubmit }: {
  provider: Provider
  submitting: boolean
  onSubmit: (apiKey: string, model?: string) => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(provider.default_model)

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] text-gray-400 block mb-1 flex items-center gap-1">
          <KeyRound className="w-3 h-3" /> API key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs font-mono text-white"
        />
      </div>
      <div>
        <label className="text-[11px] text-gray-400 block mb-1">Model mặc định (có thể đổi sau)</label>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white"
        >
          {provider.suggested_models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <button
        onClick={() => onSubmit(apiKey, model)}
        disabled={!apiKey.trim() || submitting}
        style={{ background: 'var(--color-mission-accent)', color: '#000' }}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded hover:opacity-90 disabled:opacity-40"
      >
        {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        Kết nối
      </button>
    </div>
  )
}

// ─── Model picker for connected providers ─────────────────────────────────────

function ModelPicker({ provider, onPin }: { provider: Provider; onPin: (model: string) => void }) {
  const [selected, setSelected] = useState(provider.default_model)
  return (
    <div className="space-y-2">
      <label className="text-[11px] text-gray-400 block">Model mặc định (khi funnel/step không chỉ định)</label>
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white"
        >
          {provider.suggested_models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          onClick={() => onPin(selected)}
          disabled={selected === provider.default_model}
          className="px-3 py-1.5 text-xs border border-gray-700 rounded hover:bg-gray-800 disabled:opacity-40"
        >
          Ghi
        </button>
      </div>
    </div>
  )
}
