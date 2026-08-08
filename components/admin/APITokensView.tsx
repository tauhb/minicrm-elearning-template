import React, { useEffect, useMemo, useState } from 'react'
import { KeyRound, Plus, Copy, Check, Trash2, ShieldOff, AlertTriangle, Terminal } from 'lucide-react'
import { supabase } from '../../services/supabase'

// Must mirror api/api-tokens/index.ts CANONICAL_SCOPES + mcp-server/src/scopes.ts.
const SCOPE_GROUPS: Array<{ label: string; scopes: string[] }> = [
  { label: 'Leads',      scopes: ['leads.read', 'leads.write', 'leads.convert'] },
  { label: 'Customers',  scopes: ['customers.read', 'customers.write', 'customers.deactivate'] },
  { label: 'Tasks',      scopes: ['tasks.read', 'tasks.write', 'tasks.complete'] },
  { label: 'Orders',     scopes: ['orders.read', 'orders.refund'] },
  { label: 'Funnels',    scopes: ['funnels.read', 'funnels.publish'] },
  { label: 'Chat',       scopes: ['chat.read', 'chat.reply'] },
  { label: 'Knowledge',  scopes: ['knowledge.read', 'knowledge.write'] },
  { label: 'Team',       scopes: ['team.read', 'team.invite'] },
  { label: 'Analytics',  scopes: ['analytics.read'] },
]

interface TokenRow {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

const APITokensView: React.FC = () => {
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // Create-token form
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())
  const [wildcard, setWildcard] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Reveal state — the one time we show the raw token
  const [rawToken, setRawToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [isOwner, setIsOwner] = useState(false)

  const authHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }
  }

  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }
    try {
      const res = await fetch('/api/api-tokens', { headers: { Authorization: `Bearer ${session.access_token}` } })
      const json = await res.json()
      if (res.ok) setTokens(json.tokens || [])

      // Check role for wildcard scope UI
      const { data: me } = await supabase.from('customers').select('role').eq('id', session.user.id).maybeSingle()
      setIsOwner(me?.role === 'owner')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleScope = (s: string) => {
    const next = new Set(selectedScopes)
    if (next.has(s)) next.delete(s); else next.add(s)
    setSelectedScopes(next)
  }

  const finalScopes = useMemo(() => wildcard ? ['*'] : Array.from(selectedScopes), [wildcard, selectedScopes])

  const resetForm = () => {
    setName(''); setSelectedScopes(new Set()); setWildcard(false); setExpiresAt(''); setCreateError('')
  }

  const closeModal = () => {
    if (rawToken) {
      // If user is about to close after seeing raw token, refresh list
      setRawToken(null); setCopied(false); load()
    }
    setShowModal(false); resetForm()
  }

  const createToken = async () => {
    setCreateError('')
    if (!name.trim()) return setCreateError('Đặt tên cho token (VD: "Claude Code — laptop")')
    if (finalScopes.length === 0) return setCreateError('Chọn ít nhất 1 scope')

    setCreating(true)
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/api-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          scopes: finalScopes,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setCreateError(json.error || 'Không tạo được token'); return }
      setRawToken(json.raw_token)
    } catch (err: any) {
      setCreateError(err.message || 'Network error')
    } finally {
      setCreating(false)
    }
  }

  const revokeToken = async (id: string) => {
    if (!confirm('Thu hồi token này? MCP client dùng token này sẽ bị ngắt kết nối ngay.')) return
    const headers = await authHeaders()
    const res = await fetch(`/api/api-tokens?action=revoke&id=${encodeURIComponent(id)}`, { method: 'POST', headers })
    if (res.ok) load()
    else alert('Thu hồi thất bại: ' + (await res.text()))
  }

  const deleteToken = async (id: string) => {
    if (!confirm('Xoá vĩnh viễn token? Không thể hoàn tác.')) return
    const headers = await authHeaders()
    const res = await fetch(`/api/api-tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers })
    if (res.ok) load()
    else alert('Xoá thất bại: ' + (await res.text()))
  }

  const copyRaw = async () => {
    if (!rawToken) return
    await navigator.clipboard.writeText(rawToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <KeyRound size={18} style={{ color: 'var(--color-mission-accent)' }} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white">API Tokens (MCP)</h2>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Tạo token để Claude Code / Codex / Cursor điều khiển CRM qua ngôn ngữ tự nhiên (MCP).
              Mỗi token gán scope cụ thể, có thể revoke bất kỳ lúc nào. Cài package{' '}
              <code className="bg-gray-800 px-1.5 py-0.5 rounded text-[10px] text-gray-300">@rainmaker/agentcrm-mcp</code>,
              paste token vào cấu hình MCP client — xong.
            </p>
          </div>
          <button
            onClick={() => { setShowModal(true); resetForm() }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-90 shrink-0"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Plus size={13} /> Tạo token
          </button>
        </div>
      </div>

      {/* Token list */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 text-xs text-gray-500 text-center">Đang tải...</div>
        ) : tokens.length === 0 ? (
          <div className="p-8 text-center">
            <Terminal size={28} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-white mb-1">Chưa có token</p>
            <p className="text-xs text-gray-500">Tạo token để Claude Code / Codex kết nối vào CRM.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/40">
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Tên</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Prefix</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Scopes</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Lần cuối</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Trạng thái</th>
                <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {tokens.map(t => {
                const revoked = !!t.revoked_at
                const expired = t.expires_at && new Date(t.expires_at) < new Date()
                return (
                  <tr key={t.id} className={revoked || expired ? 'opacity-50' : ''}>
                    <td className="px-4 py-3 text-white">{t.name}</td>
                    <td className="px-4 py-3 font-mono text-gray-400">{t.token_prefix}…</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {t.scopes.map(s => (
                          <span key={s} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-800 border border-gray-700 text-gray-300">
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {t.last_used_at
                        ? new Date(t.last_used_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : <span className="text-gray-700">Chưa dùng</span>}
                    </td>
                    <td className="px-4 py-3">
                      {revoked ? <span className="text-red-400">Đã thu hồi</span>
                       : expired ? <span className="text-orange-400">Hết hạn</span>
                       : <span className="text-emerald-400">● Hoạt động</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        {!revoked && (
                          <button
                            onClick={() => revokeToken(t.id)}
                            title="Thu hồi"
                            className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-orange-400 transition-colors"
                          >
                            <ShieldOff size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteToken(t.id)}
                          title="Xoá vĩnh viễn"
                          className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Setup hint */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <Terminal size={14} style={{ color: 'var(--color-mission-accent)' }} />
          <h3 className="text-sm font-semibold text-white">Cấu hình Claude Code</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">Thêm vào <code className="bg-gray-800 px-1 rounded text-gray-300">~/.claude/config.toml</code>:</p>
        <pre className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-[11px] text-gray-300 font-mono overflow-x-auto leading-relaxed">{`[[mcpServers]]
name = "agentcrm"
command = "agentcrm-mcp"
env.AGENTCRM_URL = "${typeof window !== 'undefined' ? window.location.origin : 'https://portal.yourdomain.com'}"
env.AGENTCRM_TOKEN = "acrm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`}</pre>
        <p className="text-[11px] text-gray-600 mt-2">
          Cài package: <code className="bg-gray-800 px-1 rounded">npm install -g @rainmaker/agentcrm-mcp</code>
        </p>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6" onClick={closeModal}>
          <div className="bg-gray-900 border border-gray-800 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              {!rawToken ? (
                <>
                  <h3 className="text-base font-semibold text-white mb-1">Tạo API Token</h3>
                  <p className="text-xs text-gray-500 mb-5">Token dùng để MCP client (Claude Code / Codex / Cursor) truy cập CRM.</p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5">Tên token</label>
                      <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="VD: Claude Code — laptop"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-xs text-gray-500">Scopes</label>
                        {isOwner && (
                          <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={wildcard} onChange={e => setWildcard(e.target.checked)} className="accent-current" />
                            <span>Full access (<code>*</code>) — chỉ owner</span>
                          </label>
                        )}
                      </div>
                      {wildcard ? (
                        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-300 flex items-start gap-2">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          <span>Token này có toàn quyền — tương đương admin. Chỉ dùng cho môi trường tin cậy.</span>
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                          {SCOPE_GROUPS.map(g => (
                            <div key={g.label}>
                              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">{g.label}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {g.scopes.map(s => (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => toggleScope(s)}
                                    className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                                      selectedScopes.has(s)
                                        ? 'border-transparent'
                                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-600'
                                    }`}
                                    style={selectedScopes.has(s) ? { backgroundColor: 'var(--color-mission-accent)', color: '#000' } : undefined}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5">Hết hạn (tuỳ chọn)</label>
                      <input
                        type="date"
                        value={expiresAt}
                        onChange={e => setExpiresAt(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                      />
                      <p className="text-[11px] text-gray-600 mt-1">Để trống nếu không có ngày hết hạn.</p>
                    </div>

                    {createError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">{createError}</div>
                    )}

                    <div className="flex gap-2 justify-end pt-2">
                      <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Huỷ</button>
                      <button
                        onClick={createToken}
                        disabled={creating}
                        className="px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                      >
                        {creating ? 'Đang tạo...' : 'Tạo token'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                    <Check size={18} className="text-emerald-400" /> Token đã tạo
                  </h3>
                  <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-300 flex items-start gap-2 mb-4">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Chỉ hiện 1 lần, hãy copy ngay. Sau khi đóng dialog sẽ không xem lại được.</span>
                  </div>
                  <div className="flex gap-2 mb-4">
                    <code className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-xs font-mono break-all" style={{ color: 'var(--color-mission-accent)' }}>
                      {rawToken}
                    </code>
                    <button
                      onClick={copyRaw}
                      className="px-3 py-2.5 rounded-lg font-semibold text-xs transition-opacity hover:opacity-90"
                      style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                    >
                      {copied ? <><Check size={12} className="inline" /> Đã copy</> : <><Copy size={12} className="inline" /> Copy</>}
                    </button>
                  </div>
                  <div className="text-[11px] text-gray-500 space-y-1">
                    <p>Dán vào <code className="bg-gray-800 px-1 rounded text-gray-300">AGENTCRM_TOKEN</code> trong MCP config.</p>
                    <p>Ví dụ Claude Code (<code className="bg-gray-800 px-1 rounded text-gray-300">~/.claude/config.toml</code>): xem hướng dẫn ở dưới danh sách token.</p>
                  </div>
                  <div className="flex justify-end mt-5">
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
                      style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                    >
                      Đã copy, đóng
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default APITokensView
