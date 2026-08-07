import React, { useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  maxTags?: number
}

/**
 * Shared tag editor (chip list + inline input).
 * UX: Enter or "," commits. Backspace on empty input removes last chip.
 * Comma-separated paste splits into multiple chips. Trimmed + dedupe (case-insensitive).
 */
const TagsEditor: React.FC<Props> = ({ value, onChange, placeholder, maxTags }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState('')

  const normalize = (raw: string) =>
    raw.trim().toLowerCase().replace(/[,;]/g, '').replace(/\s+/g, ' ')

  const commit = (raws: string[]) => {
    let next = [...value]
    for (const r of raws) {
      const t = normalize(r)
      if (!t) continue
      if (next.map(x => x.toLowerCase()).includes(t)) continue
      if (maxTags && next.length >= maxTags) break
      next.push(t)
    }
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  const remove = (tag: string) => {
    onChange(value.filter(t => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) commit([draft])
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (text.includes(',') || text.includes(';') || text.includes('\n')) {
      e.preventDefault()
      commit(text.split(/[,;\n]/))
    }
  }

  const handleBlur = () => {
    if (draft.trim()) commit([draft])
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 min-h-[2.25rem] bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-2 cursor-text focus-within:border-neutral-700 transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map(tag => (
        <span
          key={tag}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-neutral-700 bg-neutral-800 text-neutral-200"
        >
          {tag}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); remove(tag) }}
            className="text-neutral-500 hover:text-white transition-colors"
            aria-label={`Xoá tag ${tag}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? (placeholder || 'Thêm tag... (Enter để xác nhận)') : ''}
        className="flex-1 min-w-[120px] bg-transparent text-xs text-white placeholder-neutral-600 outline-none"
      />
    </div>
  )
}

export default TagsEditor
