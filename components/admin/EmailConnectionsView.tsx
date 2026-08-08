// components/admin/EmailConnectionsView.tsx
// Multi-provider Email Connections — list, create, test, set default, disable, delete.
// Mirrors AIProvidersView pattern.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Mail, Plus, Play, Star, Zap, Trash2, Loader2, Check, X,
  ExternalLink, AlertTriangle, Edit3, Power, ChevronDown,
} from 'lucide-react'
import { supabase } from '../../services/supabase'

interface ProviderConfig {
  id: string
  label: string
  auth: 'api-key' | 'smtp' | 'aws-sig'
  docs_url: string
  supports_marketing: boolean
  supports_transactional: boolean
  monthly_free?: number
  best_for?: 'marketing' | 'transactional' | 'both'
  requires_domain?: boolean
  requires_region?: boolean
  disabled?: boolean
  from_email_hint?: string
}

interface Connection {
  id: string
  provider: string
  provider_label: string
  provider_config?: ProviderConfig
  name: string
  from_email: string
  from_name: string | null
  extra: Record<string, any>
  status: 'active' | 'disabled'
  is_default_transactional: boolean
  is_default_marketing: boolean
  daily_limit: number | null
  monthly_sent: number
  monthly_reset_at: string | null
  last_used_at: string | null
  last_tested_at: string | null
  last_test_error: string | null
  created_at: string
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

export default function EmailConnectionsView() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addProvider, setAddProvider] = useState<string | null>(null)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api<{ connections: Connection[]; providers: ProviderConfig[] }>('/api/email-connections')
      setConnections(r.connections)
      setProviders(r.providers)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const test = async (c: Connection) => {
    setTestingId(c.id)
    try {
      const r = await api<{ ok: boolean; error?: string; latency_ms: number }>(
        `/api/email-connections?action=test&id=${encodeURIComponent(c.id)}`,
        { method: 'POST', body: '{}' },
      )
      alert(r.ok
        ? `Kết nối OK — ${c.provider_label} (${r.latency_ms}ms)`
        : `Test thất bại: ${r.error} (${r.latency_ms}ms)`)
      await load()
    } catch (e: any) {
      alert(`Test lỗi: ${e.message}`)
    } finally {
      setTestingId(null)
    }
  }

  const setDefault = async (id: string, role: 'transactional' | 'marketing') => {
    try {
      await api(`/api/email-connections?action=set-default&id=${encodeURIComponent(id)}&role=${role}`, {
        method: 'POST', body: '{}',
      })
      await load()
    } catch (e: any) { alert(e.message) }
  }

  const disable = async (id: string) => {
    if (!confirm('Vô hiệu hoá connection này? Email sẽ không gửi qua đây nữa.')) return
    try {
      await api(`/api/email-connections?action=disable&id=${encodeURIComponent(id)}`, { method: 'POST', body: '{}' })
      await load()
    } catch (e: any) { alert(e.message) }
  }
  const enable = async (id: string) => {
    try {
      await api(`/api/email-connections?action=enable&id=${encodeURIComponent(id)}`, { method: 'POST', body: '{}' })
      await load()
    } catch (e: any) { alert(e.message) }
  }
  const remove = async (c: Connection) => {
    if (!confirm(`Xoá connection "${c.name}"? Hành động này không thể hoàn tác.`)) return
    try {
      await api(`/api/email-connections?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      await load()
    } catch (e: any) { alert(e.message) }
  }

  const enabledProviders = useMemo(() => providers.filter(p => !p.disabled), [providers])
  const disabledProviders = useMemo(() => providers.filter(p => p.disabled), [providers])

  return (
    <div className="space-y-4">
      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Mail size={15} /> Email Connections
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Kết nối nhiều tài khoản email cùng lúc. Chọn mặc định cho marketing (broadcast, sequence) và transactional (magic link, welcome).
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Plus size={14} /> Kết nối mới <ChevronDown size={12} />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-1 w-64 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-10 overflow-hidden">
              {enabledProviders.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setDropdownOpen(false); setAddProvider(p.id); setAddOpen(true) }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 text-sm text-white flex items-center justify-between"
                >
                  <span>{p.label}</span>
                  {p.monthly_free && (
                    <span className="text-[10px] text-gray-500">{p.monthly_free.toLocaleString()}/tháng free</span>
                  )}
                </button>
              ))}
              {disabledProviders.length > 0 && (
                <>
                  <div className="border-t border-gray-800" />
                  {disabledProviders.map(p => (
                    <div key={p.id} className="px-3 py-2 text-sm text-gray-600 flex items-center justify-between cursor-not-allowed">
                      <span>{p.label}</span>
                      <span className="text-[10px]">(sắp có)</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border p-3 text-xs" style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.06)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl animate-pulse bg-gray-800/40" />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center">
          <Mail size={24} className="mx-auto text-gray-600 mb-2" />
          <p className="text-sm text-gray-400">Chưa có kết nối email nào.</p>
          <p className="text-xs text-gray-500 mt-1">Thêm Brevo (marketing) hoặc Resend (transactional) để bắt đầu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {connections.map(c => (
            <ConnectionCard
              key={c.id}
              conn={c}
              testing={testingId === c.id}
              onTest={() => test(c)}
              onEdit={() => setEditing(c)}
              onDefault={role => setDefault(c.id, role)}
              onDisable={() => disable(c.id)}
              onEnable={() => enable(c.id)}
              onDelete={() => remove(c)}
            />
          ))}
        </div>
      )}

      {/* Add / edit modal */}
      {addOpen && addProvider && (
        <ConnectionModal
          providerConfig={providers.find(p => p.id === addProvider)!}
          onClose={() => { setAddOpen(false); setAddProvider(null) }}
          onSaved={() => { setAddOpen(false); setAddProvider(null); load() }}
        />
      )}
      {editing && (
        <ConnectionModal
          providerConfig={editing.provider_config || providers.find(p => p.id === editing.provider)!}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Connection card ────────────────────────────────────────────────────────
const ConnectionCard: React.FC<{
  conn: Connection
  testing: boolean
  onTest: () => void
  onEdit: () => void
  onDefault: (role: 'transactional' | 'marketing') => void
  onDisable: () => void
  onEnable: () => void
  onDelete: () => void
}> = ({ conn, testing, onTest, onEdit, onDefault, onDisable, onEnable, onDelete }) => {
  const cfg = conn.provider_config
  const monthlyFree = cfg?.monthly_free
  const usagePct = monthlyFree ? Math.round((conn.monthly_sent / monthlyFree) * 100) : 0
  const usageColor = usagePct > 100 ? '#f87171' : usagePct > 80 ? '#fbbf24' : '#4ade80'
  const isActive = conn.status === 'active'

  return (
    <div className={`rounded-xl border p-4 ${isActive ? '' : 'opacity-60'}`}
      style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: name / provider */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Mail size={14} className="text-gray-400 shrink-0" />
            <span className="font-semibold text-sm text-white truncate">{conn.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 uppercase tracking-wide">
              {conn.provider_label}
            </span>
            {!isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">disabled</span>
            )}
            {conn.last_test_error && (
              <span title={conn.last_test_error} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 flex items-center gap-1">
                <AlertTriangle size={9} /> lỗi
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1 truncate">
            {conn.from_name ? `${conn.from_name} <${conn.from_email}>` : conn.from_email}
          </div>

          {/* Usage bar */}
          {monthlyFree ? (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Tháng này</span>
                <span>{conn.monthly_sent.toLocaleString()} / {monthlyFree.toLocaleString()}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, usagePct)}%`, background: usageColor }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[10px] text-gray-500">
              Đã gửi tháng này: {conn.monthly_sent.toLocaleString()}
            </div>
          )}
        </div>

        {/* Right: default roles + actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              title={conn.is_default_marketing ? 'Đang là default MARKETING' : 'Đặt làm default marketing'}
              onClick={() => onDefault('marketing')}
              disabled={!cfg?.supports_marketing}
              className={`p-1.5 rounded transition ${
                conn.is_default_marketing
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'text-gray-500 hover:text-yellow-400 hover:bg-yellow-500/10'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <Star size={13} fill={conn.is_default_marketing ? 'currentColor' : 'none'} />
            </button>
            <button
              title={conn.is_default_transactional ? 'Đang là default TRANSACTIONAL' : 'Đặt làm default transactional'}
              onClick={() => onDefault('transactional')}
              disabled={!cfg?.supports_transactional}
              className={`p-1.5 rounded transition ${
                conn.is_default_transactional
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-gray-500 hover:text-blue-400 hover:bg-blue-500/10'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <Zap size={13} fill={conn.is_default_transactional ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button title="Test kết nối" onClick={onTest} disabled={testing}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40">
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            </button>
            <button title="Sửa" onClick={onEdit}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800">
              <Edit3 size={13} />
            </button>
            {isActive ? (
              <button title="Vô hiệu hoá" onClick={onDisable}
                className="p-1.5 rounded text-gray-400 hover:text-yellow-400 hover:bg-gray-800">
                <Power size={13} />
              </button>
            ) : (
              <button title="Kích hoạt lại" onClick={onEnable}
                className="p-1.5 rounded text-gray-400 hover:text-green-400 hover:bg-gray-800">
                <Power size={13} />
              </button>
            )}
            <button title="Xoá" onClick={onDelete}
              className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add / edit modal ───────────────────────────────────────────────────────
const ConnectionModal: React.FC<{
  providerConfig: ProviderConfig
  existing?: Connection
  onClose: () => void
  onSaved: () => void
}> = ({ providerConfig, existing, onClose, onSaved }) => {
  const isEdit = !!existing
  const [name, setName] = useState(existing?.name || `${providerConfig.label} — mới`)
  const [fromEmail, setFromEmail] = useState(existing?.from_email || '')
  const [fromName, setFromName] = useState(existing?.from_name || '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const save = async () => {
    if (!name.trim() || !fromEmail.trim()) {
      alert('Cần điền tên và email gửi.')
      return
    }
    if (!isEdit && providerConfig.auth === 'api-key' && !apiKey.trim()) {
      alert('Cần API key.')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const patch: any = { name: name.trim(), from_email: fromEmail.trim(), from_name: fromName.trim() || null }
        if (apiKey.trim()) patch.api_key = apiKey.trim()
        await api(`/api/email-connections?id=${encodeURIComponent(existing!.id)}`, {
          method: 'PATCH', body: JSON.stringify(patch),
        })
      } else {
        await api('/api/email-connections', {
          method: 'POST',
          body: JSON.stringify({
            provider: providerConfig.id,
            name: name.trim(),
            from_email: fromEmail.trim(),
            from_name: fromName.trim() || null,
            api_key: apiKey.trim() || undefined,
          }),
        })
      }
      onSaved()
    } catch (e: any) {
      alert(`Lưu thất bại: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const testExisting = async () => {
    if (!existing) return
    setTesting(true); setTestResult(null)
    try {
      const r = await api<{ ok: boolean; error?: string; latency_ms: number }>(
        `/api/email-connections?action=test&id=${encodeURIComponent(existing.id)}`,
        { method: 'POST', body: '{}' },
      )
      setTestResult({ ok: r.ok, msg: r.ok ? `OK (${r.latency_ms}ms)` : (r.error || 'fail') })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-lg w-full shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Mail size={16} /> {isEdit ? 'Sửa connection' : `Thêm ${providerConfig.label}`}
            </h3>
            {providerConfig.docs_url && (
              <a href={providerConfig.docs_url} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-gray-500 hover:text-white flex items-center gap-1 mt-1">
                Lấy API key <ExternalLink size={10} />
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tên connection *</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Brevo — Marketing"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From email *</label>
              <input
                type="email"
                value={fromEmail} onChange={e => setFromEmail(e.target.value)}
                placeholder="hello@yourdomain.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From name</label>
              <input
                value={fromName} onChange={e => setFromName(e.target.value)}
                placeholder="Portal"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
              />
            </div>
          </div>
          {providerConfig.from_email_hint && (
            <p className="text-[10px] text-gray-500">{providerConfig.from_email_hint}</p>
          )}
          {providerConfig.auth === 'api-key' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                API Key {isEdit ? '(để trống nếu không đổi)' : '*'}
              </label>
              <input
                type="password"
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder={providerConfig.id === 'brevo' ? 'xkeysib-...' : providerConfig.id === 'resend' ? 're_...' : 'API key'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-gray-500"
              />
            </div>
          )}

          {testResult && (
            <div className="rounded-lg border p-2 text-xs flex items-center gap-2"
              style={testResult.ok
                ? { borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.06)', color: '#4ade80' }
                : { borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.06)', color: '#f87171' }}>
              {testResult.ok ? <Check size={12} /> : <AlertTriangle size={12} />} {testResult.msg}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {isEdit ? (
              <button onClick={testExisting} disabled={testing}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1 disabled:opacity-40">
                {testing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Test kết nối
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button onClick={onClose}
                className="px-3 py-2 text-sm text-gray-400 hover:text-white">
                Huỷ
              </button>
              <button
                onClick={save} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {saving ? 'Đang lưu...' : (isEdit ? 'Cập nhật' : 'Tạo connection')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
