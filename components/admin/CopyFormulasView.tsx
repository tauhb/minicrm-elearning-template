import React, { useState, useEffect, useCallback } from 'react'
import { PenLine, Plus, Edit2, Trash2, ChevronLeft, Loader2, Save, X, Lock } from 'lucide-react'
import { supabase } from '../../services/supabase'

interface Formula {
  id: string
  key: string
  name: string
  description: string
  system_prompt: string
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

function List({ onNew, onEdit }: { onNew: () => void; onEdit: (id: string) => void }) {
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiCall<{ formulas: Formula[] }>('/api/copy-formulas')
      setFormulas(r.formulas)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (id: string, name: string) => {
    if (!confirm(`Xoá formula "${name}"?`)) return
    try {
      await apiCall(`/api/copy-formulas?id=${id}`, { method: 'DELETE' })
      load()
    } catch (e: any) { alert(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          Công thức viết copy (PAS, AIDA, BAB, ...) — AI dùng để structure content khi user chọn formula này.
        </p>
        <button onClick={onNew}
          style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus className="w-4 h-4" /> Add formula
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-neutral-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : (
        <div className="border border-neutral-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/50 text-neutral-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Formula</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {formulas.map(f => (
                <tr key={f.id} className="hover:bg-neutral-900/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-neutral-800 text-neutral-400">
                        <PenLine className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {f.name}
                          {f.is_builtin && <Lock className="w-3 h-3 text-neutral-500" />}
                        </div>
                        <div className="text-xs text-neutral-500 font-mono">{f.key}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-400 text-xs max-w-md">{f.description || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {f.is_active
                      ? <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded border border-green-500/30">active</span>
                      : <span className="text-xs px-2 py-0.5 bg-neutral-700/30 text-neutral-500 rounded border border-neutral-700">inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => onEdit(f.id)} className="p-1.5 hover:bg-neutral-800 rounded" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!f.is_builtin && (
                        <button onClick={() => del(f.id, f.name)} className="p-1.5 hover:bg-neutral-800 rounded" title="Delete">
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      )}
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

function Editor({ id, onBack, onSaved }: { id: string | null; onBack: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState<Formula>({
    id: '', key: '', name: '', description: '', system_prompt: '',
    is_builtin: false, is_active: true, sort_order: 100, updated_at: '',
  })

  useEffect(() => {
    if (!id) return
    apiCall<Formula>(`/api/copy-formulas?id=${id}`).then(x => {
      setF(x)
      setLoading(false)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [id])

  const setField = <K extends keyof Formula>(k: K, v: Formula[K]) => setF(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const body: any = { ...f }
      if (!id) delete body.id
      await apiCall('/api/copy-formulas', { method: 'POST', body: JSON.stringify(body) })
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="text-center py-12 text-neutral-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-neutral-800 rounded"><ChevronLeft className="w-5 h-5" /></button>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-neutral-800 text-neutral-400">
            <PenLine className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{id ? f.name : 'New copy formula'}</h2>
            {f.is_builtin && <span className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5"><Lock className="w-3 h-3" /> Built-in</span>}
          </div>
        </div>
        <button onClick={save} disabled={saving || !f.name || !f.system_prompt}
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

      <div className="grid grid-cols-2 gap-4 max-w-3xl">
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Name *</label>
          <input value={f.name} onChange={e => setField('name', e.target.value)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Key</label>
          <input value={f.key} onChange={e => setField('key', e.target.value)}
            disabled={f.is_builtin}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm font-mono disabled:opacity-50" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Description</label>
          <input value={f.description} onChange={e => setField('description', e.target.value)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm"
            placeholder="Ngắn gọn, 1 dòng, hiện trong dropdown" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Sort order</label>
          <input type="number" value={f.sort_order} onChange={e => setField('sort_order', Number(e.target.value))}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Active</label>
          <label className="flex items-center gap-2 mt-2">
            <input type="checkbox" checked={f.is_active} onChange={e => setField('is_active', e.target.checked)} />
            <span className="text-sm">{f.is_active ? 'Hiện trong dropdown' : 'Ẩn'}</span>
          </label>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-neutral-500 uppercase tracking-wider">System prompt (markdown) *</label>
          <span className="text-xs text-neutral-500">{f.system_prompt.length.toLocaleString()} chars</span>
        </div>
        <textarea
          value={f.system_prompt}
          onChange={e => setField('system_prompt', e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs font-mono resize-y"
          style={{ minHeight: 500, fontFamily: 'ui-monospace, monospace' }}
          spellCheck={false}
          placeholder="Instruction cho AI structure content theo formula này..."
        />
        <p className="text-xs text-neutral-500 mt-2">
          💡 AI dùng prompt này khi user chọn formula này trong step editor. Explain formula philosophy + block order gợi ý + writing guidance.
        </p>
      </div>
    </div>
  )
}

export default function CopyFormulasView() {
  const [mode, setMode] = useState<'list' | 'editor'>('list')
  const [editId, setEditId] = useState<string | null>(null)

  if (mode === 'editor') {
    return <Editor
      id={editId}
      onBack={() => setMode('list')}
      onSaved={() => { setMode('list'); setEditId(null) }}
    />
  }
  return <List
    onNew={() => { setEditId(null); setMode('editor') }}
    onEdit={id => { setEditId(id); setMode('editor') }}
  />
}
