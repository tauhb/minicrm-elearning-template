import React, { useState, useEffect, useCallback } from 'react'
import { Sparkles, Plus, Loader2, Eye, Edit2, Trash2, ExternalLink, Send, ChevronLeft, Layers, Wand2, FileCode2, X, Check, ArrowRight, Copy, Save, Zap, ArrowUp, ArrowDown, Settings2, Tag, CreditCard } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { StylePicker, StylePreset } from './funnels/StylePicker'
import { ContentDraftEditor, CopyDraft, ensureBlockIds, newBlockId } from './funnels/ContentDraftEditor'
import { PaymentConfigDrawer } from './funnels/PaymentConfigDrawer'
import { PreviewFlowModal } from './funnels/PreviewFlowModal'
import { FormFieldsEditor, FormField } from './funnels/FormFieldsEditor'
import { AddBlockModal } from './funnels/AddBlockModal'

type Status = 'draft' | 'published' | 'archived'

interface FunnelListItem {
  id: string; slug: string; name: string; type_key: string; status: Status
  style_preset?: StylePreset; created_at: string; updated_at: string; published_at?: string
}
interface FunnelDetail extends FunnelListItem {
  shared_context: Record<string, any>
  custom_prompt: string | null
  payment_mode: string
  payment_config: any
  tags_to_apply: string[]
  custom_domain: string | null
  steps: StepDetail[]
}
interface StepDetail {
  id: string; funnel_id: string; step_number: number; slug: string; name: string; page_type: string
  content_source: 'ai_draft' | 'ai_direct' | 'imported' | 'blank'
  has_form: boolean; form_mode: string; form_fields: any[]; form_success_step_slug?: string
  copy_input: any; copy_formula_key?: string; copy_raw_input?: string
  copy_draft?: CopyDraft; copy_approved: boolean; copy_approved_at?: string
  html?: string; html_generated_from_copy_at?: string
  html_blocks?: any[]
  render_instructions?: string | null
  visits: number; cta_clicks: number; form_submits: number
}
interface FunnelType { id: string; key: string; name: string; icon: string; color: string; description: string; suggested_steps: any[] }
interface Formula { id: string; key: string; name: string; description: string }

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
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

// ═══════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════
export default function AIFunnelsView() {
  const [mode, setMode] = useState<'list' | 'detail' | 'wizard'>('list')
  const [detailId, setDetailId] = useState<string | null>(null)

  if (mode === 'wizard') return <FunnelWizard onCancel={() => setMode('list')} onCreated={id => { setDetailId(id); setMode('detail') }} />
  if (mode === 'detail' && detailId) return <FunnelDetailView id={detailId} onBack={() => { setMode('list'); setDetailId(null) }} />
  return <FunnelsList onNew={() => setMode('wizard')} onOpen={id => { setDetailId(id); setMode('detail') }} />
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════
function FunnelsList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [funnels, setFunnels] = useState<FunnelListItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<{ funnels: FunnelListItem[] }>('/api/funnel-flows')
      setFunnels(r.funnels)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (id: string, name: string) => {
    if (!confirm(`Xoá funnel "${name}" (kèm tất cả steps)?`)) return
    await api(`/api/funnel-flows?id=${id}`, { method: 'DELETE' })
    load()
  }

  const publish = async (id: string) => {
    await api(`/api/funnel-flows?action=publish&id=${id}`, { method: 'POST' })
    load()
  }

  return (
    <div className="max-w-full py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6" style={{ color: 'var(--color-mission-accent)' }} />
            AI Funnels
          </h1>
          <p className="text-sm text-neutral-500 mt-1">Multi-step funnel builder — content-first workflow.</p>
        </div>
        <button onClick={onNew}
          style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          className="inline-flex items-center gap-2 px-5 py-2.5 font-semibold rounded-lg hover:opacity-90">
          <Plus className="w-4 h-4" /> Tạo funnel mới
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : funnels.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-neutral-800 rounded-xl">
          <Sparkles className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
          <p className="text-neutral-500 mb-4">Chưa có funnel nào.</p>
          <button onClick={onNew}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg hover:opacity-90">
            <Plus className="w-4 h-4" /> Tạo funnel đầu tiên
          </button>
        </div>
      ) : (
        <div className="border border-neutral-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/50 text-neutral-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Slug</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {funnels.map(f => (
                <tr key={f.id} className="hover:bg-neutral-900/30 cursor-pointer" onClick={() => onOpen(f.id)}>
                  <td className="px-4 py-3 font-medium">{f.name}</td>
                  <td className="px-4 py-3 text-neutral-500 font-mono text-xs">/f/{f.slug}</td>
                  <td className="px-4 py-3 text-xs">{f.type_key}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      f.status === 'published' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                      f.status === 'archived' ? 'bg-neutral-700/30 text-neutral-500 border-neutral-700' :
                      'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}>{f.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{new Date(f.updated_at).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {f.status === 'published' && (
                        <a href={`/f/${f.slug}`} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-neutral-800 rounded" title="View live"><ExternalLink className="w-4 h-4" /></a>
                      )}
                      <button onClick={() => onOpen(f.id)} className="p-1.5 hover:bg-neutral-800 rounded" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      {f.status !== 'published' && (
                        <button onClick={() => publish(f.id)} className="p-1.5 hover:bg-neutral-800 rounded" title="Publish"><Send className="w-4 h-4 text-green-400" /></button>
                      )}
                      <button onClick={() => del(f.id, f.name)} className="p-1.5 hover:bg-neutral-800 rounded" title="Delete"><Trash2 className="w-4 h-4 text-red-400" /></button>
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

// ═══════════════════════════════════════════════════════════════════════════
// WIZARD (create new funnel)
// ═══════════════════════════════════════════════════════════════════════════
function FunnelWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [types, setTypes] = useState<FunnelType[]>([])
  const [form, setForm] = useState({
    name: '', slug: '', type_key: '',
    payment_mode: 'collect_only',
    tags_to_apply: [] as string[],
    tag_input: '',
    style_preset: { vibe: 'minimal', fontPair: 'Inter+Playfair Display', layout: 'balanced', density: 'balanced', brandColor: '#B6FF00' } as StylePreset,
    shared_context: '',
    use_custom_prompt: false,
    custom_prompt: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ types: FunnelType[] }>('/api/funnel-types').then(r => {
      setTypes(r.types)
      if (r.types[0]) setForm(f => ({ ...f, type_key: r.types[0].key }))
    })
  }, [])

  const setF = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm(prev => ({ ...prev, [k]: v }))

  const create = async () => {
    setSaving(true); setError(null)
    try {
      const body: any = {
        name: form.name, slug: form.slug || undefined, type_key: form.type_key,
        style_preset: form.style_preset,
        shared_context: parseSharedContext(form.shared_context),
        payment_mode: form.payment_mode,
        tags_to_apply: form.tags_to_apply,
        custom_prompt: form.use_custom_prompt ? form.custom_prompt : null,
        auto_suggest: true,   // Backend auto-creates steps from type
      }
      const created = await api<{ id: string }>('/api/funnel-flows', { method: 'POST', body: JSON.stringify(body) })
      onCreated(created.id)
    } catch (e: any) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onCancel} className="p-2 hover:bg-neutral-800 rounded"><ChevronLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold">Tạo funnel mới</h1>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(n => (
          <React.Fragment key={n}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= n ? 'text-black' : 'bg-neutral-800 text-neutral-500'}`}
              style={step >= n ? { background: 'var(--color-mission-accent)' } : undefined}>
              {step > n ? <Check className="w-4 h-4" /> : n}
            </div>
            {n < 3 && <div className={`flex-1 h-0.5 ${step > n ? '' : 'bg-neutral-800'}`} style={step > n ? { background: 'var(--color-mission-accent)' } : undefined} />}
          </React.Fragment>
        ))}
      </div>

      {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>}

      {/* Step 1: Basic */}
      {step === 1 && (
        <div className="space-y-4 max-w-2xl">
          <h2 className="text-lg font-semibold">Bước 1: Basic info</h2>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Tên funnel *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)} className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" placeholder='VD: "Khoá AI Marketing 30 Ngày"' />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Slug (URL)</label>
            <input value={form.slug} onChange={e => setF('slug', e.target.value)} className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm font-mono" placeholder="auto từ tên nếu bỏ trống" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-2">Loại funnel *</label>
            <div className="grid grid-cols-3 gap-2">
              {types.map(t => (
                <button key={t.id} onClick={() => setF('type_key', t.key)}
                  className={`text-left px-3 py-3 rounded-lg border transition ${form.type_key === t.key ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:border-neutral-700'}`}
                  style={form.type_key === t.key ? { borderColor: 'var(--color-mission-accent)' } : undefined}>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-[10px] text-neutral-500">{t.description}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500 mt-2">Thêm/edit types tại <strong>Settings → Funnel Types</strong>.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Payment mode</label>
              <select value={form.payment_mode} onChange={e => setF('payment_mode', e.target.value)} className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm">
                <option value="collect_only">Chỉ collect info (redirect ngoài để thanh toán)</option>
                <option value="inline_qr">Inline VietQR (hiển thị mã QR ngay trên page)</option>
                <option value="external_checkout">External checkout (Stripe/SePay)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Tag className="w-3 h-3" /> Tags gắn cho leads
              </label>
              <div className="flex flex-wrap gap-1 mb-1">
                {form.tags_to_apply.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-800 text-xs rounded border border-neutral-700">
                    {t}
                    <button onClick={() => setF('tags_to_apply', form.tags_to_apply.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <input value={form.tag_input} onChange={e => setF('tag_input', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    const t = form.tag_input.trim().replace(/,$/, '')
                    if (t && !form.tags_to_apply.includes(t)) setF('tags_to_apply', [...form.tags_to_apply, t])
                    setF('tag_input', '')
                  }
                }}
                className="w-full px-2 py-1.5 bg-neutral-900 border border-neutral-800 rounded text-xs"
                placeholder="Nhấn Enter để thêm tag (VD: khoa-ai, funnel-2026)" />
              <p className="text-[10px] text-neutral-500 mt-1">Sau này Workflow feature dùng tags để tự động actions (email, sequence, notify).</p>
            </div>
          </div>
          <div className="flex justify-between pt-4">
            <button onClick={onCancel} className="text-sm text-neutral-500 hover:text-white">Cancel</button>
            <button onClick={() => setStep(2)} disabled={!form.name || !form.type_key}
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              className="inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
              Tiếp <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Style + prompt */}
      {step === 2 && (
        <div className="space-y-6 max-w-3xl">
          <h2 className="text-lg font-semibold">Bước 2: Style & AI prompt</h2>
          <StylePicker value={form.style_preset} onChange={v => setF('style_preset', v)} />
          <div>
            <label className="flex items-center gap-2 mb-2">
              <input type="checkbox" checked={form.use_custom_prompt} onChange={e => setF('use_custom_prompt', e.target.checked)} />
              <span className="text-sm font-medium">Dùng custom prompt riêng cho funnel này</span>
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Bỏ tick → dùng system prompt của type (~30k chars skill). Tick → viết prompt ngắn của riêng, AI sáng tạo hơn.
            </p>
            {form.use_custom_prompt && (
              <textarea value={form.custom_prompt} onChange={e => setF('custom_prompt', e.target.value)}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                rows={8}
                placeholder="VD: Bạn là copywriter cho brand X. Style trẻ trung, dùng emoji vừa phải. Focus vào transformation story..." />
            )}
          </div>
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="text-sm text-neutral-500 hover:text-white">← Quay lại</button>
            <button onClick={() => setStep(3)}
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              className="inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg hover:opacity-90">
              Tiếp <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Shared context */}
      {step === 3 && (
        <div className="space-y-4 max-w-3xl">
          <h2 className="text-lg font-semibold">Bước 3: Shared context (dùng cho tất cả steps)</h2>
          <p className="text-sm text-neutral-500">
            Nhập thông tin chung về sản phẩm/audience. AI dùng cho MỌI step nên anh không phải điền lại. Format tự do — key: value hoặc mô tả tự nhiên.
          </p>
          <textarea value={form.shared_context} onChange={e => setF('shared_context', e.target.value)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm"
            rows={14}
            placeholder={`productName: Khoá AI Marketing 30 Ngày
audience: Chủ shop online, entrepreneur solo, muốn dùng AI để tăng doanh số
painPoints: Không biết dùng AI, tốn thời gian viết content, không đủ ngân sách thuê copywriter
bigPromise: Sau 30 ngày bạn tự viết được content bằng AI, tiết kiệm 20h/tuần
USP: Chỉ dạy 5 tool AI phải biết, thực hành ngay, có mentor 1-1
pricing: 1.997.000đ (giá gốc 3.997.000đ), trả góp 3 kỳ
guarantee: Hoàn 100% trong 14 ngày nếu không hài lòng
testimonials: Chị Lan tăng đơn 3x sau 2 tuần; Anh Tuấn tự viết được 30 posts/tháng thay vì thuê`}
          />
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(2)} className="text-sm text-neutral-500 hover:text-white">← Quay lại</button>
            <button onClick={create} disabled={saving}
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              className="inline-flex items-center gap-2 px-5 py-2 font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Tạo funnel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function parseSharedContext(text: string): Record<string, any> {
  // Parse "key: value" lines into object; fallback to { raw: text }
  const obj: Record<string, any> = {}
  const lines = text.split('\n')
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/)
    if (m) obj[m[1]] = m[2].trim()
  }
  if (Object.keys(obj).length === 0 && text.trim()) obj.notes = text.trim()
  return obj
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNNEL DETAIL (step timeline)
// ═══════════════════════════════════════════════════════════════════════════
function FunnelDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [funnel, setFunnel] = useState<FunnelDetail | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const f = await api<FunnelDetail>(`/api/funnel-flows?id=${id}`)
      setFunnel(f)
      if (!selectedStepId && f.steps[0]) setSelectedStepId(f.steps[0].id)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [id, selectedStepId])
  useEffect(() => { load() }, [id])

  const suggest = async () => {
    if (!funnel) return
    try {
      await api(`/api/funnel-steps?action=suggest&funnel_id=${funnel.id}`, { method: 'POST' })
      load()
    } catch (e: any) { alert(e.message) }
  }

  const [stepMenuOpen, setStepMenuOpen] = useState<string | null>(null)   // step id
  const [addStepOpen, setAddStepOpen] = useState(false)
  const [paymentDrawerOpen, setPaymentDrawerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const moveStep = async (stepId: string, dir: -1 | 1) => {
    if (!funnel) return
    const ordered = [...funnel.steps].sort((a, b) => a.step_number - b.step_number)
    const idx = ordered.findIndex(s => s.id === stepId)
    if (idx < 0) return
    const j = idx + dir
    if (j < 0 || j >= ordered.length) return
    ;[ordered[idx], ordered[j]] = [ordered[j], ordered[idx]]
    try {
      await api(`/api/funnel-steps?action=reorder&funnel_id=${funnel.id}`, {
        method: 'POST', body: JSON.stringify({ ordered_ids: ordered.map(s => s.id) }),
      })
      load()
    } catch (e: any) { alert(e.message) }
  }

  const deleteStep = async (stepId: string, name: string) => {
    if (!confirm(`Xoá step "${name}"?`)) return
    await api(`/api/funnel-steps?id=${stepId}`, { method: 'DELETE' })
    if (selectedStepId === stepId) setSelectedStepId(null)
    load()
  }

  const renameStep = async (stepId: string) => {
    const step = funnel?.steps.find(s => s.id === stepId)
    if (!step) return
    const newName = prompt('Tên mới:', step.name)
    if (!newName || newName === step.name) return
    await api('/api/funnel-steps', {
      method: 'POST',
      body: JSON.stringify({ id: stepId, funnel_id: step.funnel_id, name: newName, slug: step.slug, page_type: step.page_type }),
    })
    load()
  }

  const changeStepSlug = async (stepId: string) => {
    const step = funnel?.steps.find(s => s.id === stepId)
    if (!step) return
    const newSlug = prompt('Slug mới (URL):', step.slug)
    if (!newSlug || newSlug === step.slug) return
    await api('/api/funnel-steps', {
      method: 'POST',
      body: JSON.stringify({ id: stepId, funnel_id: step.funnel_id, slug: newSlug, name: step.name, page_type: step.page_type }),
    })
    load()
  }

  const addStep = async (page_type: string, name: string, slug: string, has_form = false) => {
    if (!funnel) return
    const maxNum = funnel.steps.reduce((m, s) => Math.max(m, s.step_number), 0)
    await api('/api/funnel-steps', {
      method: 'POST',
      body: JSON.stringify({
        funnel_id: funnel.id, step_number: maxNum + 1,
        slug: slug || `step-${maxNum + 1}`, name, page_type,
        has_form, form_mode: has_form ? 'inline' : 'none',
      }),
    })
    setAddStepOpen(false)
    load()
  }

  const publish = async () => {
    if (!funnel) return
    await api(`/api/funnel-flows?action=publish&id=${funnel.id}`, { method: 'POST' })
    load()
  }

  if (loading) return <div className="text-center py-16 text-neutral-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
  if (!funnel) return <div className="text-center py-16 text-red-400">{error || 'Not found'}</div>

  const selectedStep = funnel.steps.find(s => s.id === selectedStepId) || null

  return (
    <div className="max-w-full px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-neutral-800 rounded"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{funnel.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded border ${
                funnel.status === 'published' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>{funnel.status}</span>
            </div>
            <div className="text-xs text-neutral-500 font-mono">/f/{funnel.slug} · {funnel.type_key}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPreviewOpen(true)} disabled={!funnel.steps.some(s => s.html)}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-neutral-700 rounded-lg hover:bg-neutral-800 disabled:opacity-40"
            title="Preview flow end-to-end (không cần publish)">
            <Eye className="w-3.5 h-3.5" /> Preview flow
          </button>
          <button onClick={() => setPaymentDrawerOpen(true)}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-neutral-700 rounded-lg hover:bg-neutral-800"
            title="Payment settings (VietQR / SePay)">
            <CreditCard className="w-3.5 h-3.5" />
            {funnel.payment_mode === 'inline_qr' ? 'SePay' : 'Payment'}
            {funnel.payment_mode === 'inline_qr' && funnel.payment_config?.account_number && (
              <Check className="w-3 h-3 text-green-400" />
            )}
          </button>
          {funnel.status === 'published' && (
            <a href={`/f/${funnel.slug}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-neutral-700 rounded-lg hover:bg-neutral-800">
              <ExternalLink className="w-3.5 h-3.5" /> View live
            </a>
          )}
          <button onClick={publish} disabled={funnel.steps.some(s => !s.html)}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40" title={funnel.steps.some(s => !s.html) ? 'Cần generate HTML cho tất cả steps' : ''}>
            <Send className="w-4 h-4" /> {funnel.status === 'published' ? 'Update live' : 'Publish'}
          </button>
        </div>
      </div>

      {/* Step timeline */}
      {funnel.steps.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-neutral-800 rounded-xl">
          <Layers className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
          <p className="text-neutral-500 mb-4">Funnel này chưa có step nào.</p>
          <button onClick={suggest}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg hover:opacity-90">
            <Wand2 className="w-4 h-4" /> Suggest steps từ type
          </button>
        </div>
      ) : (
        <>
          {/* Timeline nav */}
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neutral-800 overflow-x-auto">
            {funnel.steps.map((s, i) => (
              <React.Fragment key={s.id}>
                <div className="relative flex items-center gap-1">
                  <button onClick={() => setSelectedStepId(s.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm whitespace-nowrap transition ${
                      selectedStepId === s.id ? '' : 'border-neutral-800 hover:border-neutral-700'
                    }`}
                    style={selectedStepId === s.id ? { borderColor: 'var(--color-mission-accent)', background: 'var(--color-mission-accent)10' } : undefined}>
                    <span className="w-5 h-5 rounded-full bg-neutral-800 text-xs flex items-center justify-center">{s.step_number}</span>
                    <span>{s.name}</span>
                    {s.html && <Check className="w-3 h-3 text-green-400" />}
                  </button>
                  <button onClick={() => setStepMenuOpen(stepMenuOpen === s.id ? null : s.id)}
                    className="p-1.5 hover:bg-neutral-800 rounded" title="Actions">
                    <Settings2 className="w-3.5 h-3.5 text-neutral-500" />
                  </button>
                  {stepMenuOpen === s.id && (
                    <div className="absolute top-full right-0 mt-1 z-10 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl py-1 min-w-[180px]">
                      <button onClick={() => { renameStep(s.id); setStepMenuOpen(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 flex items-center gap-2">
                        <Edit2 className="w-3 h-3" /> Rename
                      </button>
                      <button onClick={() => { changeStepSlug(s.id); setStepMenuOpen(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 flex items-center gap-2">
                        <ExternalLink className="w-3 h-3" /> Change slug
                      </button>
                      <div className="border-t border-neutral-800 my-1" />
                      <button onClick={() => { moveStep(s.id, -1); setStepMenuOpen(null) }} disabled={i === 0} className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 flex items-center gap-2 disabled:opacity-30">
                        <ArrowUp className="w-3 h-3" /> Move up
                      </button>
                      <button onClick={() => { moveStep(s.id, 1); setStepMenuOpen(null) }} disabled={i === funnel.steps.length - 1} className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 flex items-center gap-2 disabled:opacity-30">
                        <ArrowDown className="w-3 h-3" /> Move down
                      </button>
                      <div className="border-t border-neutral-800 my-1" />
                      <button onClick={() => { deleteStep(s.id, s.name); setStepMenuOpen(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 text-red-400 flex items-center gap-2">
                        <Trash2 className="w-3 h-3" /> Delete step
                      </button>
                    </div>
                  )}
                </div>
                {i < funnel.steps.length - 1 && <ArrowRight className="w-3 h-3 text-neutral-700" />}
              </React.Fragment>
            ))}
            <button onClick={() => setAddStepOpen(true)}
              className="ml-2 flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-white text-sm whitespace-nowrap">
              <Plus className="w-3.5 h-3.5" /> Add step
            </button>
          </div>

          {/* Add step modal */}
          {addStepOpen && <AddStepModal onCancel={() => setAddStepOpen(false)} onAdd={addStep} />}

          {/* Step editor */}
          {selectedStep && <StepEditor step={selectedStep} funnel={funnel} onSaved={load} />}
        </>
      )}

      {/* Payment config drawer (rendered outside conditional so opens with 0 steps too) */}
      {paymentDrawerOpen && (
        <PaymentConfigDrawer
          funnelId={funnel.id}
          funnelSlug={funnel.slug}
          initialConfig={funnel.payment_config || {}}
          paymentMode={funnel.payment_mode}
          onClose={() => setPaymentDrawerOpen(false)}
          onSaved={load}
        />
      )}

      {/* Preview flow modal */}
      {previewOpen && (
        <PreviewFlowModal
          funnelId={funnel.id}
          funnelSlug={funnel.slug}
          funnelName={funnel.name}
          steps={funnel.steps.map(s => ({
            id: s.id, slug: s.slug, name: s.name,
            step_number: s.step_number, has_html: !!s.html,
          }))}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD STEP MODAL
// ═══════════════════════════════════════════════════════════════════════════
function AddStepModal({ onCancel, onAdd }: { onCancel: () => void; onAdd: (page_type: string, name: string, slug: string, has_form?: boolean) => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [pageType, setPageType] = useState('landing')
  const [hasForm, setHasForm] = useState(false)

  const templates = [
    { key: 'landing',   name: 'Landing page',    icon: '📄', hasForm: false },
    { key: 'opt-in',    name: 'Opt-in (form)',   icon: '📥', hasForm: true },
    { key: 'order',     name: 'Order form',      icon: '🛒', hasForm: true },
    { key: 'upsell',    name: 'Upsell',          icon: '⚡', hasForm: false },
    { key: 'thank-you', name: 'Thank you',       icon: '✨', hasForm: false },
    { key: 'custom',    name: 'Custom',          icon: '🎨', hasForm: false },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Thêm step mới</h3>
          <button onClick={onCancel} className="text-neutral-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-2">Template</label>
          <div className="grid grid-cols-3 gap-2">
            {templates.map(t => (
              <button key={t.key} onClick={() => { setPageType(t.key); setHasForm(t.hasForm); if (!name) setName(t.name); if (!slug) setSlug(t.key) }}
                className={`text-left px-2 py-2 rounded-lg border transition ${pageType === t.key ? '' : 'border-neutral-800 hover:border-neutral-700'}`}
                style={pageType === t.key ? { borderColor: 'var(--color-mission-accent)' } : undefined}>
                <div className="text-lg mb-0.5">{t.icon}</div>
                <div className="text-xs">{t.name}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Tên step</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Slug (URL)</label>
          <input value={slug} onChange={e => setSlug(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono" />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hasForm} onChange={e => setHasForm(e.target.checked)} />
          <span className="text-sm">Step này có form thu info</span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="text-sm text-neutral-500 hover:text-white">Huỷ</button>
          <button onClick={() => onAdd(pageType, name, slug, hasForm)} disabled={!name}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
            <Plus className="w-4 h-4" /> Thêm step
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP EDITOR
// ═══════════════════════════════════════════════════════════════════════════
function StepEditor({ step, funnel, onSaved }: { step: StepDetail; funnel: FunnelDetail; onSaved: () => void }) {
  const [tab, setTab] = useState<'setting' | 'outline'>('setting')
  const [mode, setMode] = useState<'ai_draft' | 'ai_direct' | 'imported' | 'blank'>(step.content_source)
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [formulaKey, setFormulaKey] = useState(step.copy_formula_key || 'pas')
  const [rawInput, setRawInput] = useState(step.copy_raw_input || '')
  const [copyDraft, setCopyDraft] = useState<CopyDraft>(step.copy_draft || { blocks: [] })
  const [hasForm, setHasForm] = useState<boolean>(!!step.has_form)
  const [formFields, setFormFields] = useState<FormField[]>((step.form_fields as any) || [])
  const [formSuccessSlug, setFormSuccessSlug] = useState<string>(step.form_success_step_slug || '')
  const [savingForm, setSavingForm] = useState(false)
  const [renderInstructions, setRenderInstructions] = useState<string>(step.render_instructions || '')
  const [addBlockOpen, setAddBlockOpen] = useState(false)
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
  const [dirtyIndices, setDirtyIndices] = useState<number[]>([])
  const [syncing, setSyncing] = useState(false)
  const [importHtml, setImportHtml] = useState('')
  const [importConfig, setImportConfig] = useState({ strip_external_scripts: true, override_form_action: true, auto_tag_ctas: true })
  const [busy, setBusy] = useState<false | 'draft' | 'approve' | 'import' | 'save'>(false)
  const [error, setError] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview')

  useEffect(() => {
    api<{ formulas: Formula[] }>('/api/copy-formulas').then(r => setFormulas(r.formulas))
  }, [])

  useEffect(() => {
    setMode(step.content_source)
    setFormulaKey(step.copy_formula_key || 'pas')
    setRawInput(step.copy_raw_input || '')
    // Ensure all blocks have UUIDs (backward compat) — happens on step switch
    setCopyDraft(ensureBlockIds(step.copy_draft || { blocks: [] }))
    setHasForm(!!step.has_form)
    setFormFields((step.form_fields as any) || [])
    setFormSuccessSlug(step.form_success_step_slug || '')
    setRenderInstructions(step.render_instructions || '')
    setDirtyIndices([])
    setDirty(false)
    setError(null)
    setTab((step.copy_draft as any)?.blocks?.length ? 'outline' : 'setting')
  }, [step.id])

  // Track whether user has unsaved outline changes
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (JSON.stringify(copyDraft) !== JSON.stringify(step.copy_draft)) setDirty(true)
    else setDirty(false)
  }, [copyDraft, step.copy_draft])

  // Sync outline → HTML deterministically (no AI). Triggered on blur, explicit button, or 5s idle fallback.
  const doSync = async () => {
    if (!step.html_blocks?.length && !copyDraft.blocks.some(b => b.id)) return
    if (!dirty) return
    setSyncing(true)
    try {
      const r = await api<{ synced_count: number; dirty_indices: number[] }>(
        `/api/funnel-steps?action=sync-outline&id=${step.id}`,
        { method: 'POST', body: JSON.stringify({ copy_draft: copyDraft }) }
      )
      setDirtyIndices(r.dirty_indices || [])
      setDirty(false)
      onSaved()
    } catch (e: any) { console.error('[sync-outline]', e); setError(e.message) }
    finally { setSyncing(false) }
  }

  // Fallback: sync after 5s idle if user keeps typing without blur
  useEffect(() => {
    if (!dirty || syncing) return
    const timer = setTimeout(doSync, 5000)
    return () => clearTimeout(timer)
  }, [copyDraft, dirty])

  const regenerateBlock = async (blockIndex: number) => {
    setError(null); setRegeneratingIndex(blockIndex)
    try {
      // First sync outline so html_blocks are ordered correctly (esp after move)
      if (dirty) await doSync()
      const block = copyDraft.blocks[blockIndex]
      await api(`/api/funnel-steps?action=regenerate-block&id=${step.id}`, {
        method: 'POST',
        body: JSON.stringify({
          block_index: blockIndex,
          content: block?.content,
          extras: block?.extras,
          render_instructions: renderInstructions,
        }),
      })
      setDirtyIndices(prev => prev.filter(i => i !== blockIndex))
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setRegeneratingIndex(null) }
  }

  const addBlock = (block: { kind: string; content: any; extras?: any }) => {
    const newBlock = { id: newBlockId(), ...block }
    setCopyDraft(prev => ({ ...prev, blocks: [...(prev.blocks || []), newBlock] }))
  }

  const saveFormConfig = async () => {
    setError(null); setSavingForm(true)
    try {
      await api('/api/funnel-steps', {
        method: 'POST',
        body: JSON.stringify({
          id: step.id, funnel_id: step.funnel_id,
          name: step.name, slug: step.slug, page_type: step.page_type,
          has_form: hasForm,
          form_mode: hasForm ? (step.form_mode || 'inline') : 'none',
          form_fields: formFields,
          form_success_step_slug: formSuccessSlug || null,
        }),
      })
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSavingForm(false) }
  }

  const draftAI = async () => {
    setError(null); setBusy('draft')
    try {
      const r = await api<{ draft: CopyDraft }>(`/api/funnel-steps?action=draft&id=${step.id}`, {
        method: 'POST',
        body: JSON.stringify({ formula_key: formulaKey, raw_input: rawInput }),
      })
      setCopyDraft(r.draft)
      setTab('outline')   // Auto-switch to outline after successful draft
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  const approve = async () => {
    setError(null); setBusy('approve')
    try {
      await api(`/api/funnel-steps?action=approve&id=${step.id}`, {
        method: 'POST',
        body: JSON.stringify({ copy_draft: copyDraft, render_instructions: renderInstructions }),
      })
      setDirtyIndices([])
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  const importHtmlAction = async () => {
    setError(null); setBusy('import')
    try {
      await api(`/api/funnel-steps?action=import&id=${step.id}`, {
        method: 'POST',
        body: JSON.stringify({ html: importHtml, config: importConfig }),
      })
      onSaved()
      setImportHtml('')
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  const currentFormula = formulas.find(f => f.key === (step.copy_formula_key || formulaKey))
  const hasDraft = copyDraft.blocks?.length > 0

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* LEFT: Editor panel with 2 tabs */}
      <div className="col-span-6 flex flex-col max-h-[calc(100vh-260px)]">
        {/* Step info header (compact, always visible) */}
        <div className="border border-neutral-800 rounded-lg p-2.5 mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">Step: {step.name}</div>
            <div className="text-[11px] text-neutral-500 truncate">
              /f/{funnel.slug}/{step.slug} · {step.page_type} · {step.has_form ? `${step.form_mode} form (${step.form_fields.length} fields)` : 'no form'}
            </div>
          </div>
          {step.copy_approved && (
            <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 border border-green-500/30 rounded-full flex items-center gap-1 flex-shrink-0">
              <Check className="w-3 h-3" />Approved
            </span>
          )}
        </div>

        {/* TABS */}
        <div className="flex gap-1 mb-3 border-b border-neutral-800">
          {([
            { key: 'setting', label: 'Setting step', icon: Settings2 },
            { key: 'outline', label: `Copy outline${hasDraft ? ` (${copyDraft.blocks.length})` : ''}`, icon: Layers },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition ${
                tab === t.key ? '' : 'border-transparent text-neutral-500 hover:text-white'
              }`}
              style={tab === t.key ? { borderColor: 'var(--color-mission-accent)', color: 'var(--color-mission-accent)' } : undefined}>
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex justify-between gap-2">
            <span className="break-all">{error}</span>
            <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* ═════════ TAB 1: SETTING STEP ═════════ */}
        {tab === 'setting' && (
          <div className="space-y-4 overflow-y-auto pr-2 flex-1">
            {/* Mode picker */}
            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-2">Content source</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { key: 'ai_draft', label: 'AI Draft', icon: Wand2, hint: '2 bước: draft → approve' },
                  { key: 'ai_direct', label: 'AI Direct', icon: Zap, hint: '1 bước: input → HTML' },
                  { key: 'imported', label: 'Import HTML', icon: FileCode2, hint: 'Paste HTML từ nguồn khác' },
                  { key: 'blank', label: 'Blank', icon: Edit2, hint: 'Viết HTML tay' },
                ].map(m => (
                  <button key={m.key} onClick={() => setMode(m.key as any)}
                    className={`text-left px-2 py-2 rounded-lg border transition ${mode === m.key ? '' : 'border-neutral-800 hover:border-neutral-700'}`}
                    style={mode === m.key ? { borderColor: 'var(--color-mission-accent)' } : undefined}>
                    <div className="flex items-center gap-1 text-xs font-medium"><m.icon className="w-3 h-3" />{m.label}</div>
                    <div className="text-[10px] text-neutral-500 mt-1">{m.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Draft settings */}
            {mode === 'ai_draft' && (
              <>
                <div>
                  <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Công thức viết</label>
                  <select value={formulaKey} onChange={e => setFormulaKey(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm">
                    {formulas.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}
                  </select>
                  <p className="text-xs text-neutral-500 mt-1">{formulas.find(f => f.key === formulaKey)?.description}</p>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Raw input cho step này (optional)</label>
                  <textarea value={rawInput} onChange={e => setRawInput(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" rows={5}
                    placeholder="Nếu bỏ trống, AI dùng shared_context của funnel làm chính. Điền thêm nếu step này cần info riêng." />
                </div>
                <button onClick={draftAI} disabled={busy !== false}
                  style={{ background: 'var(--color-mission-accent)', color: '#000' }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
                  {busy === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {hasDraft ? 'Regenerate draft' : 'Draft nội dung với AI'}
                </button>
                {hasDraft && (
                  <button onClick={() => setTab('outline')}
                    className="w-full text-center text-xs text-neutral-500 hover:text-white py-1">
                    → Xem/edit content ở tab Copy outline ({copyDraft.blocks.length} blocks)
                  </button>
                )}
              </>
            )}

            {/* Import mode */}
            {mode === 'imported' && (
              <>
                <div>
                  <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">HTML nguồn</label>
                  <textarea value={importHtml} onChange={e => setImportHtml(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-xs font-mono"
                    rows={12} placeholder="Paste HTML từ Landingi, Systeme, Framer export, v.v..." />
                </div>
                <div className="space-y-2 border border-neutral-800 rounded-lg p-3">
                  <label className="text-xs text-neutral-500 uppercase tracking-wider block">Config</label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={importConfig.strip_external_scripts} onChange={e => setImportConfig(c => ({ ...c, strip_external_scripts: e.target.checked }))} />Strip external scripts (khuyến nghị)</label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={importConfig.override_form_action} onChange={e => setImportConfig(c => ({ ...c, override_form_action: e.target.checked }))} />Override form action → /api/f/submit</label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={importConfig.auto_tag_ctas} onChange={e => setImportConfig(c => ({ ...c, auto_tag_ctas: e.target.checked }))} />Auto tag buttons làm CTA</label>
                  {!importConfig.strip_external_scripts && <p className="text-xs text-amber-400 mt-1">⚠ Giữ external scripts có thể vỡ page (CSP) hoặc leak data.</p>}
                </div>
                <button onClick={importHtmlAction} disabled={busy !== false || !importHtml.trim()}
                  style={{ background: 'var(--color-mission-accent)', color: '#000' }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
                  {busy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode2 className="w-4 h-4" />}
                  Import HTML
                </button>
              </>
            )}

            {(mode === 'ai_direct' || mode === 'blank') && (
              <div className="p-4 border border-dashed border-neutral-800 rounded-lg text-xs text-neutral-500 text-center">
                {mode === 'ai_direct' ? 'AI Direct (1-step) coming soon. Hiện dùng AI Draft (2-step) — chất lượng tốt hơn.' : 'Blank mode: viết HTML tay coming soon.'}
              </div>
            )}

            {/* Form config (always visible in Setting tab) */}
            <div className="border-t border-neutral-800 pt-4">
              <label className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-500 uppercase tracking-wider">Form config</span>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={hasForm} onChange={e => setHasForm(e.target.checked)} />
                  Step này có form thu info
                </label>
              </label>
              {hasForm && (
                <>
                  <FormFieldsEditor value={formFields} onChange={setFormFields} />
                  <div className="mt-3">
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Sau khi submit → step tiếp theo</label>
                    <select value={formSuccessSlug} onChange={e => setFormSuccessSlug(e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm">
                      <option value="">(default: step kế tiếp theo thứ tự)</option>
                      {funnel.steps.filter(s => s.id !== step.id).map(s => (
                        <option key={s.id} value={s.slug}>Step {s.step_number}: {s.name} (/{s.slug})</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <button onClick={saveFormConfig} disabled={savingForm}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-neutral-700 rounded-lg hover:bg-neutral-800 text-sm disabled:opacity-40">
                {savingForm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save form config
              </button>
              <p className="text-[10px] text-neutral-500 mt-1">
                💡 Form config được inject vào HTML khi Approve. Nếu đã có HTML rồi, cần Regenerate → Approve lại để áp thay đổi.
              </p>
            </div>
          </div>
        )}

        {/* ═════════ TAB 2: COPY OUTLINE ═════════ */}
        {tab === 'outline' && (
          <div className="flex flex-col flex-1 min-h-0">
            {!hasDraft ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-neutral-800 rounded-lg">
                <div className="text-center px-8">
                  <Layers className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
                  <p className="text-sm text-neutral-500 mb-3">Chưa có content draft.</p>
                  <button onClick={() => setTab('setting')}
                    style={{ background: 'var(--color-mission-accent)', color: '#000' }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90">
                    <ChevronLeft className="w-4 h-4" /> Về Setting step
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Outline header — badges + regenerate */}
                <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-neutral-800">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-neutral-500">{copyDraft.blocks.length} blocks</span>
                    {step.copy_formula_key && (
                      <span className="text-[10px] px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded font-mono">
                        {currentFormula?.name || step.copy_formula_key}
                      </span>
                    )}
                    {(step.generation_meta as any)?.model && (
                      <span className="text-[10px] px-2 py-0.5 bg-neutral-800 text-neutral-500 rounded font-mono">
                        {(step.generation_meta as any).model}
                      </span>
                    )}
                  </div>
                  <button onClick={draftAI} disabled={busy !== false}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-neutral-700 rounded hover:bg-neutral-800 disabled:opacity-40"
                    title="Regenerate toàn bộ draft từ đầu (giữ formula + raw_input hiện tại)">
                    {busy === 'draft' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    Regenerate all
                  </button>
                </div>

                {/* Block tree — scrollable */}
                <div className="flex-1 overflow-y-auto pr-2 mb-3">
                  <ContentDraftEditor
                    value={copyDraft}
                    onChange={setCopyDraft}
                    onAddBlock={() => setAddBlockOpen(true)}
                    onRegenerateBlock={regenerateBlock}
                    onBlurTrigger={doSync}
                    regeneratingIndex={regeneratingIndex}
                    dirtyIndices={dirtyIndices}
                    funnelId={funnel.id}
                    stepId={step.id}
                  />
                </div>

                {/* Modified indicator + explicit Sync button */}
                <div className="flex items-center justify-between mb-2 text-[11px] flex-shrink-0">
                  <div className="flex items-center gap-2 text-neutral-500">
                    {syncing ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Đang sync HTML từ outline...</>
                    ) : dirty ? (
                      <span className="text-amber-400">● Đã sửa — HTML sẽ sync khi anh xong (blur/click chỗ khác) hoặc bấm Sync</span>
                    ) : (
                      <span className="text-green-500">✓ HTML đã sync với outline</span>
                    )}
                  </div>
                  {dirty && (
                    <button onClick={doSync} disabled={syncing}
                      className="text-xs px-2 py-1 border border-neutral-700 rounded hover:bg-neutral-800 disabled:opacity-40">
                      Sync ngay
                    </button>
                  )}
                </div>

                {/* Render instructions — extra requirements before HTML gen */}
                <div className="mb-3 flex-shrink-0">
                  <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">
                    Yêu cầu thêm cho STEP (áp dụng cho tất cả blocks)
                  </label>
                  <textarea value={renderInstructions} onChange={e => setRenderInstructions(e.target.value)}
                    className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs" rows={2}
                    placeholder='VD: "Không dùng gradient", "CTA button to hơn", "Thêm hover animation", "Không hiển thị pricing"' />
                </div>

                {/* Approve button — sticky bottom */}
                <button onClick={approve} disabled={busy !== false}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-green-500/50 text-green-400 rounded-lg hover:bg-green-500/10 disabled:opacity-40 flex-shrink-0">
                  {busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Duyệt content → tạo HTML {dirtyIndices.length > 0 && <span className="text-xs text-amber-400">({dirtyIndices.length} block cần regen)</span>}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add block modal */}
      {addBlockOpen && (
        <AddBlockModal
          stepId={step.id}
          existingBlocks={copyDraft.blocks.map(b => ({ kind: b.kind, content: b.content }))}
          onClose={() => setAddBlockOpen(false)}
          onAdd={addBlock}
        />
      )}

      {/* RIGHT: HTML Preview */}
      <div className="col-span-6 border border-neutral-800 rounded-xl overflow-hidden bg-white flex flex-col max-h-[calc(100vh-260px)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900">
          <div className="flex gap-1">
            {(['preview', 'code'] as const).map(m => (
              <button key={m} onClick={() => setPreviewMode(m)}
                className={`px-3 py-1 text-xs rounded ${previewMode === m ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-white'}`}>{m}</button>
            ))}
          </div>
          {step.html_generated_from_copy_at && (
            <span className="text-xs text-neutral-500">Generated {new Date(step.html_generated_from_copy_at).toLocaleString('vi-VN')}</span>
          )}
        </div>
        {busy === 'approve' || busy === 'import' ? (
          <div className="flex-1 flex items-center justify-center bg-neutral-950 text-neutral-500">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: 'var(--color-mission-accent)' }} />
              <p className="text-sm">Generating HTML...</p>
            </div>
          </div>
        ) : !step.html ? (
          <div className="flex-1 flex items-center justify-center bg-neutral-950 text-neutral-600">
            <div className="text-center px-8">
              <Eye className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Bấm "Duyệt content → tạo HTML" hoặc "Import HTML" để xem preview</p>
            </div>
          </div>
        ) : previewMode === 'preview' ? (
          <iframe srcDoc={step.html} className="flex-1 w-full bg-white" title="Preview" sandbox="allow-scripts allow-same-origin" />
        ) : (
          <pre className="flex-1 overflow-auto p-3 bg-neutral-950 text-neutral-300 text-xs font-mono whitespace-pre-wrap">{step.html}</pre>
        )}
      </div>
    </div>
  )
}
