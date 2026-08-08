// components/admin/KnowledgeView.tsx — Sprint B
// KB list + entry management + Karpathy-style distillation + product attach.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen, Plus, Trash2, Pencil, RefreshCw, Sparkles, Link2, Search,
  Loader2, X, FileText, Package, Save, ChevronRight, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { supabase } from '../../services/supabase'
import EmptyState from './EmptyState'
import LoadingState from './LoadingState'
import TagsEditor from './TagsEditor'

// ─── types ───────────────────────────────────────────────────────────────────

interface KB {
  id: string
  slug: string
  name: string
  description: string | null
  embedding_provider: string | null
  embedding_model: string | null
  embedding_dim: number | null
  created_at: string
  updated_at: string
  entry_count: number
  last_entry_at: string | null
}

interface Entry {
  id: string
  kb_id: string
  category: string | null
  filename: string
  title: string
  summary: string
  tags: string[]
  source_kind: string
  source_ref: any
  is_active: boolean
  created_at: string
  updated_at: string
  chunk_count: number
}

interface EntryDetail extends Entry { content: string }

interface RagChunk {
  chunk_id: string
  entry_id: string
  entry_title: string
  entry_filename: string
  chunk_text: string
  score: number
}

interface Product { id: string; name: string; type: string; status: string }

// ─── api helper ──────────────────────────────────────────────────────────────

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

// ─── main view ───────────────────────────────────────────────────────────────

export default function KnowledgeView() {
  const [kbs, setKbs] = useState<KB[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [showCreateKb, setShowCreateKb] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api<{ knowledge_bases: KB[] }>('/api/knowledge')
      setKbs(r.knowledge_bases || [])
      if (!selectedKbId && r.knowledge_bases?.[0]) setSelectedKbId(r.knowledge_bases[0].id)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [selectedKbId])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedKb = useMemo(() => kbs.find(k => k.id === selectedKbId) || null, [kbs, selectedKbId])

  const handleDeleteKb = async (kb: KB) => {
    if (!confirm(`Xoá KB "${kb.name}"? Tất cả entry + chunk sẽ mất, không hoàn tác.`)) return
    try {
      await api(`/api/knowledge?id=${kb.id}`, { method: 'DELETE' })
      setSelectedKbId(null)
      load()
    } catch (e: any) { alert(`Xoá thất bại: ${e.message}`) }
  }

  return (
    <div className="p-6 min-h-full">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              <BookOpen size={22} /> Kho kiến thức
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              Đóng gói tri thức thành các entry ngắn, embed để RAG. Gán KB vào sản phẩm để chat widget tự trả lời.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-sm px-4 py-3 flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div className="grid grid-cols-12 gap-4">
          {/* Left: KB list */}
          <aside className="col-span-12 md:col-span-4 lg:col-span-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-950">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                <span className="text-xs uppercase tracking-widest text-neutral-500 font-semibold">Danh sách KB</span>
                <button
                  onClick={() => setShowCreateKb(true)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-300"
                >
                  <Plus size={12} /> Tạo KB
                </button>
              </div>

              {loading ? (
                <LoadingState label="Đang tải KB..." />
              ) : kbs.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={BookOpen}
                    title="Chưa có KB nào"
                    description="Tạo KB đầu tiên để bắt đầu ingest kiến thức."
                    cta={{ label: 'Tạo KB', icon: Plus, onClick: () => setShowCreateKb(true) }}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-neutral-900">
                  {kbs.map(kb => (
                    <li key={kb.id}>
                      <button
                        onClick={() => setSelectedKbId(kb.id)}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                          kb.id === selectedKbId ? 'bg-neutral-900' : 'hover:bg-neutral-900/50'
                        }`}
                      >
                        <div className="w-8 h-8 rounded flex items-center justify-center border border-neutral-800 shrink-0">
                          <BookOpen size={14} className="text-neutral-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-white truncate">{kb.name}</div>
                          <div className="text-[11px] text-neutral-500 truncate">
                            {kb.entry_count} entries · {kb.embedding_provider || '—'}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-neutral-600 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Right: KB detail */}
          <section className="col-span-12 md:col-span-8 lg:col-span-9">
            {selectedKb ? (
              <KBDetail kb={selectedKb} onReload={load} onDelete={() => handleDeleteKb(selectedKb)} />
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-10">
                <EmptyState
                  icon={BookOpen}
                  title="Chọn một KB ở bên trái"
                  description="Hoặc tạo KB mới để bắt đầu."
                />
              </div>
            )}
          </section>
        </div>
      </div>

      {showCreateKb && (
        <CreateKbModal onClose={() => setShowCreateKb(false)} onCreated={(kb) => { setShowCreateKb(false); load(); setSelectedKbId(kb.id) }} />
      )}
    </div>
  )
}

// ─── KB detail (entries table + actions) ─────────────────────────────────────

const KBDetail: React.FC<{ kb: KB; onReload: () => void; onDelete: () => void }> = ({ kb, onReload, onDelete }) => {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const [showEditor, setShowEditor] = useState<{ mode: 'create' } | { mode: 'edit'; entry: EntryDetail } | null>(null)
  const [showDistill, setShowDistill] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [showTest, setShowTest] = useState(false)

  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api<{ entries: Entry[] }>(`/api/knowledge/entries?kb_id=${kb.id}`)
      setEntries(r.entries || [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [kb.id])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return entries
    return entries.filter(e =>
      e.title.toLowerCase().includes(s) ||
      e.filename.toLowerCase().includes(s) ||
      e.summary.toLowerCase().includes(s) ||
      e.tags.some(t => t.toLowerCase().includes(s))
    )
  }, [entries, q])

  const openEditor = async (entry?: Entry) => {
    if (!entry) { setShowEditor({ mode: 'create' }); return }
    try {
      // fetch full content — list endpoint didn't include content
      const { data } = await supabase.from('kb_entries').select('*').eq('id', entry.id).single()
      if (data) setShowEditor({ mode: 'edit', entry: data as EntryDetail })
    } catch (e: any) { alert(`Không tải được entry: ${e.message}`) }
  }

  const handleReembed = async (entry: Entry) => {
    setBusyEntryId(entry.id)
    try {
      const r = await api<{ chunks_created: number }>(`/api/knowledge/entries?action=reembed&id=${entry.id}`, {
        method: 'POST', body: '{}',
      })
      alert(`Đã re-embed: ${r.chunks_created} chunks`)
      load()
    } catch (e: any) { alert(`Re-embed thất bại: ${e.message}`) }
    finally { setBusyEntryId(null) }
  }

  const handleDeleteEntry = async (entry: Entry) => {
    if (!confirm(`Xoá entry "${entry.title}"?`)) return
    try {
      await api(`/api/knowledge/entries?id=${entry.id}`, { method: 'DELETE' })
      load()
    } catch (e: any) { alert(`Xoá thất bại: ${e.message}`) }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950">
      {/* Header */}
      <div className="p-5 border-b border-neutral-800">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white truncate">{kb.name}</h2>
              <span className="text-[10px] uppercase tracking-widest text-neutral-500 border border-neutral-800 rounded px-1.5 py-0.5">
                {kb.slug}
              </span>
            </div>
            {kb.description && <p className="text-sm text-neutral-400 mt-1">{kb.description}</p>}
            <p className="text-xs text-neutral-600 mt-2">
              Embedding: <span className="text-neutral-400">{kb.embedding_provider}/{kb.embedding_model} ({kb.embedding_dim}d)</span> · {kb.entry_count} entries
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowDistill(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-200">
              <Sparkles size={12} /> Distill raw
            </button>
            <button onClick={() => openEditor()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200">
              <Plus size={12} /> Entry mới
            </button>
            <button onClick={() => setShowAttach(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-200">
              <Link2 size={12} /> Gán vào sản phẩm
            </button>
            <button onClick={() => setShowTest(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-200">
              <Search size={12} /> Thử retrieve
            </button>
            <button onClick={onDelete} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-red-900 hover:border-red-700 text-red-400">
              <Trash2 size={12} /> Xoá KB
            </button>
          </div>
        </div>

        <div className="mt-4 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Tìm entry theo title, filename, tag..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm text-white placeholder-neutral-600 focus:border-neutral-600 outline-none"
          />
        </div>
      </div>

      {/* Entries table */}
      {loading ? (
        <LoadingState label="Đang tải entries..." />
      ) : error ? (
        <div className="p-6 text-sm text-red-400">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={FileText}
            title={q ? 'Không có entry nào khớp' : 'KB này chưa có entry'}
            description={q ? 'Xoá bộ lọc hoặc thử từ khoá khác.' : 'Bấm "Entry mới" để tạo tay, hoặc "Distill raw" để nhồi content và để AI tự chia thành entries.'}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Title</th>
                <th className="text-left px-3 py-2.5 font-medium">Filename</th>
                <th className="text-left px-3 py-2.5 font-medium">Tags</th>
                <th className="text-left px-3 py-2.5 font-medium">Nguồn</th>
                <th className="text-left px-3 py-2.5 font-medium">Chunks</th>
                <th className="text-left px-3 py-2.5 font-medium">Cập nhật</th>
                <th className="text-right px-5 py-2.5 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-neutral-900/40">
                  <td className="px-5 py-3">
                    <div className="text-neutral-100 line-clamp-1">{e.title}</div>
                    <div className="text-[11px] text-neutral-500 line-clamp-1 max-w-md">{e.summary}</div>
                  </td>
                  <td className="px-3 py-3 text-neutral-400 text-xs font-mono">{e.filename}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(e.tags || []).slice(0, 3).map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-400">{t}</span>
                      ))}
                      {e.tags?.length > 3 && <span className="text-[10px] text-neutral-600">+{e.tags.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-neutral-500">{e.source_kind}</td>
                  <td className="px-3 py-3 text-xs">
                    <span className={e.chunk_count === 0 ? 'text-red-400' : 'text-neutral-400'}>{e.chunk_count}</span>
                  </td>
                  <td className="px-3 py-3 text-[11px] text-neutral-500">{new Date(e.updated_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEditor(e)} title="Sửa" className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white">
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleReembed(e)}
                        disabled={busyEntryId === e.id}
                        title="Re-embed"
                        className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white disabled:opacity-40"
                      >
                        {busyEntryId === e.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      </button>
                      <button onClick={() => handleDeleteEntry(e)} title="Xoá" className="p-1.5 rounded hover:bg-red-950 text-neutral-400 hover:text-red-400">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showEditor && (
        <EntryEditor
          kbId={kb.id}
          mode={showEditor.mode}
          initial={showEditor.mode === 'edit' ? showEditor.entry : null}
          onClose={() => setShowEditor(null)}
          onSaved={() => { setShowEditor(null); load(); onReload() }}
        />
      )}
      {showDistill && (
        <DistillModal
          kbId={kb.id}
          onClose={() => setShowDistill(false)}
          onDone={() => { setShowDistill(false); load(); onReload() }}
        />
      )}
      {showAttach && (
        <ProductAttachModal kbId={kb.id} onClose={() => setShowAttach(false)} />
      )}
      {showTest && (
        <RetrieveTestModal kbId={kb.id} onClose={() => setShowTest(false)} />
      )}
    </div>
  )
}

// ─── Create KB modal ─────────────────────────────────────────────────────────

interface EmbeddingProviderChoice {
  id: string; label: string
  embedding_model: string; embedding_dim: number
  connected: boolean; status: string; docs_url: string
}

const CreateKbModal: React.FC<{ onClose: () => void; onCreated: (kb: KB) => void }> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load eligible embedding providers (from registry, annotated with connected status)
  const [providers, setProviders] = useState<EmbeddingProviderChoice[]>([])
  const [providerId, setProviderId] = useState<string>('openai')

  useEffect(() => {
    api<{ providers: EmbeddingProviderChoice[] }>('/api/knowledge?action=embedding-providers')
      .then(r => {
        setProviders(r.providers)
        // Prefer first connected one; else openai default
        const firstConnected = r.providers.find(p => p.connected)
        if (firstConnected) setProviderId(firstConnected.id)
      })
      .catch(() => setProviders([]))
  }, [])

  const selected = providers.find(p => p.id === providerId)

  const handleSave = async () => {
    if (!name.trim()) { setError('Tên KB bắt buộc'); return }
    if (!selected) { setError('Chưa chọn embedding provider'); return }
    if (!selected.connected) {
      setError(`Provider "${selected.label}" chưa kết nối. Vào Cài đặt → AI Providers trước.`)
      return
    }
    setSaving(true); setError(null)
    try {
      const r = await api<{ knowledge_base: KB }>('/api/knowledge', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || undefined,
          embedding_provider: selected.id,
          embedding_model: selected.embedding_model,
          embedding_dim: selected.embedding_dim,
        }),
      })
      onCreated(r.knowledge_base)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title="Tạo Kho kiến thức mới" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Tên KB *">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Trợ lý bán khoá học AI"
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none" />
        </Field>
        <Field label="Slug (URL-friendly, tự sinh nếu trống)">
          <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="vd-tro-ly-ban-khoa-hoc-ai"
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white font-mono focus:border-neutral-600 outline-none" />
        </Field>
        <Field label="Mô tả">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none resize-none"
            placeholder="Ngắn gọn KB này dùng để làm gì" />
        </Field>

        <Field label="Embedding provider">
          {providers.length === 0 ? (
            <div className="text-xs text-neutral-500 px-3 py-2 rounded bg-neutral-900 border border-neutral-800">
              Đang tải danh sách provider...
            </div>
          ) : (
            <>
              <select value={providerId} onChange={e => setProviderId(e.target.value)}
                className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none">
                {providers.map(p => (
                  <option key={p.id} value={p.id} disabled={!p.connected}>
                    {p.label} · {p.embedding_dim}d {p.connected ? '' : '(chưa kết nối)'}
                  </option>
                ))}
              </select>
              {selected && (
                <div className="mt-1.5 text-[11px] text-neutral-500 flex items-center gap-2">
                  <span>Model: <code className="text-neutral-400">{selected.embedding_model}</code></span>
                  {!selected.connected && (
                    <a href={selected.docs_url} target="_blank" rel="noopener noreferrer"
                       className="text-amber-400 hover:underline">Lấy API key →</a>
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-neutral-600">
                Đổi provider = KB mới hoàn toàn. Không thể đổi sau khi tạo (mỗi KB gắn 1 dim).
              </p>
            </>
          )}
        </Field>

        {error && <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} /> {error}</div>}
      </div>

      <div className="flex items-center justify-end gap-2 mt-5">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-neutral-800 text-neutral-400 hover:border-neutral-600">Huỷ</button>
        <button onClick={handleSave} disabled={saving || !selected?.connected} className="text-sm px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200 disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 size={12} className="animate-spin" />}
          <Save size={12} /> Tạo KB
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Entry Editor modal ──────────────────────────────────────────────────────

const EntryEditor: React.FC<{
  kbId: string
  mode: 'create' | 'edit'
  initial: EntryDetail | null
  onClose: () => void
  onSaved: () => void
}> = ({ kbId, mode, initial, onClose, onSaved }) => {
  const [title, setTitle] = useState(initial?.title || '')
  const [summary, setSummary] = useState(initial?.summary || '')
  const [category, setCategory] = useState(initial?.category || '')
  const [filename, setFilename] = useState(initial?.filename || '')
  const [tags, setTags] = useState<string[]>(initial?.tags || [])
  const [content, setContent] = useState(initial?.content || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualFilename, setManualFilename] = useState(mode === 'edit')

  // Auto-generate filename from title if user hasn't edited it
  useEffect(() => {
    if (manualFilename) return
    const slug = title.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    setFilename(slug ? `${slug}.md` : '')
  }, [title, manualFilename])

  const handleSave = async () => {
    if (!title.trim()) { setError('Title bắt buộc'); return }
    if (!summary.trim()) { setError('Summary bắt buộc'); return }
    if (!content.trim()) { setError('Content không được rỗng'); return }

    setSaving(true); setError(null)
    try {
      const body: any = {
        title: title.trim(),
        summary: summary.trim(),
        content,
        filename: filename.trim(),
        category: category.trim() || null,
        tags,
      }
      if (mode === 'create') {
        body.kb_id = kbId
        body.source_kind = 'manual'
        const r = await api<{ entry: any; embed_error?: string }>('/api/knowledge/entries', {
          method: 'POST', body: JSON.stringify(body),
        })
        if (r.embed_error) alert(`Đã lưu entry nhưng embed lỗi: ${r.embed_error}. Bấm "Re-embed" để thử lại.`)
      } else {
        const r = await api<{ entry: any; embed_error?: string }>(`/api/knowledge/entries?id=${initial!.id}`, {
          method: 'PATCH', body: JSON.stringify(body),
        })
        if (r.embed_error) alert(`Đã lưu nhưng re-embed lỗi: ${r.embed_error}`)
      }
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title={mode === 'create' ? 'Entry mới' : `Sửa: ${initial?.filename}`} onClose={onClose} wide>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 space-y-3">
          <Field label="Title *">
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none" />
          </Field>
          <Field label={`Summary * (${summary.length}/280)`}>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} maxLength={280}
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none resize-none" />
          </Field>
          <Field label="Content (markdown)">
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={16}
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none font-mono leading-relaxed"
              placeholder="# Heading\n\nMarkdown content..." />
            <div className="text-[10px] text-neutral-600 mt-1">Hỗ trợ markdown. ~500 từ / chunk sẽ được chia tự động khi embed.</div>
          </Field>
        </div>

        <div className="space-y-3">
          <Field label="Filename (.md)">
            <input value={filename}
              onChange={e => { setManualFilename(true); setFilename(e.target.value) }}
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white font-mono focus:border-neutral-600 outline-none" />
            <div className="text-[10px] text-neutral-600 mt-1">Tự sinh từ title. Kebab-case, phải unique trong KB.</div>
          </Field>
          <Field label="Category (kebab-case)">
            <input value={category} onChange={e => setCategory(e.target.value)}
              placeholder="vd: onboarding"
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white font-mono focus:border-neutral-600 outline-none" />
          </Field>
          <Field label="Tags">
            <TagsEditor value={tags} onChange={setTags} placeholder="Enter để thêm" maxTags={10} />
          </Field>
        </div>
      </div>

      {error && <div className="mt-3 text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} /> {error}</div>}

      <div className="flex items-center justify-end gap-2 mt-5">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-neutral-800 text-neutral-400 hover:border-neutral-600">Huỷ</button>
        <button onClick={handleSave} disabled={saving} className="text-sm px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200 disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 size={12} className="animate-spin" />}
          <Save size={12} /> Lưu {mode === 'create' ? '+ embed' : '(re-embed nếu content đổi)'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Distill modal (Karpathy ingestion) ──────────────────────────────────────

const DistillModal: React.FC<{ kbId: string; onClose: () => void; onDone: () => void }> = ({ kbId, onClose, onDone }) => {
  const [tab, setTab] = useState<'paste' | 'url' | 'pdf' | 'image'>('paste')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [fileB64, setFileB64] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileMime, setFileMime] = useState('')
  const [productHint, setProductHint] = useState('')
  const [status, setStatus] = useState<'idle' | 'uploading' | 'ingesting' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ entries_created: number; entry_ids: string[]; distill_notes?: string } | null>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'pdf' | 'image') => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    // Size guard: 15MB — Vercel/api body limit is 20MB
    if (file.size > 15 * 1024 * 1024) {
      setError(`File quá lớn (${(file.size / 1024 / 1024).toFixed(1)}MB). Tối đa 15MB.`)
      return
    }
    // Basic MIME check
    if (kind === 'pdf' && !/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      setError('File không phải PDF.')
      return
    }
    if (kind === 'image' && !file.type.startsWith('image/')) {
      setError('File không phải ảnh.')
      return
    }
    setStatus('uploading')
    // Read as base64 data URL
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(new Error('Read file failed'))
      r.readAsDataURL(file)
    })
    setFileB64(b64)
    setFileName(file.name)
    setFileMime(file.type || (kind === 'pdf' ? 'application/pdf' : 'image/jpeg'))
    setStatus('idle')
  }

  const handleIngest = async () => {
    setError(null); setResult(null)
    const payload: any = { source_ref: null }
    if (tab === 'paste') {
      if (!text.trim()) { setError('Nội dung rỗng'); return }
      payload.kind = 'text'
      payload.text = text
    } else if (tab === 'url') {
      if (!url.trim()) { setError('Nhập URL'); return }
      payload.kind = 'url'
      payload.url = url.trim()
    } else if (tab === 'pdf') {
      if (!fileB64) { setError('Chọn file PDF trước'); return }
      payload.kind = 'pdf'
      payload.file_base64 = fileB64
      payload.mime_type = 'application/pdf'
      payload.source_ref = { kind: 'pdf', filename: fileName }
    } else if (tab === 'image') {
      if (!fileB64) { setError('Chọn ảnh trước'); return }
      payload.kind = 'image'
      payload.file_base64 = fileB64
      payload.mime_type = fileMime
      payload.source_ref = { kind: 'image', filename: fileName }
    }
    if (productHint.trim()) payload.product_hint = productHint.trim()

    setStatus('ingesting')
    try {
      const r = await api<any>(`/api/knowledge/ingest?kb_id=${encodeURIComponent(kbId)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setResult(r)
      setStatus('done')
    } catch (e: any) {
      setError(e.message)
      setStatus('idle')
    }
  }

  const busy = status === 'uploading' || status === 'ingesting'

  return (
    <ModalShell title="Nhập nội dung vào KB (tự distill + embed)" onClose={onClose} wide>
      {/* Tabs — 4 input modes, all pipe through /api/knowledge/ingest (raw file never persisted) */}
      <div className="flex items-center gap-1 border-b border-neutral-800 mb-3 flex-wrap">
        {[
          { id: 'paste', label: 'Paste text' },
          { id: 'url',   label: 'URL' },
          { id: 'pdf',   label: 'PDF' },
          { id: 'image', label: 'Ảnh (OCR)' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id as any); setError(null); setFileB64(''); setFileName('') }}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-green-900 bg-green-950/30 text-green-300 text-sm px-4 py-3 flex items-center gap-2">
            <CheckCircle2 size={16} /> Đã tạo {result.entries_created} entries {result.distill_notes && <span className="text-neutral-400">· {result.distill_notes}</span>}
          </div>
          <div className="text-xs text-neutral-500">
            {result.entry_ids.length} entry_id: <code className="text-neutral-400">{result.entry_ids.slice(0, 3).join(', ')}{result.entry_ids.length > 3 ? '...' : ''}</code>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setResult(null); setText(''); setUrl(''); setFileB64(''); setFileName('') }}
              className="text-sm px-3 py-1.5 rounded border border-neutral-800 text-neutral-400 hover:border-neutral-600">
              Nhập thêm
            </button>
            <button onClick={onDone} className="text-sm px-3 py-1.5 rounded bg-white text-black font-medium">Xong</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {tab === 'paste' && (
            <Field label="Nội dung thô (bài viết, transcript, ghi chú)">
              <textarea value={text} onChange={e => setText(e.target.value)} rows={12}
                className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none font-mono leading-relaxed"
                placeholder="Dán vào đây..." />
            </Field>
          )}

          {tab === 'url' && (
            <Field label="URL bài viết / trang web">
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
                className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white font-mono focus:border-neutral-600 outline-none" />
              <div className="text-[10px] text-neutral-600 mt-1">
                Server sẽ fetch + trích xuất bài viết chính (Readability). Content SPA (Vue/React render) có thể không lấy được.
              </div>
            </Field>
          )}

          {tab === 'pdf' && (
            <div className="rounded-lg border-2 border-dashed border-neutral-800 p-6 text-center">
              <input type="file" accept="application/pdf,.pdf"
                onChange={e => handleFileUpload(e, 'pdf')}
                className="text-xs text-neutral-400" />
              {fileName ? (
                <div className="mt-3 text-xs text-neutral-300">
                  <FileText size={14} className="inline mr-1" /> {fileName}
                  <div className="text-[10px] text-neutral-600 mt-1">Server sẽ trích text từ PDF, KHÔNG lưu file.</div>
                </div>
              ) : (
                <p className="text-[11px] text-neutral-600 mt-2">Tối đa 15MB. File KHÔNG được lưu — chỉ text trích ra + KB entries.</p>
              )}
            </div>
          )}

          {tab === 'image' && (
            <div className="rounded-lg border-2 border-dashed border-neutral-800 p-6 text-center">
              <input type="file" accept="image/*"
                onChange={e => handleFileUpload(e, 'image')}
                className="text-xs text-neutral-400" />
              {fileName ? (
                <div className="mt-3 text-xs text-neutral-300">
                  <FileText size={14} className="inline mr-1" /> {fileName}
                  <div className="text-[10px] text-neutral-600 mt-1">Vision LLM sẽ OCR + mô tả visual (cần OpenAI hoặc Gemini kết nối).</div>
                </div>
              ) : (
                <p className="text-[11px] text-neutral-600 mt-2">
                  OCR + mô tả bằng vision LLM (GPT-4o hoặc Gemini). Cần kết nối 1 trong 2 trong Cài đặt → AI Providers.
                  File KHÔNG được lưu.
                </p>
              )}
            </div>
          )}

          <Field label="Product hint (tuỳ chọn)">
            <input value={productHint} onChange={e => setProductHint(e.target.value)}
              placeholder="VD: khoá học AI Agent cho creator"
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none" />
            <div className="text-[10px] text-neutral-600 mt-1">Giúp AI đặt tag/category phù hợp với sản phẩm.</div>
          </Field>

          {error && <div className="text-xs text-red-400 flex items-start gap-1"><AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}</div>}

          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-neutral-800 text-neutral-400 hover:border-neutral-600">Huỷ</button>
            <button
              onClick={handleIngest}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              <Sparkles size={12} /> {status === 'uploading' ? 'Đang đọc file...' : status === 'ingesting' ? 'Đang trích + distill (~15-45s)...' : 'Trích + Distill + Lưu'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

// ─── Product Attach modal ────────────────────────────────────────────────────

const ProductAttachModal: React.FC<{ kbId: string; onClose: () => void }> = ({ kbId, onClose }) => {
  const [products, setProducts] = useState<Product[]>([])
  const [attached, setAttached] = useState<Set<string>>(new Set())
  const [initial, setInitial] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null)
      try {
        const [{ data: prods }, links] = await Promise.all([
          supabase.from('products').select('id, name, type, status').order('name'),
          api<{ links: any[] }>(`/api/knowledge/attach?kb_id=${kbId}`),
        ])
        setProducts((prods || []) as Product[])
        const s = new Set<string>((links.links || []).map(l => l.product_id))
        setAttached(s); setInitial(new Set(s))
      } catch (e: any) { setError(e.message) }
      finally { setLoading(false) }
    })()
  }, [kbId])

  const toggle = (pid: string) => {
    const next = new Set(attached)
    if (next.has(pid)) next.delete(pid); else next.add(pid)
    setAttached(next)
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      // Adds = attached \ initial ; Removes = initial \ attached
      const adds = [...attached].filter(x => !initial.has(x))
      const removes = [...initial].filter(x => !attached.has(x))
      for (const pid of adds) {
        await api('/api/knowledge/attach', { method: 'POST', body: JSON.stringify({ product_id: pid, kb_id: kbId }) })
      }
      for (const pid of removes) {
        await api(`/api/knowledge/attach?product_id=${pid}&kb_id=${kbId}`, { method: 'DELETE' })
      }
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title="Gán KB vào sản phẩm" onClose={onClose}>
      {loading ? <LoadingState /> : products.length === 0 ? (
        <EmptyState icon={Package} title="Chưa có sản phẩm nào" description="Tạo sản phẩm trong tab Sản phẩm trước." />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500 mb-2">Chọn sản phẩm sẽ được RAG-hỗ trợ bởi KB này.</p>
          <ul className="rounded-lg border border-neutral-800 divide-y divide-neutral-900 max-h-80 overflow-y-auto">
            {products.map(p => (
              <li key={p.id}>
                <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-neutral-900/60">
                  <input
                    type="checkbox"
                    checked={attached.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="rounded"
                  />
                  <Package size={14} className="text-neutral-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{p.name}</div>
                    <div className="text-[11px] text-neutral-500">{p.type} · {p.status}</div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          {error && <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} /> {error}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-neutral-800 text-neutral-400">Huỷ</button>
            <button onClick={handleSave} disabled={saving} className="text-sm px-3 py-1.5 rounded bg-white text-black font-medium disabled:opacity-50 flex items-center gap-1.5">
              {saving && <Loader2 size={12} className="animate-spin" />} Lưu
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

// ─── Retrieve test modal (quick sanity-check) ────────────────────────────────

const RetrieveTestModal: React.FC<{ kbId: string; onClose: () => void }> = ({ kbId, onClose }) => {
  const [q, setQ] = useState('')
  const [chunks, setChunks] = useState<RagChunk[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRun = async () => {
    if (!q.trim()) return
    setLoading(true); setError(null); setChunks(null)
    try {
      const r = await api<{ chunks: RagChunk[] }>('/api/knowledge/retrieve', {
        method: 'POST',
        body: JSON.stringify({ kb_ids: [kbId], query: q, top_k: 5 }),
      })
      setChunks(r.chunks)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <ModalShell title="Thử RAG retrieve" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRun() }}
            placeholder="Câu hỏi hoặc keyword..."
            className="flex-1 px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-sm text-white focus:border-neutral-600 outline-none" />
          <button onClick={handleRun} disabled={loading || !q.trim()} className="text-sm px-3 py-1.5 rounded bg-white text-black font-medium disabled:opacity-50 flex items-center gap-1.5">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Retrieve
          </button>
        </div>
        {error && <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} /> {error}</div>}
        {chunks && chunks.length === 0 && <p className="text-sm text-neutral-500">Không có kết quả. KB có thể trống hoặc chưa embed.</p>}
        {chunks && chunks.length > 0 && (
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {chunks.map(c => (
              <li key={c.chunk_id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono text-neutral-500 truncate flex-1">{c.entry_filename}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">score {c.score.toFixed(3)}</span>
                </div>
                <div className="text-sm text-neutral-100 mb-1">{c.entry_title}</div>
                <div className="text-xs text-neutral-400 whitespace-pre-wrap line-clamp-6 leading-relaxed">{c.chunk_text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  )
}

// ─── shared bits ─────────────────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <div className="text-xs font-medium text-neutral-400 mb-1.5">{label}</div>
    {children}
  </label>
)

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className={`bg-neutral-950 border border-neutral-800 rounded-xl w-full ${wide ? 'max-w-4xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 sticky top-0 bg-neutral-950 z-10">
        <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
        <button onClick={onClose} className="text-neutral-500 hover:text-white"><X size={16} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
)
