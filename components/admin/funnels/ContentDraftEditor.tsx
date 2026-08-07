import React, { useState, useRef } from 'react'
import { Trash2, Plus, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle, Image as ImageIcon, Upload, X, Link2 } from 'lucide-react'
import { supabase } from '../../../services/supabase'

export interface BlockExtras {
  additional_prompt?: string
  image_urls?: string[]
}
export interface Block {
  id?: string
  kind: string
  content: any
  extras?: BlockExtras
}

export interface CopyDraft {
  blocks: Block[]
}

// Generate short block id: "blk_" + 8 base36 chars from timestamp + random
export function newBlockId(): string {
  const t = Date.now().toString(36).slice(-4)
  const r = Math.random().toString(36).slice(2, 6)
  return `blk_${t}${r}`
}

// Assign IDs to any blocks missing them (backward compat for pre-UUID data)
export function ensureBlockIds(draft: CopyDraft): CopyDraft {
  if (!draft?.blocks) return { blocks: [] }
  const blocks = draft.blocks.map(b => b?.id ? b : { ...b, id: newBlockId() })
  return { ...draft, blocks }
}

export interface ContentDraftEditorProps {
  value: CopyDraft
  onChange: (v: CopyDraft) => void
  onAddBlock?: () => void
  onRegenerateBlock?: (index: number) => Promise<void> | void
  onBlurTrigger?: () => void       // Called when any field loses focus — parent triggers sync
  regeneratingIndex?: number | null
  dirtyIndices?: number[]
  funnelId?: string
  stepId?: string
}

export function ContentDraftEditor({ value, onChange, onAddBlock, onRegenerateBlock, onBlurTrigger, regeneratingIndex, dirtyIndices = [], funnelId, stepId }: ContentDraftEditorProps) {
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

  const updateBlockExtras = (i: number, patch: Partial<BlockExtras>) => {
    const copy = [...blocks]
    copy[i] = { ...copy[i], extras: { ...(copy[i].extras || {}), ...patch } }
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
          key={block.id || i}
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
          onUpdateExtras={(patch) => updateBlockExtras(i, patch)}
          onRegenerate={onRegenerateBlock ? () => onRegenerateBlock(i) : undefined}
          onBlurTrigger={onBlurTrigger}
          funnelId={funnelId}
          stepId={stepId}
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

function BlockCard({ block, index, total, expanded, isDirty, isRegenerating, onToggle, onRemove, onMove, onUpdate, onUpdateExtras, onRegenerate, onBlurTrigger, funnelId, stepId }: {
  block: Block; index: number; total: number; expanded: boolean;
  isDirty: boolean; isRegenerating: boolean;
  onToggle: () => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
  onUpdate: (patch: any) => void; onUpdateExtras: (patch: Partial<BlockExtras>) => void;
  onRegenerate?: () => void | Promise<void>;
  onBlurTrigger?: () => void;
  funnelId?: string; stepId?: string;
}) {
  const c = block.content || {}
  const preview = c.headline || c.title || c.quote || c.intent || (typeof c === 'string' ? c : Object.values(c)[0]) || '(empty)'
  const extras = block.extras || {}
  const imageCount = (extras.image_urls || []).length

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
          {imageCount > 0 && (
            <span title={`${imageCount} ảnh`} className="flex-shrink-0 flex items-center gap-0.5 text-[10px] text-blue-400">
              <ImageIcon className="w-3 h-3" />{imageCount}
            </span>
          )}
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
        <div className="p-3 space-y-3">
          <GenericBlockEditor block={block} onUpdate={onUpdate} onBlurTrigger={onBlurTrigger} />
          <BlockExtrasSection extras={extras} onUpdate={onUpdateExtras}
            funnelId={funnelId} stepId={stepId} onBlurTrigger={onBlurTrigger} />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// EXTRAS SECTION — per-block additional_prompt + image URLs (paste/upload)
// ══════════════════════════════════════════════════════════════════════════
function BlockExtrasSection({ extras, onUpdate, funnelId, stepId, onBlurTrigger }: {
  extras: BlockExtras; onUpdate: (patch: Partial<BlockExtras>) => void;
  funnelId?: string; stepId?: string; onBlurTrigger?: () => void;
}) {
  const [urlInput, setUrlInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showUploadWarning, setShowUploadWarning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const addUrl = (url: string) => {
    if (!url.trim()) return
    const urls = [...(extras.image_urls || []), url.trim()]
    onUpdate({ image_urls: urls })
    setUrlInput('')
  }
  const removeUrl = (i: number) => {
    const urls = (extras.image_urls || []).filter((_, j) => j !== i)
    onUpdate({ image_urls: urls })
  }

  const uploadFile = async (file: File) => {
    setUploadError(null); setUploading(true); setShowUploadWarning(false)
    try {
      const buf = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/image/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          base64_data: base64,
          funnel_id: funnelId,
          step_id: stepId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
      addUrl(data.url)
    } catch (e: any) { setUploadError(e.message) }
    finally { setUploading(false) }
  }

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          setShowUploadWarning(true)
          await uploadFile(file)
        }
        return
      }
    }
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setShowUploadWarning(true)
    await uploadFile(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="border-t border-neutral-800/50 pt-3 space-y-2" onPaste={onPaste}>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider flex items-center gap-1">
        <Plus className="w-3 h-3" /> Extras cho block này
      </div>
      <div>
        <label className="text-[10px] text-neutral-500 block mb-1">Yêu cầu riêng cho AI regenerate (optional)</label>
        <textarea value={extras.additional_prompt || ''}
          onChange={e => onUpdate({ additional_prompt: e.target.value })}
          onBlur={onBlurTrigger}
          rows={2}
          className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs"
          placeholder='VD: "Dùng ảnh làm background section", "CTA màu đỏ", "Icon lucide sao"' />
      </div>
      <div>
        <label className="text-[10px] text-neutral-500 block mb-1 flex items-center gap-1">
          <ImageIcon className="w-3 h-3" /> Ảnh dùng trong block
          {(extras.image_urls?.length || 0) > 0 && <span className="text-blue-400">({extras.image_urls?.length})</span>}
        </label>
        {(extras.image_urls || []).map((url, i) => (
          <div key={i} className="flex items-center gap-2 mb-1 p-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs">
            <img src={url} alt="" className="w-10 h-10 object-cover rounded flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <div className="flex-1 truncate text-neutral-400 font-mono text-[10px]">{url}</div>
            <button onClick={() => removeUrl(i)} className="text-neutral-500 hover:text-red-400"><X className="w-3 h-3" /></button>
          </div>
        ))}
        <div className="flex gap-1 mt-1">
          <div className="flex-1 flex gap-1">
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addUrl(urlInput))}
              onBlur={onBlurTrigger}
              className="flex-1 px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-[11px] font-mono"
              placeholder="Paste URL ảnh (Imgur, Cloudinary, CDN riêng...)" />
            <button onClick={() => addUrl(urlInput)} disabled={!urlInput.trim()}
              className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-[11px] disabled:opacity-40 flex items-center gap-0.5">
              <Link2 className="w-3 h-3" /> URL
            </button>
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-[11px] disabled:opacity-40 flex items-center gap-0.5"
            title="Upload lên Supabase Storage (tốn quota)">
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Upload
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
        </div>
        {showUploadWarning && (
          <p className="text-[10px] text-amber-400 mt-1">
            ⚠ Upload sẽ dùng Supabase Storage quota. Ưu tiên paste URL từ CDN riêng nếu có.
          </p>
        )}
        <p className="text-[10px] text-neutral-600 mt-1">
          💡 Có thể paste screenshot (Ctrl+V) trong khu vực này — tự upload lên Supabase.
        </p>
        {uploadError && <p className="text-[10px] text-red-400 mt-1">{uploadError}</p>}
      </div>
    </div>
  )
}

// Generic editor that renders inputs for any field in content object.
function GenericBlockEditor({ block, onUpdate, onBlurTrigger }: { block: Block; onUpdate: (patch: any) => void; onBlurTrigger?: () => void }) {
  const content = block.content || {}
  const keys = Object.keys(content)

  if (keys.length === 0) {
    return <p className="text-xs text-neutral-500 italic">Empty content — will show as raw JSON.</p>
  }

  return (
    <div className="space-y-2">
      {keys.map(k => (
        <FieldEditor key={k} label={k} value={content[k]}
          onChange={v => onUpdate({ [k]: v })} onBlurTrigger={onBlurTrigger} />
      ))}
    </div>
  )
}

function FieldEditor({ label, value, onChange, onBlurTrigger }: { label: string; value: any; onChange: (v: any) => void; onBlurTrigger?: () => void }) {
  // String
  if (typeof value === 'string') {
    const isLong = value.length > 80 || value.includes('\n')
    return (
      <div>
        <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">{label}</label>
        {isLong ? (
          <textarea value={value} onChange={e => onChange(e.target.value)} onBlur={onBlurTrigger}
            className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-xs resize-y" rows={3} />
        ) : (
          <input value={value} onChange={e => onChange(e.target.value)} onBlur={onBlurTrigger}
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
