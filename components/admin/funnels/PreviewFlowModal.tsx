import React, { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2, ArrowRight, RefreshCw, ExternalLink } from 'lucide-react'
import { supabase } from '../../../services/supabase'

interface StepShort {
  id: string
  slug: string
  name: string
  step_number: number
  has_html: boolean
}

export function PreviewFlowModal({
  funnelId, funnelSlug, funnelName, steps, onClose,
}: {
  funnelId: string
  funnelSlug: string
  funnelName: string
  steps: StepShort[]
  onClose: () => void
}) {
  const validSteps = steps.filter(s => s.has_html).sort((a, b) => a.step_number - b.step_number)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eventLog, setEventLog] = useState<string[]>([])

  const current = validSteps[currentIndex]

  const load = useCallback(async (step: StepShort) => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/f/preview?funnel=${encodeURIComponent(funnelSlug)}&step=${encodeURIComponent(step.slug)}`, {
        headers: session ? { 'Authorization': `Bearer ${session.access_token}` } : {},
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t.slice(0, 300))
      }
      const htmlText = await res.text()
      setHtml(htmlText)
    } catch (e: any) { setError(e.message); setHtml('') }
    finally { setLoading(false) }
  }, [funnelSlug])

  useEffect(() => {
    if (current) load(current)
  }, [current?.id, load])

  // Listen to iframe messages (form submit, CTA click) → advance to next step
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === 'preview:form_submit') {
        setEventLog(l => [...l.slice(-9), `📥 Form submitted at "${current?.name}" — advancing to next step`])
        setTimeout(() => next(), 500)
      } else if (e.data.type === 'preview:cta_click') {
        setEventLog(l => [...l.slice(-9), `🖱 CTA clicked at "${current?.name}": "${(e.data.text || '').slice(0, 60)}"`])
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [current, currentIndex])

  const next = () => {
    if (currentIndex < validSteps.length - 1) setCurrentIndex(currentIndex + 1)
  }
  const prev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }
  const reload = () => current && load(current)

  if (validSteps.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full p-6 text-center">
          <p className="text-neutral-400 mb-4">Chưa có step nào có HTML để preview.</p>
          <p className="text-xs text-neutral-500 mb-4">Draft copy → Approve HTML cho ít nhất 1 step trước.</p>
          <button onClick={onClose} className="text-sm text-neutral-500 hover:text-white">Đóng</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col p-4">
      {/* Header */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-t-xl px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              🔍 Preview Flow: {funnelName}
              <span className="text-xs text-neutral-500 font-normal">({currentIndex + 1}/{validSteps.length})</span>
            </div>
            <div className="text-xs text-neutral-500 font-mono">/f/{funnelSlug}/{current?.slug}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} disabled={loading} className="p-1.5 hover:bg-neutral-800 rounded" title="Reload">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <a href={`/f/${funnelSlug}/${current?.slug}`} target="_blank" rel="noopener noreferrer"
             className="p-1.5 hover:bg-neutral-800 rounded" title="Open in new tab (real page)">
            <ExternalLink className="w-4 h-4" />
          </a>
          <button onClick={onClose} className="p-1.5 hover:bg-neutral-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Step nav */}
      <div className="bg-neutral-900/80 border-x border-neutral-800 px-4 py-2 flex items-center gap-2 overflow-x-auto flex-shrink-0">
        {validSteps.map((s, i) => (
          <React.Fragment key={s.id}>
            <button onClick={() => setCurrentIndex(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition ${
                i === currentIndex ? '' : 'border-neutral-800 hover:border-neutral-700 text-neutral-500'
              }`}
              style={i === currentIndex ? { borderColor: 'var(--color-mission-accent)', color: 'var(--color-mission-accent)' } : undefined}>
              <span className="w-4 h-4 rounded-full bg-neutral-800 text-[10px] flex items-center justify-center">{s.step_number}</span>
              {s.name}
            </button>
            {i < validSteps.length - 1 && <ArrowRight className="w-3 h-3 text-neutral-700" />}
          </React.Fragment>
        ))}
      </div>

      {/* Iframe area */}
      <div className="flex-1 bg-white border-x border-neutral-800 min-h-0 flex">
        {loading ? (
          <div className="flex-1 flex items-center justify-center bg-neutral-950 text-neutral-500">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center bg-neutral-950 text-red-400 p-6 text-sm">{error}</div>
        ) : (
          <iframe srcDoc={html} className="flex-1 w-full bg-white" title="Preview" sandbox="allow-scripts allow-same-origin allow-forms" />
        )}
      </div>

      {/* Footer with prev/next + event log */}
      <div className="bg-neutral-900 border border-neutral-800 border-t-0 rounded-b-xl px-4 py-2 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-2">
          <button onClick={prev} disabled={currentIndex === 0} className="flex items-center gap-1 px-3 py-1.5 border border-neutral-700 rounded text-xs hover:bg-neutral-800 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <button onClick={next} disabled={currentIndex === validSteps.length - 1} className="flex items-center gap-1 px-3 py-1.5 border border-neutral-700 rounded text-xs hover:bg-neutral-800 disabled:opacity-30">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 text-xs text-neutral-500 truncate">
          {eventLog[eventLog.length - 1] || '💡 Bấm CTA hoặc submit form trong preview để test navigation'}
        </div>
      </div>
    </div>
  )
}
