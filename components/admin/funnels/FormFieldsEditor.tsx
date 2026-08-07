import React from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'

export interface FormField {
  name: string
  label: string
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea'
  required?: boolean
  placeholder?: string
}

const TYPES: FormField['type'][] = ['text', 'email', 'tel', 'number', 'textarea']

export function FormFieldsEditor({ value, onChange }: { value: FormField[]; onChange: (v: FormField[]) => void }) {
  const set = (i: number, patch: Partial<FormField>) => {
    const copy = [...value]
    copy[i] = { ...copy[i], ...patch }
    onChange(copy)
  }
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const copy = [...value]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy)
  }
  const add = () => onChange([...value, { name: `field_${value.length + 1}`, label: 'Field mới', type: 'text', required: false }])

  return (
    <div className="space-y-2">
      <div className="text-xs text-neutral-500 mb-1">
        Form fields — AI sẽ render form với đúng name/type. Field <code>email</code> auto-sync sang CRM leads.
      </div>
      {value.map((f, i) => (
        <div key={i} className="border border-neutral-800 rounded-lg p-2 bg-neutral-900/30">
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-center gap-0.5 pt-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-neutral-600 hover:text-white disabled:opacity-20 text-xs">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === value.length - 1} className="text-neutral-600 hover:text-white disabled:opacity-20 text-xs">▼</button>
            </div>
            <div className="flex-1 grid grid-cols-4 gap-1.5">
              <input value={f.name} onChange={e => set(i, { name: e.target.value })} placeholder="name"
                className="px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-xs font-mono" />
              <input value={f.label} onChange={e => set(i, { label: e.target.value })} placeholder="Label hiển thị"
                className="px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-xs" />
              <select value={f.type} onChange={e => set(i, { type: e.target.value as any })}
                className="px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-xs">
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={!!f.required} onChange={e => set(i, { required: e.target.checked })} />
                  required
                </label>
              </div>
            </div>
            <button onClick={() => remove(i)} className="p-1 text-neutral-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      <button onClick={add} className="w-full py-1.5 border border-dashed border-neutral-700 rounded text-xs text-neutral-500 hover:text-white hover:border-neutral-500">
        <Plus className="w-3 h-3 inline mr-1" /> Thêm field
      </button>
    </div>
  )
}
