import React, { useState, useEffect, useCallback } from 'react'
import { Sparkles, Plus, Loader2, Eye, Edit2, Trash2, ExternalLink, Copy, Check, RefreshCw, Send, ChevronLeft, Zap, X } from 'lucide-react'
import { supabase } from '../../services/supabase'

type FunnelType = 'sales' | 'leads' | 'webinar'
type Status = 'draft' | 'published' | 'archived'

interface FunnelListItem {
  id: string
  slug: string
  name: string
  type: FunnelType
  status: Status
  visits: number
  cta_clicks: number
  form_submits: number
  updated_at: string
}

interface FunnelDetail extends FunnelListItem {
  copy_input: Record<string, any>
  html: string | null
  generation_meta: Record<string, any>
  custom_domain: string | null
  created_at: string
  published_at: string | null
}

async function apiCall<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

// ══════════════════════════════════════════════════════════════════════════
// LIST VIEW
// ══════════════════════════════════════════════════════════════════════════
function FunnelsList({ onNew, onEdit }: { onNew: () => void; onEdit: (id: string) => void }) {
  const [funnels, setFunnels] = useState<FunnelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<'all' | FunnelType>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiCall<{ funnels: FunnelListItem[] }>('/api/funnels/save')
      setFunnels(r.funnels)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (id: string, name: string) => {
    if (!confirm(`Xoá funnel "${name}"?`)) return
    await apiCall(`/api/funnels/save?id=${id}`, { method: 'DELETE' })
    load()
  }

  const publish = async (id: string) => {
    await apiCall(`/api/funnels/save?action=publish&id=${id}`, { method: 'POST' })
    load()
  }

  const filtered = filterType === 'all' ? funnels : funnels.filter(f => f.type === filterType)

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6" style={{ color: 'var(--color-mission-accent)' }} />
            AI Funnel Builder
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Nhập copy → AI sinh landing page → publish tại <code>/f/&lt;slug&gt;</code>
          </p>
        </div>
        <button
          onClick={onNew}
          style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          className="inline-flex items-center gap-2 px-5 py-2.5 font-semibold rounded-lg hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" /> Tạo funnel mới
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['all', 'sales', 'leads', 'webinar'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              filterType === t ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-500 hover:text-white'
            }`}
          >
            {t === 'all' ? 'Tất cả' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-500">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Đang tải...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-neutral-800 rounded-xl">
          <Sparkles className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
          <p className="text-neutral-500 mb-4">Chưa có funnel nào.</p>
          <button
            onClick={onNew}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> Tạo funnel đầu tiên
          </button>
        </div>
      ) : (
        <div className="border border-neutral-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/50 text-neutral-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Tên</th>
                <th className="text-left px-4 py-3">Slug</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Visits</th>
                <th className="text-right px-4 py-3">CTA</th>
                <th className="text-right px-4 py-3">Forms</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map(f => (
                <tr key={f.id} className="hover:bg-neutral-900/30">
                  <td className="px-4 py-3 font-medium">{f.name}</td>
                  <td className="px-4 py-3 text-neutral-500 font-mono text-xs">/f/{f.slug}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 bg-neutral-800 rounded">{f.type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      f.status === 'published' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                      f.status === 'archived' ? 'bg-neutral-700/30 text-neutral-500 border-neutral-700' :
                      'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}>{f.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.visits}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.cta_clicks}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.form_submits}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {f.status === 'published' && (
                        <a href={`/f/${f.slug}`} target="_blank" rel="noopener noreferrer"
                           className="p-1.5 hover:bg-neutral-800 rounded" title="View live">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button onClick={() => onEdit(f.id)} className="p-1.5 hover:bg-neutral-800 rounded" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {f.status !== 'published' && (
                        <button onClick={() => publish(f.id)} className="p-1.5 hover:bg-neutral-800 rounded" title="Publish">
                          <Send className="w-4 h-4 text-green-400" />
                        </button>
                      )}
                      <button onClick={() => del(f.id, f.name)} className="p-1.5 hover:bg-neutral-800 rounded" title="Delete">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// BUILDER (create/edit)
// ══════════════════════════════════════════════════════════════════════════
function FunnelBuilder({ id, onBack }: { id: string | null; onBack: () => void }) {
  const [type, setType] = useState<FunnelType>('sales')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [copyInput, setCopyInput] = useState<Record<string, string>>({})
  const [html, setHtml] = useState('')
  const [meta, setMeta] = useState<any>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('draft')

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [iterationText, setIterationText] = useState('')
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview')
  const [error, setError] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)

  // Load existing if editing
  useEffect(() => {
    if (!id) return
    apiCall<FunnelDetail>(`/api/funnels/save?id=${id}`).then(f => {
      setType(f.type)
      setName(f.name)
      setSlug(f.slug)
      setCopyInput((f.copy_input as any) || {})
      setHtml(f.html || '')
      setMeta(f.generation_meta || null)
      setSavedId(f.id)
      setStatus(f.status)
    }).catch(e => setError(e.message))
  }, [id])

  const setField = (k: string, v: string) => setCopyInput(prev => ({ ...prev, [k]: v }))

  const doGenerate = async (iteration = false) => {
    setError(null)
    setGenerating(true)
    try {
      const body: any = { type, input: copyInput }
      if (iteration && savedId) {
        body.funnel_id = savedId
        body.iteration_instruction = iterationText
      }
      const r = await apiCall<{ html: string; meta: any }>('/api/funnels/generate', {
        method: 'POST', body: JSON.stringify(body)
      })
      setHtml(r.html)
      setMeta(r.meta)
      if (iteration) setIterationText('')
    } catch (e: any) { setError(e.message) }
    finally { setGenerating(false) }
  }

  const doSave = async (statusOverride?: Status) => {
    setError(null)
    setSaving(true)
    try {
      const body: any = {
        name, slug: slug || undefined, type, status: statusOverride || status,
        copy_input: copyInput, html, generation_meta: meta,
      }
      if (savedId) body.id = savedId
      const saved = await apiCall<FunnelDetail>('/api/funnels/save', {
        method: 'POST', body: JSON.stringify(body)
      })
      setSavedId(saved.id)
      setSlug(saved.slug)
      setStatus(saved.status)
      if (statusOverride === 'published') alert(`✓ Đã publish tại /f/${saved.slug}`)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const doPublish = async () => {
    if (!savedId) { await doSave('published'); return }
    await apiCall(`/api/funnels/save?action=publish&id=${savedId}`, { method: 'POST' })
    setStatus('published')
    alert(`✓ Đã publish tại /f/${slug}`)
  }

  const publicUrl = slug ? `${window.location.origin}/f/${slug}` : ''

  return (
    <div className="max-w-full mx-auto py-4 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-neutral-800 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-neutral-800 rounded">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold">{savedId ? name || 'Edit funnel' : 'Tạo funnel mới'}</h1>
            {publicUrl && status === 'published' && (
              <div className="flex items-center gap-2 mt-1">
                <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:underline">
                  {publicUrl}
                </a>
                <button onClick={() => { navigator.clipboard.writeText(publicUrl); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000) }}
                        className="text-xs text-neutral-500 hover:text-white">
                  {copiedUrl ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => doSave()}
            disabled={saving || !name}
            className="px-4 py-2 border border-neutral-700 rounded-lg hover:bg-neutral-800 disabled:opacity-40 text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save draft'}
          </button>
          <button
            onClick={doPublish}
            disabled={!html || saving}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 text-sm"
          >
            <Send className="w-4 h-4" /> {status === 'published' ? 'Update live' : 'Publish'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* Left: input form */}
        <div className="col-span-5 space-y-4 pr-2 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Tên funnel *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Slug (URL)</label>
            <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="auto từ tên nếu bỏ trống"
              className="w-full mt-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Loại funnel</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(['sales', 'leads', 'webinar'] as FunnelType[]).map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-3 py-2 text-sm rounded-lg border transition ${
                    type === t ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:border-neutral-700'
                  }`}
                  style={type === t ? { borderColor: 'var(--color-mission-accent)', color: 'var(--color-mission-accent)' } : undefined}
                >{t}</button>
              ))}
            </div>
          </div>

          {/* Common fields */}
          <TextField label="Tên sản phẩm" k="productName" v={copyInput.productName} onChange={setField} />
          <TextArea label="Target audience" k="audience" v={copyInput.audience} onChange={setField} rows={2} />
          <TextArea label="Nỗi đau chính" k="painPoints" v={copyInput.painPoints} onChange={setField} rows={3} />
          <TextField label="Big promise (headline)" k="bigPromise" v={copyInput.bigPromise} onChange={setField} />
          <TextArea label="USP (unique selling point)" k="usp" v={copyInput.usp} onChange={setField} rows={2} />
          <TextField label="CTA text" k="cta" v={copyInput.cta} onChange={setField} placeholder="Đăng ký ngay" />
          <TextField label="Brand color (hex)" k="brandColor" v={copyInput.brandColor} onChange={setField} placeholder="#B6FF00" />

          {/* Type-specific */}
          {type === 'sales' && (<>
            <TextArea label="Offer (mô tả sản phẩm/khóa học)" k="offer" v={copyInput.offer} onChange={setField} rows={3} />
            <TextField label="Giá (VD: 997.000đ)" k="pricing" v={copyInput.pricing} onChange={setField} />
            <TextArea label="Bonuses (nếu có)" k="bonuses" v={copyInput.bonuses} onChange={setField} rows={3} />
            <TextField label="Guarantee (VD: hoàn 100% trong 30 ngày)" k="guarantee" v={copyInput.guarantee} onChange={setField} />
            <TextArea label="Testimonials (nếu có)" k="testimonials" v={copyInput.testimonials} onChange={setField} rows={3} />
            <TextField label="Urgency (VD: còn 5 slot, hết hạn 20/08)" k="urgency" v={copyInput.urgency} onChange={setField} />
          </>)}
          {type === 'leads' && (<>
            <TextField label="Tên lead magnet" k="leadMagnetName" v={copyInput.leadMagnetName} onChange={setField} />
            <TextArea label="Benefit chính của lead magnet" k="leadMagnetBenefit" v={copyInput.leadMagnetBenefit} onChange={setField} rows={3} />
          </>)}
          {type === 'webinar' && (<>
            <TextField label="Tên webinar" k="webinarTitle" v={copyInput.webinarTitle} onChange={setField} />
            <TextField label="Ngày giờ (VD: 20h 25/08/2026)" k="webinarDate" v={copyInput.webinarDate} onChange={setField} />
            <TextField label="Speaker" k="webinarSpeaker" v={copyInput.webinarSpeaker} onChange={setField} />
            <TextArea label="Agenda" k="webinarAgenda" v={copyInput.webinarAgenda} onChange={setField} rows={3} />
          </>)}

          <button
            onClick={() => doGenerate(false)}
            disabled={generating || !copyInput.productName}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {html ? 'Regenerate từ đầu' : 'Generate với AI'}
          </button>

          {html && (
            <div className="pt-3 border-t border-neutral-800 space-y-2">
              <label className="text-xs text-neutral-500 uppercase tracking-wider">Iterate — nói cho AI biết muốn sửa gì</label>
              <textarea value={iterationText} onChange={e => setIterationText(e.target.value)}
                placeholder='VD: "đổi màu CTA thành xanh dương", "thêm section FAQ", "làm testimonials nổi bật hơn"'
                rows={3}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" />
              <button
                onClick={() => doGenerate(true)}
                disabled={generating || !iterationText || !savedId}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-neutral-700 rounded-lg hover:bg-neutral-800 disabled:opacity-40 text-sm"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Iterate {!savedId && '(save trước để iterate)'}
              </button>
            </div>
          )}
        </div>

        {/* Right: preview */}
        <div className="col-span-7 border border-neutral-800 rounded-xl overflow-hidden bg-white flex flex-col max-h-[calc(100vh-200px)]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900">
            <div className="flex gap-1">
              {(['preview', 'code'] as const).map(m => (
                <button key={m} onClick={() => setPreviewMode(m)}
                  className={`px-3 py-1 text-xs rounded transition ${
                    previewMode === m ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-white'
                  }`}>{m}</button>
              ))}
            </div>
            {meta && (
              <span className="text-xs text-neutral-500">
                {meta.model} · {meta.outputTokens || '?'} tokens
              </span>
            )}
          </div>
          {generating ? (
            <div className="flex-1 flex items-center justify-center bg-neutral-950 text-neutral-500">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: 'var(--color-mission-accent)' }} />
                <p className="text-sm">AI đang generate... (~15-30s)</p>
              </div>
            </div>
          ) : !html ? (
            <div className="flex-1 flex items-center justify-center bg-neutral-950 text-neutral-600">
              <div className="text-center px-8">
                <Eye className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Điền form bên trái + bấm Generate để xem preview</p>
              </div>
            </div>
          ) : previewMode === 'preview' ? (
            <iframe srcDoc={html} className="flex-1 w-full bg-white" title="Preview" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <pre className="flex-1 overflow-auto p-3 bg-neutral-950 text-neutral-300 text-xs font-mono whitespace-pre-wrap">{html}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

function TextField({ label, k, v, onChange, placeholder }: { label: string; k: string; v?: string; onChange: (k: string, v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs text-neutral-500 uppercase tracking-wider">{label}</label>
      <input value={v || ''} onChange={e => onChange(k, e.target.value)} placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" />
    </div>
  )
}
function TextArea({ label, k, v, onChange, rows = 2 }: { label: string; k: string; v?: string; onChange: (k: string, v: string) => void; rows?: number }) {
  return (
    <div>
      <label className="text-xs text-neutral-500 uppercase tracking-wider">{label}</label>
      <textarea value={v || ''} onChange={e => onChange(k, e.target.value)} rows={rows}
        className="w-full mt-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm resize-y" />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT: switches between list + builder
// ══════════════════════════════════════════════════════════════════════════
export default function AIFunnelsView() {
  const [mode, setMode] = useState<'list' | 'builder'>('list')
  const [editId, setEditId] = useState<string | null>(null)

  if (mode === 'builder') {
    return <FunnelBuilder id={editId} onBack={() => { setMode('list'); setEditId(null) }} />
  }
  return <FunnelsList
    onNew={() => { setEditId(null); setMode('builder') }}
    onEdit={id => { setEditId(id); setMode('builder') }}
  />
}
