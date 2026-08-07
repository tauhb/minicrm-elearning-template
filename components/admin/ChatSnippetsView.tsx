import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Loader2, Zap, Save, X, Trash2, Pencil, MessageSquare } from 'lucide-react'
import { supabase } from '../../services/supabase'

interface CannedResponse {
  id: string
  title: string
  body: string
  shortcut: string | null
  created_by: string | null
  created_at: string
  updated_at: string
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

interface DraftForm {
  id?: string
  title: string
  body: string
  shortcut: string
}

const emptyDraft = (): DraftForm => ({ title: '', body: '', shortcut: '' })

const ChatSnippetsView: React.FC = () => {
  const [items, setItems] = useState<CannedResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftForm | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api<{ canned_responses: CannedResponse[] }>('/api/chat/canned-responses')
      setItems(r.canned_responses || [])
    } catch (e: any) {
      setError(e?.message || 'Không tải được snippets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const startNew = () => setDraft(emptyDraft())
  const startEdit = (item: CannedResponse) => setDraft({
    id: item.id,
    title: item.title,
    body: item.body,
    shortcut: item.shortcut || '',
  })

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim() || !draft.body.trim()) {
      setError('Tiêu đề và nội dung bắt buộc.')
      return
    }
    setSaving(true); setError(null)
    try {
      await api('/api/chat/canned-responses', {
        method: 'POST',
        body: JSON.stringify({
          id: draft.id,
          title: draft.title.trim(),
          body: draft.body,
          shortcut: draft.shortcut.trim() || null,
        }),
      })
      setDraft(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Lỗi lưu snippet')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: CannedResponse) => {
    if (!confirm(`Xoá snippet "${item.title}"?`)) return
    setError(null)
    try {
      await api(`/api/chat/canned-responses?id=${item.id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Lỗi xoá')
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} style={{ color: 'var(--color-mission-accent)' }} />
            <h2 className="text-sm font-semibold text-white">Chat snippets</h2>
          </div>
          <button
            onClick={startNew}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded font-semibold"
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Plus size={12} /> Thêm mới
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Mẫu tin nhắn nhanh cho chat. Gõ <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] font-mono">/</kbd> trong ô trả lời chat để chọn nhanh.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-neutral-500" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">Chưa có snippet nào. Bấm "Thêm mới" để bắt đầu.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg overflow-hidden">
            {items.map(item => (
              <div key={item.id} className="p-3 hover:bg-gray-800/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white truncate">{item.title}</span>
                      {item.shortcut && (
                        <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300">
                          <Zap size={9} /> /{item.shortcut}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 whitespace-pre-wrap break-words line-clamp-3">{item.body}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(item)}
                      className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-800" title="Sửa">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => remove(item)}
                      className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10" title="Xoá">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-lg w-full p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="text-base font-semibold text-white">
                {draft.id ? 'Sửa snippet' : 'Snippet mới'}
              </h3>
              <button onClick={() => setDraft(null)} className="text-neutral-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Tiêu đề *</label>
              <input
                value={draft.title}
                onChange={e => setDraft(d => (d ? { ...d, title: e.target.value } : d))}
                placeholder="VD: Chào hỏi"
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm text-white"
              />
            </div>

            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">
                Shortcut (tuỳ chọn) — sẽ trigger bằng <span className="font-mono text-gray-400">/{draft.shortcut || 'shortcut'}</span>
              </label>
              <input
                value={draft.shortcut}
                onChange={e => setDraft(d => (d ? { ...d, shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') } : d))}
                placeholder="VD: chao"
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm text-white font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Nội dung *</label>
              <textarea
                value={draft.body}
                onChange={e => setDraft(d => (d ? { ...d, body: e.target.value } : d))}
                rows={5}
                placeholder="Xin chào bạn! Cảm ơn bạn đã liên hệ..."
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm text-white resize-none"
              />
              <p className="text-[10px] text-neutral-500 mt-1">Dùng "bạn/tôi" cho tự nhiên với khách hàng.</p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-neutral-800">
              <button onClick={() => setDraft(null)} className="text-sm text-neutral-500 hover:text-white px-3">Huỷ</button>
              <button
                onClick={save}
                disabled={saving}
                style={{ background: 'var(--color-mission-accent)', color: '#000' }}
                className="px-4 py-2 text-sm font-semibold rounded flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatSnippetsView
