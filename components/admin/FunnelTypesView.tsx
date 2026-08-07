import React, { useState, useEffect, useCallback } from 'react'
import { Zap, Target, Video, Phone, Rocket, BookOpen, Plus, Edit2, Trash2, ChevronLeft, Loader2, Save, GripVertical, X, AlertTriangle, Lock } from 'lucide-react'
import { supabase } from '../../services/supabase'

const ICON_OPTIONS = ['zap', 'target', 'video', 'phone', 'rocket', 'book-open']
const ICON_MAP: Record<string, any> = { zap: Zap, target: Target, video: Video, phone: Phone, rocket: Rocket, 'book-open': BookOpen }

const PAGE_TYPES = ['landing', 'opt-in', 'order', 'upsell', 'thank-you', 'custom']

interface SuggestedStep {
  step_number: number
  slug: string
  name: string
  page_type: string
  has_form: boolean
  form_mode?: 'inline' | 'popup' | 'none'
  form_fields?: Array<{ name: string; label: string; type: string; required?: boolean }>
  form_success_step_slug?: string
}

interface FunnelType {
  id: string
  key: string
  name: string
  description: string
  icon: string
  color: string
  system_prompt: string
  suggested_steps: SuggestedStep[]
  is_builtin: boolean
  is_active: boolean
  sort_order: number
  updated_at: string
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
// LIST
// ══════════════════════════════════════════════════════════════════════════
function TypesList({ onNew, onEdit }: { onNew: () => void; onEdit: (id: string) => void }) {
  const [types, setTypes] = useState<FunnelType[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiCall<{ types: FunnelType[] }>('/api/funnel-types')
      setTypes(r.types)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (id: string, name: string) => {
    if (!confirm(`Xoá type "${name}"?`)) return
    try {
      await apiCall(`/api/funnel-types?id=${id}`, { method: 'DELETE' })
      load()
    } catch (e: any) { alert(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-500">Định nghĩa loại funnel — mỗi type có prompt AI riêng + suggested steps.</p>
        </div>
        <button onClick={onNew}
          style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus className="w-4 h-4" /> Add type
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-neutral-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : (
        <div className="border border-neutral-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/50 text-neutral-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-center px-4 py-3">Suggested steps</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {types.map(t => {
                const Icon = ICON_MAP[t.icon] || Zap
                return (
                  <tr key={t.id} className="hover:bg-neutral-900/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: t.color + '20', color: t.color }}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {t.name}
                            {t.is_builtin && <Lock className="w-3 h-3 text-neutral-500" />}
                          </div>
                          <div className="text-xs text-neutral-500 font-mono">{t.key}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-400 text-xs max-w-md">{t.description || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs px-2 py-1 bg-neutral-800 rounded">{(t.suggested_steps || []).length} steps</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.is_active
                        ? <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded border border-green-500/30">active</span>
                        : <span className="text-xs px-2 py-0.5 bg-neutral-700/30 text-neutral-500 rounded border border-neutral-700">inactive</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => onEdit(t.id)} className="p-1.5 hover:bg-neutral-800 rounded" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {!t.is_builtin && (
                          <button onClick={() => del(t.id, t.name)} className="p-1.5 hover:bg-neutral-800 rounded" title="Delete">
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// EDITOR
// ══════════════════════════════════════════════════════════════════════════
function TypeEditor({ id, onBack, onSaved }: { id: string | null; onBack: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<FunnelType>({
    id: '', key: '', name: '', description: '', icon: 'zap', color: '#B6FF00',
    system_prompt: '', suggested_steps: [],
    is_builtin: false, is_active: true, sort_order: 100, updated_at: '',
  })
  const [activeTab, setActiveTab] = useState<'basic' | 'prompt' | 'steps'>('basic')

  useEffect(() => {
    if (!id) return
    apiCall<FunnelType>(`/api/funnel-types?id=${id}`).then(t => {
      setType({ ...t, suggested_steps: t.suggested_steps || [] })
      setLoading(false)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [id])

  const setField = <K extends keyof FunnelType>(k: K, v: FunnelType[K]) => setType(prev => ({ ...prev, [k]: v }))

  const addStep = () => {
    const next = (type.suggested_steps.length || 0) + 1
    setField('suggested_steps', [...type.suggested_steps, {
      step_number: next, slug: `step-${next}`, name: `Step ${next}`,
      page_type: 'landing', has_form: false, form_mode: 'none',
    }])
  }
  const removeStep = (i: number) => {
    const copy = [...type.suggested_steps]
    copy.splice(i, 1)
    setField('suggested_steps', copy.map((s, idx) => ({ ...s, step_number: idx + 1 })))
  }
  const updateStep = (i: number, patch: Partial<SuggestedStep>) => {
    const copy = [...type.suggested_steps]
    copy[i] = { ...copy[i], ...patch }
    setField('suggested_steps', copy)
  }

  const doSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const body: any = { ...type }
      if (!id) delete body.id
      await apiCall('/api/funnel-types', { method: 'POST', body: JSON.stringify(body) })
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="text-center py-12 text-neutral-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>

  const IconPreview = ICON_MAP[type.icon] || Zap

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-neutral-800 rounded"><ChevronLeft className="w-5 h-5" /></button>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: type.color + '20', color: type.color }}>
            <IconPreview className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{id ? type.name : 'New funnel type'}</h2>
            {type.is_builtin && (
              <span className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
                <Lock className="w-3 h-3" /> Built-in (không xoá được, edit thoải mái)
              </span>
            )}
          </div>
        </div>
        <button onClick={doSave} disabled={saving || !type.name}
          style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-800">
        {(['basic', 'prompt', 'steps'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeTab === t ? '' : 'border-transparent text-neutral-500'}`}
            style={activeTab === t ? { borderColor: 'var(--color-mission-accent)', color: 'var(--color-mission-accent)' } : undefined}>
            {t === 'basic' ? 'Basic info' : t === 'prompt' ? 'System prompt' : `Suggested steps (${type.suggested_steps.length})`}
          </button>
        ))}
      </div>

      {activeTab === 'basic' && (
        <div className="grid grid-cols-2 gap-4 max-w-3xl">
          <Field label="Name *"><input value={type.name} onChange={e => setField('name', e.target.value)} className="input" /></Field>
          <Field label="Key (slug)" hint={type.is_builtin ? 'Built-in — không đổi được' : 'Auto từ name nếu bỏ trống'}>
            <input value={type.key} onChange={e => setField('key', e.target.value)} disabled={type.is_builtin} className="input font-mono disabled:opacity-50" />
          </Field>
          <div className="col-span-2">
            <Field label="Description"><input value={type.description} onChange={e => setField('description', e.target.value)} className="input" placeholder="Ngắn gọn, hiện trong dropdown chọn type khi tạo funnel" /></Field>
          </div>
          <Field label="Icon">
            <select value={type.icon} onChange={e => setField('icon', e.target.value)} className="input">
              {ICON_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Color (hex)"><input value={type.color} onChange={e => setField('color', e.target.value)} className="input font-mono" /></Field>
          <Field label="Sort order"><input type="number" value={type.sort_order} onChange={e => setField('sort_order', Number(e.target.value))} className="input" /></Field>
          <Field label="Active">
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={type.is_active} onChange={e => setField('is_active', e.target.checked)} />
              <span className="text-sm">{type.is_active ? 'Hiện trong dropdown' : 'Ẩn'}</span>
            </label>
          </Field>
        </div>
      )}

      {activeTab === 'prompt' && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs text-neutral-500 uppercase tracking-wider">System prompt (markdown)</label>
            <span className="text-xs text-neutral-500">{type.system_prompt.length.toLocaleString()} chars</span>
          </div>
          <textarea
            value={type.system_prompt}
            onChange={e => setField('system_prompt', e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs font-mono resize-y"
            style={{ minHeight: 500, fontFamily: 'ui-monospace, monospace' }}
            spellCheck={false}
          />
          <p className="text-xs text-neutral-500 mt-2">
            💡 Prompt này gửi lên AI mỗi khi generate step của type này. Càng chi tiết càng chất lượng.
            Đây là "skill" của portal — edit thoải mái để customize theo brand của bạn.
          </p>
        </div>
      )}

      {activeTab === 'steps' && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">Khi user tạo funnel loại này + bấm "Suggest steps", các steps dưới sẽ được auto-create.</p>
          {type.suggested_steps.map((s, i) => (
            <div key={i} className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/30">
              <div className="flex items-start gap-2 mb-2">
                <GripVertical className="w-4 h-4 text-neutral-600 mt-2 flex-shrink-0" />
                <div className="flex-1 grid grid-cols-4 gap-2">
                  <Field label="Name"><input value={s.name} onChange={e => updateStep(i, { name: e.target.value })} className="input text-sm" /></Field>
                  <Field label="Slug"><input value={s.slug} onChange={e => updateStep(i, { slug: e.target.value })} className="input text-sm font-mono" /></Field>
                  <Field label="Page type">
                    <select value={s.page_type} onChange={e => updateStep(i, { page_type: e.target.value })} className="input text-sm">
                      {PAGE_TYPES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </Field>
                  <Field label="Has form">
                    <select value={s.has_form ? 'yes' : 'no'} onChange={e => updateStep(i, { has_form: e.target.value === 'yes', form_mode: e.target.value === 'yes' ? 'inline' : 'none' })} className="input text-sm">
                      <option value="no">No</option><option value="yes">Yes</option>
                    </select>
                  </Field>
                </div>
                <button onClick={() => removeStep(i)} className="p-1.5 hover:bg-neutral-800 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
              {s.has_form && (
                <div className="pl-6 text-xs text-neutral-500">
                  Fields: {(s.form_fields || []).map(f => f.name).join(', ') || '(default name+email)'}
                  {s.form_success_step_slug && <span className="ml-3">→ next: <code className="text-neutral-400">{s.form_success_step_slug}</code></span>}
                </div>
              )}
            </div>
          ))}
          <button onClick={addStep} className="w-full border border-dashed border-neutral-700 rounded-lg py-3 text-sm text-neutral-500 hover:text-white hover:border-neutral-500">
            <Plus className="w-4 h-4 inline mr-1" /> Thêm suggested step
          </button>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-neutral-600 mt-1">{hint}</p>}
    </div>
  )
}

// Global input style class (Tailwind will pick these up if used consistently)
if (typeof document !== 'undefined' && !document.getElementById('funnel-types-styles')) {
  const s = document.createElement('style')
  s.id = 'funnel-types-styles'
  s.textContent = `.input{width:100%;padding:0.5rem 0.75rem;background:#0f0f0f;border:1px solid #262626;border-radius:0.5rem;font-size:0.875rem;color:#e5e5e5}.input:focus{outline:none;border-color:#525252}`
  document.head.appendChild(s)
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
export default function FunnelTypesView() {
  const [mode, setMode] = useState<'list' | 'editor'>('list')
  const [editId, setEditId] = useState<string | null>(null)

  if (mode === 'editor') {
    return <TypeEditor
      id={editId}
      onBack={() => setMode('list')}
      onSaved={() => { setMode('list'); setEditId(null) }}
    />
  }
  return <TypesList
    onNew={() => { setEditId(null); setMode('editor') }}
    onEdit={id => { setEditId(id); setMode('editor') }}
  />
}
