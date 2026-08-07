import React, { useState } from 'react'
import { Trash2, Plus, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle, Check } from 'lucide-react'

export interface Block {
  kind: string
  content: any
}

export interface CopyDraft {
  blocks: Block[]
}

export interface ContentDraftEditorProps {
  value: CopyDraft
  onChange: (v: CopyDraft) => void
  onAddBlock?: () => void          // Trigger AddBlockModal
  onRegenerateBlock?: (index: number) => Promise<void> | void
  regeneratingIndex?: number | null
  dirtyIndices?: number[]          // Blocks whose text couldn't be sync-replaced (need regen)
}

export function ContentDraftEditor({ value, onChange, onAddBlock, onRegenerateBlock, regeneratingIndex, dirtyIndices = [] }: ContentDraftEditorProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set(value.blocks.map((_, i) => i)))

  const blocks = value.blocks || []
  const setBlocks = (b: Block[]) => onChange({ ...value, blocks: b })

  const toggle = (i: number) => {
    const s = new Set(expanded)
    if (s.has(i)) s.delete(i); else s.add(i)
    setExpanded(s)
  }

  const removeBlock = (i: number) => {
    const copy = [...blocks]
    copy.splice(i, 1)
    setBlocks(copy)
  }

  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const copy = [...blocks]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    setBlocks(copy)
  }

  const updateBlockContent = (i: number, patch: any) => {
    const copy = [...blocks]
    copy[i] = { ...copy[i], content: { ...copy[i].content, ...patch } }
    setBlocks(copy)
  }

  if (!blocks.length) {
    return (
      <div className="text-center py-8 text-neutral-500 text-sm border border-dashed border-neutral-800 rounded-lg">
        Chưa có block nào. Bấm "Draft nội dung với AI" ở tab Setting, hoặc "+ Thêm block" bên dưới.
        {onAddBlock && (
          <div className="mt-3">
            <button onClick={onAddBlock}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs">
              <Plus className="w-3 h-3" /> Thêm block
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => (
        <BlockCard
          key={i}
          block={block}
          index={i}
          total={blocks.length}
          expanded={expanded.has(i)}
          isDirty={dirtyIndices.includes(i)}
          isRegenerating={regeneratingIndex === i}
          onToggle={() => toggle(i)}
          onRemove={() => removeBlock(i)}
          onMove={(dir) => moveBlock(i, dir)}
          onUpdate={(patch) => updateBlockContent(i, patch)}
          onRegenerate={onRegenerateBlock ? () => onRegenerateBlock(i) : undefined}
        />
      ))}
      <button
        onClick={onAddBlock}
        className="w-full py-2 border border-dashed border-neutral-700 rounded-lg text-sm text-neutral-500 hover:text-white hover:border-neutral-500 inline-flex items-center justify-center gap-1"
      >
        <Plus className="w-4 h-4" /> Thêm block
      </button>
    </div>
  )
}

function BlockCard({ block, index, total, expanded, isDirty, isRegenerating, onToggle, onRemove, onMove, onUpdate, onRegenerate }: {
  block: Block; index: number; total: number; expanded: boolean;
  isDirty: boolean; isRegenerating: boolean;
  onToggle: () => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
  onUpdate: (patch: any) => void; onRegenerate?: () => void | Promise<void>;
}) {
  const c = block.content || {}
  const preview = c.headline || c.title || c.quote || c.intent || (typeof c === 'string' ? c : Object.values(c)[0]) || '(empty)'

  return (
    <div className={`border rounded-lg bg-neutral-900/30 ${isDirty ? 'border-amber-500/40' : 'border-neutral-800'}`}>
      <div className="flex items-center gap-2 p-2 border-b border-neutral-800/50">
        <div className="flex flex-col">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-0.5 text-neutral-600 hover:text-white disabled:opacity-20">▲</button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-0.5 text-neutral-600 hover:text-white disabled:opacity-20">▼</button>
        </div>
        <button onClick={onToggle} className="flex-1 flex items-center gap-2 text-left min-w-0">
          {expanded ? <ChevronDown className="w-3 h-3 text-neutral-500 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-neutral-500 flex-shrink-0" />}
          <span className="text-xs px-1.5 py-0.5 bg-neutral-800 rounded font-mono flex-shrink-0">{block.kind}</span>
          <span className="text-xs text-neutral-500 truncate flex-1">{String(preview).slice(0, 80)}</span>
          {isDirty && (
            <span title="Text đã sửa nhưng HTML chưa update — bấm 🔄 để regenerate section" className="flex-shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            </span>
          )}
        </button>
        {onRegenerate && (
          <button onClick={onRegenerate} disabled={isRegenerating}
            className={`p-1 hover:bg-neutral-800 rounded ${isDirty ? 'text-amber-400' : 'text-neutral-500 hover:text-white'} disabled:opacity-40`}
            title="Regenerate section HTML với AI">
            {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        )}
        <button onClick={onRemove} className="p-1 text-neutral-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {expanded && (
        <div className="p-3 space-y-2">
          <GenericBlockEditor block={block} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  )
}

// Generic editor that renders inputs for any field in content object.
// Field types inferred: string → input; array of strings → array editor; object → recurse.
function GenericBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (patch: any) => void }) {
  const content = block.content || {}
  const keys = Object.keys(content)

  if (keys.length === 0) {
    return <p className="text-xs text-neutral-500 italic">Empty content — will show as raw JSON.</p>
  }

  return (
    <div className="space-y-2">
      {keys.map(k => (
        <FieldEditor key={k} label={k} value={content[k]} onChange={v => onUpdate({ [k]: v })} />
      ))}
    </div>
  )
}

function FieldEditor({ label, value, onChange }: { label: string; value: any; onChange: (v: any) => void }) {
  // String
  if (typeof value === 'string') {
    const isLong = value.length > 80 || value.includes('\n')
    return (
      <div>
        <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">{label}</label>
        {isLong ? (
          <textarea value={value} onChange={e => onChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs resize-y" rows={3} />
        ) : (
          <input value={value} onChange={e => onChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs" />
        )}
      </div>
    )
  }

  // Boolean
  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        <span className="text-xs text-neutral-400">{label}</span>
      </label>
    )
  }

  // Number
  if (typeof value === 'number') {
    return (
      <div>
        <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">{label}</label>
        <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
          className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs" />
      </div>
    )
  }

  // Array of strings (e.g. bullets)
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
    return (
      <div>
        <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">{label} ({value.length})</label>
        {value.map((s, i) => (
          <div key={i} className="flex gap-1 mb-1">
            <input value={s} onChange={e => {
              const copy = [...value]; copy[i] = e.target.value; onChange(copy)
            }} className="flex-1 px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-xs" />
            <button onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="p-1 text-neutral-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
        <button onClick={() => onChange([...value, ''])}
          className="text-[10px] text-neutral-500 hover:text-white">+ Add {label}</button>
      </div>
    )
  }

  // Array of objects (e.g. testimonial items, pricing tiers)
  if (Array.isArray(value)) {
    return (
      <div>
        <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">{label} ({value.length} items)</label>
        {value.map((item, i) => (
          <div key={i} className="border border-neutral-800 rounded p-2 mb-1 bg-neutral-950/50">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-neutral-600 font-mono">#{i + 1}</span>
              <button onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-neutral-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {typeof item === 'object' ? (
              Object.keys(item).map(k => (
                <FieldEditor key={k} label={k} value={item[k]}
                  onChange={v => { const copy = [...value]; copy[i] = { ...copy[i], [k]: v }; onChange(copy) }} />
              ))
            ) : (
              <input value={String(item)} onChange={e => {
                const copy = [...value]; copy[i] = e.target.value; onChange(copy)
              }} className="w-full px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-xs" />
            )}
          </div>
        ))}
        <button onClick={() => onChange([...value, typeof value[0] === 'object' ? {} : ''])}
          className="text-[10px] text-neutral-500 hover:text-white">+ Add item</button>
      </div>
    )
  }

  // Nested object
  if (typeof value === 'object' && value !== null) {
    return (
      <div className="border-l border-neutral-800 pl-2">
        <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">{label}</label>
        <div className="space-y-1">
          {Object.keys(value).map(k => (
            <FieldEditor key={k} label={k} value={value[k]}
              onChange={v => onChange({ ...value, [k]: v })} />
          ))}
        </div>
      </div>
    )
  }

  return null
}
