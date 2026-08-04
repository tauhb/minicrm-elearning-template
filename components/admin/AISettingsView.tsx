import React, { useEffect, useState, useCallback } from 'react'
import { Sparkles, Check, X, Loader2, ExternalLink, Copy, Zap, AlertTriangle, LogOut, RefreshCw } from 'lucide-react'
import { supabase } from '../../services/supabase'

interface OAuthStatus {
  connected: boolean
  provider?: string
  auth_type?: string
  display_name?: string
  status?: string
  base_url?: string
  account_email?: string
  connected_at?: string
  expires_at?: string | null
  expired?: boolean
}

interface DeviceSession {
  session_id: string
  user_code: string
  verification_uri: string
  poll_interval: number
  expires_at: string
}

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

async function apiCall<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export default function AISettingsView() {
  const [status, setStatus] = useState<OAuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [session, setSession] = useState<DeviceSession | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const s = await apiCall<OAuthStatus>('/api/oauth/openai/status')
      setStatus(s)
    } catch (e: any) {
      console.error('load status', e)
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadModels = useCallback(async () => {
    setLoadingModels(true)
    try {
      const r = await apiCall<{ models: string[] }>('/api/ai/models?provider=openai-codex')
      setModels(r.models || [])
    } catch (e: any) {
      console.error('load models', e)
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (status?.connected) loadModels()
  }, [status?.connected, loadModels])

  const startConnect = async () => {
    setConnecting(true)
    setPollError(null)
    try {
      const s = await apiCall<DeviceSession>('/api/oauth/openai/start', { method: 'POST' })
      setSession(s)
      // Open verification URL in new tab
      window.open(s.verification_uri, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      setPollError(e.message)
      setConnecting(false)
    }
  }

  // Polling loop
  useEffect(() => {
    if (!session) return
    let cancelled = false
    let timer: any

    const poll = async () => {
      if (cancelled) return
      try {
        const r = await apiCall<{ status: string; error?: string }>('/api/oauth/openai/poll', {
          method: 'POST',
          body: JSON.stringify({ session_id: session.session_id }),
        })
        if (cancelled) return
        if (r.status === 'authorized') {
          setSession(null)
          setConnecting(false)
          await loadStatus()
          return
        }
        if (r.status === 'expired' || r.status === 'cancelled' || r.status === 'error') {
          setPollError(r.error || `Sign-in ${r.status}`)
          setSession(null)
          setConnecting(false)
          return
        }
        // Still pending → schedule next
        timer = setTimeout(poll, session.poll_interval * 1000)
      } catch (e: any) {
        if (cancelled) return
        setPollError(e.message)
        setSession(null)
        setConnecting(false)
      }
    }

    timer = setTimeout(poll, session.poll_interval * 1000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [session, loadStatus])

  const cancelConnect = () => {
    setSession(null)
    setConnecting(false)
    setPollError(null)
  }

  const copyCode = () => {
    if (!session) return
    navigator.clipboard.writeText(session.user_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const disconnect = async () => {
    if (!confirm('Disconnect ChatGPT? Bạn sẽ phải pair lại để dùng.')) return
    try {
      await apiCall('/api/oauth/openai/disconnect', { method: 'POST' })
      await loadStatus()
    } catch (e: any) {
      alert(`Disconnect failed: ${e.message}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Đang tải...
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">AI Providers</h1>
      </div>

      <p className="text-sm text-neutral-500">
        Kết nối ChatGPT subscription (hoặc API keys sau này) để portal có thể generate content bằng AI —
        dùng cho Funnel Builder, email templates, và các tính năng khác.
      </p>

      {/* Warning */}
      <div className="flex gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <strong>Lưu ý</strong>: kết nối dùng OAuth device flow với client ID public của Codex CLI (giống cách Hermes Agent làm).
          OpenAI có thể thay đổi hoặc restrict tính năng này bất cứ lúc nào. Không share portal cho nhiều người
          dùng chung 1 account ChatGPT (sẽ trigger rate limits).
        </div>
      </div>

      {/* ChatGPT provider card */}
      <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/50">
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              ChatGPT (subscription)
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              via <code className="text-neutral-400">chatgpt.com/backend-api/codex</code>
            </p>
          </div>
          {status?.connected ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/30 rounded-full">
              <Check className="w-3 h-3" /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-neutral-500/10 text-neutral-400 border border-neutral-500/30 rounded-full">
              <X className="w-3 h-3" /> Not connected
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          {status?.connected ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Trạng thái</p>
                  <p className="text-neutral-200">{status.expired ? '⚠️ Token expired' : '✓ Active'}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Kết nối lúc</p>
                  <p className="text-neutral-200">
                    {status.connected_at ? new Date(status.connected_at).toLocaleString('vi-VN') : '-'}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-neutral-500 uppercase tracking-wider">
                    Models có sẵn ({models.length})
                  </p>
                  <button
                    onClick={loadModels}
                    disabled={loadingModels}
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                {loadingModels ? (
                  <p className="text-sm text-neutral-500">Loading...</p>
                ) : models.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {models.map(m => (
                      <span key={m} className="text-xs px-2 py-1 bg-neutral-800 text-neutral-300 rounded font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500">No models loaded</p>
                )}
              </div>

              <button
                onClick={disconnect}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition text-sm"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-neutral-400">
                Kết nối tài khoản ChatGPT Plus của bạn để portal dùng subscription (không tốn API cost).
                Không lưu password, chỉ lưu OAuth token (encrypted).
              </p>
              <button
                onClick={startConnect}
                disabled={connecting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-black font-semibold rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Connect ChatGPT
              </button>
              {pollError && (
                <p className="text-sm text-red-400">{pollError}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Placeholder for future providers */}
      <div className="border border-neutral-800 border-dashed rounded-xl p-5 opacity-50">
        <h2 className="text-lg font-semibold">Claude Pro, API keys, ... (coming soon)</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Claude Pro subscription, Anthropic API, OpenAI API, Groq, OpenRouter, DeepSeek, Kimi, Qwen — sẽ hỗ trợ trong phase tiếp theo.
        </p>
      </div>

      {/* Device auth modal */}
      {session && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Sign in with OpenAI OAuth (ChatGPT)</h3>
                <p className="text-sm text-neutral-500 mt-1">
                  Portal đã mở tab mới cho bạn. Nhập mã dưới đây vào đó:
                </p>
              </div>
              <button onClick={cancelConnect} className="text-neutral-500 hover:text-neutral-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex justify-center gap-1.5">
              {session.user_code.split('').map((ch, i) => (
                <div
                  key={i}
                  className={`w-10 h-12 flex items-center justify-center rounded-md border font-mono text-lg font-bold ${
                    ch === '-'
                      ? 'border-transparent text-neutral-600'
                      : 'border-neutral-700 bg-neutral-800 text-white'
                  }`}
                >
                  {ch}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-neutral-700 rounded-md hover:bg-neutral-800 transition"
              >
                <Copy className="w-3 h-3" />
                {copied ? 'Copied!' : 'Copy code'}
              </button>
              <a
                href={session.verification_uri}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-neutral-700 rounded-md hover:bg-neutral-800 transition"
              >
                <ExternalLink className="w-3 h-3" />
                Re-open page
              </a>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                Waiting for you to authorize...
              </div>
              <button
                onClick={cancelConnect}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
