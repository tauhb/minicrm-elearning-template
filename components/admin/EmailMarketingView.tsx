// components/admin/EmailMarketingView.tsx
// Wave 2 Track F — Email Marketing
//
// Design decision (audit review): don't build a full campaigns UI. Brevo has
// campaign builder, templates, segments, tracking already. This view provides:
//   1. Quick broadcast form (subject + HTML body + audience filter + preview)
//   2. Recent broadcasts history (from email_broadcasts table)
//   3. Deep link to Brevo dashboard for the heavy-lifting features
//   4. Env-check banner (warns if EMAIL_PROVIDER != brevo or key missing)

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Mail, Send, ExternalLink, AlertTriangle, CheckCircle2, XCircle,
  Loader2, Users, User as UserIcon, Tag as TagIcon, RefreshCw, Info,
} from 'lucide-react'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../services/supabase'

type AudienceKind = 'all-leads' | 'all-students' | 'team' | 'tag'

interface BroadcastRow {
  id: string
  subject: string
  recipient_filter: { kind: string; tag?: string; course_id?: string; emails?: string[] }
  recipient_count: number
  sent_count: number
  failed_count: number
  status: 'draft' | 'sending' | 'sent' | 'failed'
  error?: string | null
  created_at: string
  creator?: { display_name?: string; email?: string } | null
  connection_id?: string | null
  connection?: { name?: string; provider?: string } | null
}

interface EmailConnection {
  id: string
  provider: string
  provider_label: string
  provider_config?: {
    monthly_free?: number
    supports_marketing: boolean
    supports_transactional: boolean
    dashboard_url?: string
  }
  name: string
  status: 'active' | 'disabled'
  is_default_marketing: boolean
  is_default_transactional: boolean
  monthly_sent: number
}

interface EnvInfo {
  provider: string
  has_brevo_key: boolean
  has_resend_key: boolean
  warnings: string[]
  brevo_dashboard_url: string
}

const AUDIENCE_LABELS: Record<AudienceKind, string> = {
  'all-leads':    'Tất cả leads',
  'all-students': 'Tất cả customers (student)',
  'team':         'Team members (owner/admin/sales/support)',
  'tag':          'Theo tag',
}

// ── HTTP helper (mirrors ChatView) ───────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────
export default function EmailMarketingView() {
  // Form state
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<AudienceKind>('all-students')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<{ tag: string; count: number }[]>([])
  const [ctaUrl, setCtaUrl] = useState('')
  const [ctaText, setCtaText] = useState('')

  // Runtime state
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [lastResult, setLastResult] = useState<
    | { ok: true; sent: number; failed: number; broadcast_id?: string }
    | { ok: false; error: string }
    | null
  >(null)

  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [env, setEnv] = useState<EnvInfo | null>(null)

  // Multi-provider connections (marketing-capable)
  const [connections, setConnections] = useState<EmailConnection[]>([])
  const [connectionId, setConnectionId] = useState<string>('')

  // ── Load history + env ────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoadingList(true)
    try {
      const r = await api<{ broadcasts: BroadcastRow[] }>('/api/email/broadcasts')
      setBroadcasts(r.broadcasts)
    } catch (e) {
      console.error('[email] load history failed', e)
      setBroadcasts([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadEnv = useCallback(async () => {
    try {
      const r = await api<EnvInfo>('/api/email/broadcasts?action=env')
      setEnv(r)
    } catch (e) {
      console.error('[email] load env failed', e)
    }
  }, [])

  // Load available tags for the dropdown (distinct across customers + leads)
  useEffect(() => {
    api<{ tags: { tag: string; count: number }[] }>('/api/email/broadcasts?action=tags')
      .then(r => setAvailableTags(r.tags || []))
      .catch(() => setAvailableTags([]))
  }, [])

  // Load marketing-capable connections; preselect the marketing default.
  useEffect(() => {
    api<{ connections: EmailConnection[] }>('/api/email-connections')
      .then(r => {
        const active = (r.connections || []).filter(c => c.status === 'active')
        setConnections(active)
        const preferred = active.find(c => c.is_default_marketing)
          || active.find(c => c.provider_config?.supports_marketing)
          || active[0]
        if (preferred) setConnectionId(preferred.id)
      })
      .catch(() => setConnections([]))
  }, [])

  useEffect(() => { loadHistory(); loadEnv() }, [loadHistory, loadEnv])

  // ── Preview count (debounced when audience/tags changes) ──────────────
  useEffect(() => {
    if (audience === 'tag' && selectedTags.length === 0) {
      setPreviewCount(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ action: 'preview', audience })
        if (audience === 'tag') params.set('tags', selectedTags.join(','))
        const r = await api<{ count: number }>(`/api/email/broadcasts?${params}`)
        if (!cancelled) setPreviewCount(r.count)
      } catch {
        if (!cancelled) setPreviewCount(0)
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [audience, selectedTags])

  // ── Send handler ──────────────────────────────────────────────────────
  const canSend = subject.trim().length > 0 && body.trim().length > 0
    && (audience !== 'tag' || selectedTags.length > 0)
    && !sending

  const handleSend = async () => {
    if (!canSend) return
    if (previewCount === 0) {
      setLastResult({ ok: false, error: 'Không có người nhận cho bộ lọc này.' })
      return
    }
    const confirmMsg = `Sẽ gửi cho ${previewCount ?? '?'} người. Xác nhận gửi?`
    if (!window.confirm(confirmMsg)) return

    setSending(true)
    setLastResult(null)
    try {
      const payload: Record<string, any> = {
        audience,
        subject: subject.trim(),
        body: body.trim(),
      }
      if (audience === 'tag') payload.tags = selectedTags
      if (ctaUrl.trim())  payload.ctaUrl = ctaUrl.trim()
      if (ctaText.trim()) payload.ctaText = ctaText.trim()
      if (connectionId)   payload.connection_id = connectionId

      const r = await api<{ success: boolean; sent: number; failed: number; broadcast_id?: string; error?: string }>(
        '/api/email/broadcast',
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setLastResult({ ok: true, sent: r.sent, failed: r.failed, broadcast_id: r.broadcast_id })
      // Reset form on full success
      if (r.failed === 0) {
        setSubject(''); setBody(''); setCtaUrl(''); setCtaText('')
      }
      loadHistory()
    } catch (e: any) {
      setLastResult({ ok: false, error: e.message || 'Gửi thất bại' })
    } finally {
      setSending(false)
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Header — dynamic dashboard buttons per connected provider (one per unique provider) */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3" style={{ color: 'var(--theme-text)' }}>
            <Mail size={22} /> Email Marketing
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Broadcast nhanh + xem lịch sử gửi.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {Array.from(new Map(
            connections
              .filter(c => c.provider_config?.dashboard_url)
              .map(c => [c.provider, { label: c.provider_label, url: c.provider_config!.dashboard_url! }])
          ).values()).map(({ label, url }) => (
            <a
              key={url}
              href={url}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors hover:opacity-90"
              style={{ borderColor: 'var(--color-mission-accent)', color: 'var(--color-mission-accent)' }}
            >
              Mở {label} Dashboard <ExternalLink size={14} />
            </a>
          ))}
        </div>
      </div>

      {/* Only surface a banner when broadcast will actually fail (no key at all).
          The "provider != brevo" hint is technical noise the user doesn't need. */}
      {env && !env.has_brevo_key && !env.has_resend_key && (
        <div className="rounded-lg border p-3 flex gap-3 items-start"
          style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.06)' }}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: '#f87171' }} />
          <div className="text-xs" style={{ color: '#f87171' }}>
            Chưa cấu hình API key nào. <a href="/admin/settings#email" className="underline">Vào Cài đặt → Email</a> để thêm Brevo hoặc Resend.
          </div>
        </div>
      )}

      {/* Quick broadcast form */}
      <section className="rounded-xl border p-5"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
        <h2 className="text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2"
          style={{ color: 'var(--theme-text)' }}>
          <Send size={14} /> Broadcast nhanh
        </h2>

        <div className="space-y-4">
          {/* Subject */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Tiêu đề *</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Ví dụ: Ưu đãi tháng 8 — giảm 30% khóa Livestream Growth"
              className="w-full bg-transparent border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
              style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">
              Nội dung (HTML) *{' '}
              <span className="text-gray-600">— chấp nhận HTML cơ bản (&lt;p&gt;, &lt;a&gt;, &lt;strong&gt;, &lt;br&gt;...)</span>
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              placeholder={'<p>Chào {{name}},</p>\n<p>Nội dung email...</p>'}
              className="w-full bg-transparent border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-500"
              style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
            />
          </div>

          {/* CTA (optional) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">CTA URL (tuỳ chọn)</label>
              <input
                type="url"
                value={ctaUrl}
                onChange={e => setCtaUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-transparent border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">CTA text</label>
              <input
                type="text"
                value={ctaText}
                onChange={e => setCtaText(e.target.value)}
                placeholder="Xem chi tiết"
                className="w-full bg-transparent border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
              />
            </div>
          </div>

          {/* Connection picker (multi-provider) */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">
              Gửi qua {' '}
              <a href="/admin/settings#email" className="text-gray-600 hover:text-gray-400 underline">
                (quản lý kết nối)
              </a>
            </label>
            {connections.length === 0 ? (
              <div className="border rounded-md p-2 text-xs text-gray-500"
                   style={{ borderColor: 'var(--theme-border)' }}>
                Chưa có kết nối email nào. <a href="/admin/settings#email" className="underline">Thêm ở Cài đặt → Email</a>.
              </div>
            ) : (
              <select
                value={connectionId}
                onChange={e => setConnectionId(e.target.value)}
                className="w-full bg-transparent border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
              >
                {connections.map(c => {
                  const free = c.provider_config?.monthly_free
                  const suffix = free ? ` · ${c.monthly_sent.toLocaleString()}/${free.toLocaleString()}` : ` · ${c.monthly_sent.toLocaleString()}`
                  const canMarket = c.provider_config?.supports_marketing !== false
                  const label = `${c.name} (${c.provider_label})${suffix}${!canMarket ? ' — chỉ transactional' : ''}${c.is_default_marketing ? ' · ★ default' : ''}`
                  return (
                    <option key={c.id} value={c.id} disabled={!canMarket} style={{ background: '#1f2937' }}>
                      {label}
                    </option>
                  )
                })}
              </select>
            )}
          </div>

          {/* Audience */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Người nhận</label>
              <select
                value={audience}
                onChange={e => setAudience(e.target.value as AudienceKind)}
                className="w-full bg-transparent border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
              >
                {(Object.keys(AUDIENCE_LABELS) as AudienceKind[]).map(k => (
                  <option key={k} value={k} style={{ background: '#1f2937' }}>
                    {AUDIENCE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            {audience === 'tag' && (
              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1">
                  Tags {selectedTags.length > 0 && <span className="text-gray-500">({selectedTags.length} chọn — OR)</span>}
                </label>
                {availableTags.length === 0 ? (
                  <div className="border rounded-md p-3 text-xs text-gray-500 text-center"
                       style={{ borderColor: 'var(--theme-border)' }}>
                    Chưa có tag nào. Thêm tag cho lead/customer trước.
                  </div>
                ) : (
                  <div className="border rounded-md p-2 max-h-40 overflow-y-auto"
                       style={{ borderColor: 'var(--theme-border)' }}>
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.map(({ tag: tName, count }) => {
                        const active = selectedTags.includes(tName)
                        return (
                          <button
                            key={tName}
                            type="button"
                            onClick={() => setSelectedTags(prev =>
                              active ? prev.filter(t => t !== tName) : [...prev, tName]
                            )}
                            className="text-xs px-2 py-1 rounded border transition flex items-center gap-1"
                            style={active
                              ? { background: 'var(--color-mission-accent)', color: '#000', borderColor: 'var(--color-mission-accent)' }
                              : { borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}
                          >
                            <TagIcon size={10} />
                            {tName}
                            <span className="opacity-60">·{count}</span>
                          </button>
                        )
                      })}
                    </div>
                    {selectedTags.length > 0 && (
                      <button onClick={() => setSelectedTags([])}
                        className="mt-2 text-[10px] text-gray-500 hover:text-white">
                        Bỏ chọn tất cả
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview + Send */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t"
            style={{ borderColor: 'var(--theme-border)' }}>
            <div className="text-sm flex items-center gap-2" style={{ color: 'var(--theme-text-muted)' }}>
              <Users size={14} />
              {previewing ? (
                <><Loader2 size={12} className="animate-spin" /> Đang đếm...</>
              ) : previewCount == null ? (
                'Nhập bộ lọc để xem số người nhận'
              ) : (
                <>Sẽ gửi cho <strong style={{ color: 'var(--color-mission-accent)' }}>{previewCount}</strong> người</>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Đang gửi...' : 'Gửi ngay'}
            </button>
          </div>

          {/* Inline result */}
          {lastResult && (
            <div className="rounded-md border p-3 flex items-start gap-3 text-sm"
              style={
                lastResult.ok && lastResult.failed === 0
                  ? { borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.06)', color: '#4ade80' }
                  : lastResult.ok
                  ? { borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)', color: '#fbbf24' }
                  : { borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.06)', color: '#f87171' }
              }
            >
              {lastResult.ok
                ? (lastResult.failed === 0
                    ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    : <AlertTriangle size={16} className="mt-0.5 shrink-0" />)
                : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <div>
                {lastResult.ok === true
                  ? `Đã gửi ${lastResult.sent} — thất bại ${lastResult.failed}.`
                  : `Lỗi: ${(lastResult as { ok: false; error: string }).error}`}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent broadcasts */}
      <section className="rounded-xl border"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--theme-border)' }}>
          <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2"
            style={{ color: 'var(--theme-text)' }}>
            Lịch sử broadcast
          </h2>
          <button
            onClick={loadHistory}
            className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {loadingList ? (
          <div className="p-6 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />
            ))}
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            Chưa có broadcast nào. Gửi email đầu tiên ở form phía trên.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--theme-border)' }}>
            {broadcasts.map(b => <BroadcastRow key={b.id} row={b} />)}
          </div>
        )}
      </section>

      {/* Env footer */}
      {env && (
        <div className="text-xs text-gray-500 flex items-center gap-2 pt-2">
          <Info size={11} />
          Provider hiện tại: <strong>{env.provider}</strong>
          {' · '}
          Brevo key: {env.has_brevo_key ? 'có' : 'thiếu'}
          {' · '}
          Resend key: {env.has_resend_key ? 'có' : 'thiếu'}
        </div>
      )}
    </div>
  )
}

// ─── History row ────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  sending: { color: '#fbbf24', label: 'Đang gửi' },
  sent:    { color: '#4ade80', label: 'Đã gửi' },
  failed:  { color: '#f87171', label: 'Thất bại' },
  draft:   { color: '#94a3b8', label: 'Nháp' },
}

const BroadcastRow: React.FC<{ row: BroadcastRow }> = ({ row }) => {
  const filterLabel = useMemo(() => {
    const f = (row.recipient_filter || {}) as { kind?: string; tag?: string; course_id?: string; emails?: string[] }
    switch (f.kind) {
      case 'all-leads':    return 'Tất cả leads'
      case 'all-students': return 'Tất cả students'
      case 'team':         return 'Team members'
      case 'tag':          return `Tag: ${f.tag || '?'}`
      case 'course':       return `Course: ${String(f.course_id || '').slice(0, 8)}`
      case 'custom':       return `Custom (${(f.emails || []).length} email)`
      default:             return f.kind || '—'
    }
  }, [row.recipient_filter])

  const status = STATUS_STYLE[row.status] || STATUS_STYLE.sent
  const created = new Date(row.created_at)

  return (
    <div className="px-5 py-3 flex items-center gap-4 text-sm hover:bg-gray-800/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate" style={{ color: 'var(--theme-text)' }}>
          {row.subject}
        </div>
        <div className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: 'var(--theme-text-muted)' }}>
          <span>{format(created, 'dd MMM yyyy · HH:mm', { locale: vi })}</span>
          <span>·</span>
          <span className="flex items-center gap-1"><Users size={11} /> {filterLabel}</span>
          {row.creator && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <UserIcon size={11} /> {row.creator.display_name || row.creator.email || 'unknown'}
              </span>
            </>
          )}
          {row.connection?.name && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1" title={`Provider: ${row.connection.provider}`}>
                <Mail size={11} /> {row.connection.name}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="text-xs text-right shrink-0 flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-3">
          <span title="Đã gửi thành công" style={{ color: '#4ade80' }}>
            ✓ {row.sent_count}
          </span>
          {row.failed_count > 0 && (
            <span title="Thất bại" style={{ color: '#f87171' }}>
              ✕ {row.failed_count}
            </span>
          )}
          <span className="text-gray-500">/ {row.recipient_count}</span>
        </div>
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
          style={{
            color: status.color,
            borderColor: `${status.color}55`,
            background: `${status.color}14`,
          }}
        >
          {status.label}
        </span>
      </div>
    </div>
  )
}
