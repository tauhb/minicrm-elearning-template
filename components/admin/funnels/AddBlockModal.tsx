import React, { useState } from 'react'
import { X, Wand2, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../../../services/supabase'

export interface Block {
  kind: string
  content: any
}

interface CatalogItem {
  kind: string
  label: string
  desc: string
  group: string
  emoji: string
  defaultContent: any
}

const CATALOG: CatalogItem[] = [
  { kind: 'hero',              label: 'Hero',              group: 'Hook',    emoji: '🪝', desc: 'Big headline + subheadline + CTA', defaultContent: { headline: '', subheadline: '', cta_text: 'Đăng ký ngay' } },
  { kind: 'hero-video',        label: 'Hero + Video',      group: 'Hook',    emoji: '🎬', desc: 'Hero với video embed', defaultContent: { headline: '', subheadline: '', cta_text: 'Xem ngay', video_url: '' } },
  { kind: 'hero-split',        label: 'Hero split-column', group: 'Hook',    emoji: '↔️', desc: 'Text trái + visual phải', defaultContent: { headline: '', subheadline: '', cta_text: 'Bắt đầu', visual_hint: '' } },

  { kind: 'pain-list',         label: 'Pain points list',  group: 'Problem', emoji: '⚠️', desc: '3-5 pain bullets', defaultContent: { title: 'Bạn có phải đang gặp?', bullets: ['', '', ''] } },
  { kind: 'pain-story',        label: 'Pain story',        group: 'Problem', emoji: '📖', desc: 'Story narrative', defaultContent: { title: '', story: '' } },

  { kind: 'solution-reveal',   label: 'Solution reveal',   group: 'Solution', emoji: '💡', desc: 'Intro giải pháp', defaultContent: { title: 'Giới thiệu giải pháp', body: '', tagline: '' } },
  { kind: 'feature-benefit',   label: 'Feature-Benefit',   group: 'Solution', emoji: '✨', desc: 'Features → benefits', defaultContent: { title: 'Bạn nhận được gì?', items: [{ feature: '', benefit: '' }, { feature: '', benefit: '' }, { feature: '', benefit: '' }] } },
  { kind: 'mechanism',         label: 'Why it works',      group: 'Solution', emoji: '⚙️', desc: 'Cơ chế hoạt động', defaultContent: { title: 'Cách hoạt động', steps: [{ name: '', description: '' }, { name: '', description: '' }] } },

  { kind: 'testimonials-grid', label: 'Testimonials grid', group: 'Proof',   emoji: '⭐', desc: '3-6 testimonials', defaultContent: { title: 'Học viên nói gì?', items: [{ quote: '', author_name: '', author_title: '' }, { quote: '', author_name: '', author_title: '' }] } },
  { kind: 'testimonial-quote', label: 'Single quote',      group: 'Proof',   emoji: '💬', desc: '1 quote lớn', defaultContent: { quote: '', author_name: '', author_title: '' } },
  { kind: 'stats-numbers',     label: 'Stats numbers',     group: 'Proof',   emoji: '📊', desc: 'Number + label grid', defaultContent: { title: '', items: [{ number: '', label: '' }, { number: '', label: '' }, { number: '', label: '' }] } },
  { kind: 'logos-strip',       label: 'Logos strip',       group: 'Proof',   emoji: '🏢', desc: 'Company/media logos', defaultContent: { title: '', logos: [{ name: '' }, { name: '' }] } },
  { kind: 'case-study',        label: 'Case study',        group: 'Proof',   emoji: '📚', desc: '1 deep before-after', defaultContent: { title: '', subject_name: '', before: '', after: '', quote: '' } },

  { kind: 'pricing-table',     label: 'Pricing table',     group: 'Offer',   emoji: '💰', desc: 'Multiple tiers', defaultContent: { title: 'Gói dịch vụ', tiers: [{ name: 'Basic', price: '', features: [''], cta_text: 'Chọn gói này' }, { name: 'Pro', price: '', features: [''], highlighted: true, cta_text: 'Chọn gói này' }] } },
  { kind: 'pricing-single',    label: 'Single pricing',    group: 'Offer',   emoji: '🎯', desc: '1 offer, không tiers', defaultContent: { name: '', price: '', price_anchor: '', features: [''], cta_text: 'Đăng ký ngay' } },
  { kind: 'bonus-stack',       label: 'Bonus stack',       group: 'Offer',   emoji: '🎁', desc: 'Value stack bonuses', defaultContent: { title: 'Bonuses miễn phí', items: [{ name: '', description: '', value_note: '' }] } },
  { kind: 'guarantee',         label: 'Guarantee',         group: 'Offer',   emoji: '🛡️', desc: 'Risk reversal', defaultContent: { title: 'Đảm bảo hoàn tiền', body: '', days: 14 } },

  { kind: 'countdown',         label: 'Countdown timer',   group: 'Urgency', emoji: '⏰', desc: 'JS countdown', defaultContent: { title: 'Ưu đãi kết thúc trong', target_date_hint: 'vd: 30/09/2026 23:59', subtext: '' } },
  { kind: 'scarcity-list',     label: 'Scarcity items',    group: 'Urgency', emoji: '🔥', desc: 'Limited slots/qty', defaultContent: { title: '', items: [''] } },

  { kind: 'faq-accordion',     label: 'FAQ accordion',     group: 'Info',    emoji: '❓', desc: '5-8 Q&A', defaultContent: { title: 'Câu hỏi thường gặp', items: [{ question: '', answer: '' }, { question: '', answer: '' }] } },
  { kind: 'comparison-table',  label: 'Comparison table',  group: 'Info',    emoji: '⚖️', desc: 'You vs competitors', defaultContent: { title: '', columns: ['Chúng tôi', 'Đối thủ'], rows: [{ feature: '', values: ['', ''] }] } },
  { kind: 'timeline',          label: 'Timeline',          group: 'Info',    emoji: '📅', desc: 'Steps/journey', defaultContent: { title: 'Lộ trình', steps: [{ when: '', title: '', description: '' }] } },

  { kind: 'cta-simple',        label: 'CTA button',        group: 'CTA',     emoji: '👉', desc: 'Simple centered CTA', defaultContent: { headline: '', cta_text: 'Đăng ký ngay', sub: '' } },
  { kind: 'cta-with-form',     label: 'CTA + form',        group: 'CTA',     emoji: '📝', desc: 'CTA với form inline', defaultContent: { headline: '', sub: '', cta_text: 'Gửi', form_fields_hint: 'name, email' } },
  { kind: 'cta-repeat',        label: 'CTA repeat',        group: 'CTA',     emoji: '🔁', desc: 'Final large CTA', defaultContent: { headline: '', sub: '', cta_text: 'Đăng ký ngay', urgency_note: '' } },
]

const GROUPS = ['Hook', 'Problem', 'Solution', 'Proof', 'Offer', 'Urgency', 'Info', 'CTA']

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}), ...(opts.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export function AddBlockModal({ stepId, onClose, onAdd }: {
  stepId: string
  onClose: () => void
  onAdd: (block: Block) => void
}) {
  const [customIntent, setCustomIntent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickKnown = (item: CatalogItem) => {
    onAdd({ kind: item.kind, content: JSON.parse(JSON.stringify(item.defaultContent)) })
    onClose()
  }

  const generateCustom = async () => {
    if (!customIntent.trim()) return
    setError(null); setGenerating(true)
    try {
      const r = await api<{ block: Block }>(`/api/funnel-steps?action=generate-block&id=${stepId}`, {
        method: 'POST',
        body: JSON.stringify({ intent: customIntent, hint_kind: 'custom' }),
      })
      onAdd(r.block)
      onClose()
    } catch (e: any) { setError(e.message); setGenerating(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-4xl w-full my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: 'var(--color-mission-accent)' }} />
            <h2 className="text-lg font-semibold">Thêm block</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Known types */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-neutral-400">Chọn loại block</h3>
            <div className="space-y-4">
              {GROUPS.map(group => (
                <div key={group}>
                  <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">{group}</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {CATALOG.filter(c => c.group === group).map(item => (
                      <button key={item.kind} onClick={() => pickKnown(item)}
                        className="text-left px-3 py-2 rounded-lg border border-neutral-800 hover:border-primary hover:bg-neutral-800/50 transition"
                        style={{ borderColor: 'transparent' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-mission-accent)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '' }}>
                        <div className="text-xs font-medium flex items-center gap-1">
                          <span>{item.emoji}</span> {item.label}
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">{item.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom AI generate */}
          <div className="border-t border-neutral-800 pt-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Wand2 className="w-4 h-4" style={{ color: 'var(--color-mission-accent)' }} />
              🎨 Custom block — AI tự sáng tạo
            </h3>
            <p className="text-xs text-neutral-500 mb-3">
              Không tìm thấy block phù hợp trên? Mô tả block anh muốn, AI sẽ generate.
            </p>
            <textarea value={customIntent} onChange={e => setCustomIntent(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm" rows={3}
              placeholder="VD: 'Timeline lộ trình 30 ngày, mỗi ngày 1 topic ngắn', 'Interactive quiz 3 câu hỏi', 'Comparison giữa cách cũ vs cách mới với icons'" />
            {error && <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">{error}</div>}
            <button onClick={generateCustom} disabled={generating || !customIntent.trim()}
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Generate với AI
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
