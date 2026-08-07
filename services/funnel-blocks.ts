/**
 * services/funnel-blocks.ts — Hybrid block schema catalog for content-first workflow.
 *
 * 20 known block kinds. AI can also propose kind='custom' for creative escapes.
 * Editor renders known blocks with proper UI, custom with generic markdown editor.
 */

export interface BlockSchema {
  kind: string
  label: string
  group: 'hook' | 'problem' | 'solution' | 'proof' | 'offer' | 'urgency' | 'info' | 'cta' | 'custom'
  description: string
  contentShape: string   // Human-readable schema hint for AI
}

export const BLOCK_CATALOG: BlockSchema[] = [
  // Hook
  { kind: 'hero',        label: 'Hero',              group: 'hook',    description: 'Big headline + subheadline + CTA',
    contentShape: '{ headline, subheadline, cta_text, cta_url?, background_hint? }' },
  { kind: 'hero-video',  label: 'Hero with Video',   group: 'hook',    description: 'Hero with video embed placeholder',
    contentShape: '{ headline, subheadline, video_url?, video_placeholder, cta_text }' },
  { kind: 'hero-split',  label: 'Hero split-column', group: 'hook',    description: 'Text left, image/visual right',
    contentShape: '{ headline, subheadline, cta_text, visual_hint }' },

  // Problem
  { kind: 'pain-list',   label: 'Pain points list',  group: 'problem', description: '3-5 pain point bullets',
    contentShape: '{ title, bullets: string[] }' },
  { kind: 'pain-story',  label: 'Pain story',        group: 'problem', description: 'Short narrative agitating pain',
    contentShape: '{ title, story: string (3-6 paragraphs) }' },

  // Solution
  { kind: 'solution-reveal', label: 'Solution reveal', group: 'solution', description: 'Intro to your solution',
    contentShape: '{ title, body, tagline? }' },
  { kind: 'feature-benefit', label: 'Feature-Benefit', group: 'solution', description: 'Features with benefits',
    contentShape: '{ title, items: [{feature, benefit}] (3-6 items) }' },
  { kind: 'mechanism',       label: 'Why it works',    group: 'solution', description: 'Explain unique mechanism',
    contentShape: '{ title, steps: [{name, description}] (3-5 steps) }' },

  // Proof
  { kind: 'testimonials-grid', label: 'Testimonials grid', group: 'proof', description: 'Multiple testimonial cards',
    contentShape: '{ title, items: [{quote, author_name, author_title?, avatar_hint?}] }' },
  { kind: 'testimonial-quote', label: 'Single testimonial', group: 'proof', description: 'Large featured quote',
    contentShape: '{ quote, author_name, author_title?, avatar_hint? }' },
  { kind: 'stats-numbers',     label: 'Stats numbers',    group: 'proof', description: 'Number+label grid',
    contentShape: '{ title?, items: [{number, label}] (3-4 items) }' },
  { kind: 'logos-strip',       label: 'Logos strip',      group: 'proof', description: 'Company/media logos',
    contentShape: '{ title?, logos: [{name, url?}] }' },
  { kind: 'case-study',        label: 'Case study',       group: 'proof', description: 'One deep before-after story',
    contentShape: '{ title, subject_name, before, after, quote }' },

  // Offer
  { kind: 'pricing-table',  label: 'Pricing table',   group: 'offer', description: 'Multiple pricing tiers',
    contentShape: '{ title?, tiers: [{name, price, price_note?, features: string[], highlighted?, cta_text}] }' },
  { kind: 'pricing-single', label: 'Single pricing',  group: 'offer', description: 'One offer, no tiers',
    contentShape: '{ name, price, price_anchor?, features: string[], cta_text }' },
  { kind: 'bonus-stack',    label: 'Bonus stack',     group: 'offer', description: 'Value stack bonuses',
    contentShape: '{ title, items: [{name, description, value_note}], total_value? }' },
  { kind: 'guarantee',      label: 'Guarantee',       group: 'offer', description: 'Risk reversal',
    contentShape: '{ title, body, days?: number }' },

  // Urgency
  { kind: 'countdown',      label: 'Countdown timer', group: 'urgency', description: 'JS countdown to date',
    contentShape: '{ title, target_date_hint, subtext? }' },
  { kind: 'scarcity-list',  label: 'Scarcity items',  group: 'urgency', description: 'Limited slots/qty',
    contentShape: '{ title, items: string[] }' },

  // Info
  { kind: 'faq-accordion',  label: 'FAQ',             group: 'info', description: 'Accordion Q&A',
    contentShape: '{ title, items: [{question, answer}] (5-8 items) }' },
  { kind: 'comparison-table', label: 'Comparison',    group: 'info', description: 'You vs competitors',
    contentShape: '{ title, columns: string[], rows: [{feature, values: string[]}] }' },
  { kind: 'timeline',       label: 'Timeline',        group: 'info', description: 'Steps/journey over time',
    contentShape: '{ title, steps: [{when, title, description}] }' },

  // CTA
  { kind: 'cta-simple',     label: 'CTA button',      group: 'cta', description: 'Simple centered CTA',
    contentShape: '{ headline?, cta_text, sub? }' },
  { kind: 'cta-with-form',  label: 'CTA + form',      group: 'cta', description: 'CTA with inline form',
    contentShape: '{ headline, sub?, cta_text, form_fields_hint }' },
  { kind: 'cta-repeat',     label: 'CTA repeat',      group: 'cta', description: 'Final large CTA',
    contentShape: '{ headline, sub, cta_text, urgency_note? }' },

  // Escape hatch
  { kind: 'custom',         label: 'Custom (AI freeform)', group: 'custom', description: 'AI-designed unique block',
    contentShape: '{ intent: string, html?: string, markdown?: string }' },
]

export function getBlockCatalogPrompt(): string {
  const groups: Record<string, BlockSchema[]> = {}
  for (const b of BLOCK_CATALOG) {
    ;(groups[b.group] ||= []).push(b)
  }
  const lines: string[] = ['# Block Catalog (chọn theo thứ tự + số lượng bạn muốn)', '']
  for (const [g, blocks] of Object.entries(groups)) {
    lines.push(`## ${g.toUpperCase()}`)
    for (const b of blocks) {
      lines.push(`- **${b.kind}** — ${b.description}. Content: \`${b.contentShape}\``)
    }
    lines.push('')
  }
  lines.push('**Output**: JSON `{ "blocks": [ { "kind": "<one from above>", "content": {...} }, ... ] }` — không markdown wrapper.')
  lines.push('**Được sáng tạo**: chọn kind, thứ tự, số lượng. Nếu cần pattern lạ không có trong catalog → dùng `kind: "custom"` với `content: { intent, html?, markdown? }`.')
  return lines.join('\n')
}
