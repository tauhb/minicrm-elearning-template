/**
 * services/prompt-composer.ts — Compose system + user prompts for content-first workflow.
 *
 * Draft phase:  [type.prompt OR custom_prompt] + [formula.prompt] + [block catalog] + [runtime JSON rules]
 * Render phase: [type.prompt OR custom_prompt] + [style instructions] + [block-to-HTML guide] + [runtime HTML rules]
 */

import { createClient } from '@supabase/supabase-js'
import { getBlockCatalogPrompt } from './funnel-blocks'
import { resolveStepContext, renderContextBlock } from './funnel-context'

const DRAFT_RUNTIME_RULES = `
# RUNTIME OUTPUT RULES (BẮT BUỘC)
- Output PHẢI là JSON valid: \`{ "blocks": [ { "kind": "<kind>", "content": {...} }, ... ] }\`
- KHÔNG wrap trong markdown code fence
- KHÔNG giải thích, KHÔNG comment, chỉ pure JSON
- Content tiếng Việt, KHÔNG dùng "anh/chị", chỉ dùng "bạn"
- Mỗi block content phải match contentShape của kind đó
`

const HTML_RUNTIME_RULES = `
# RUNTIME OUTPUT RULES (BẮT BUỘC)
- Output PHẢI là HTML hoàn chỉnh: <!DOCTYPE html> + <head> + <body>
- Tailwind CSS qua CDN: <script src="https://cdn.tailwindcss.com"></script>
- Font: Google Fonts (theo style instructions)
- Responsive mobile-first
- KHÔNG markdown wrapper, chỉ HTML thuần
- Copy tiếng Việt, dùng "bạn"

## Quy ước link/CTA (BẮT BUỘC)
- **Scroll trong page** (VD "Xem chi tiết", "Xem pricing"): dùng \`<a href="#section-id">\` — **KHÔNG** có \`data-cta\`. Section đích phải có \`id="section-id"\`.
- **Primary CTA** (advance funnel — "Đăng ký ngay", "Mua ngay"): dùng \`<a data-cta="1">\` hoặc \`<button data-cta="1">\` — **KHÔNG** cần href, portal tự inject.
- **External link** (Zalo, YouTube): \`<a href="https://..." target="_blank">\` — không data-cta.

## Quy ước Form (BẮT BUỘC)
- Form phải có \`data-form="1"\` — portal tự inject action, method, hidden funnel_id/step_id.
- Input name attribute phải khớp form_fields config.
`

const BLOCK_RUNTIME_RULES = `
# RUNTIME OUTPUT RULES (BẮT BUỘC — render 1 BLOCK duy nhất)
- Output PHẢI là 1 <section> element duy nhất (hoặc <div>) — KHÔNG có <!DOCTYPE>, <html>, <head>, <body>
- Section dùng Tailwind classes (Tailwind CDN sẽ load ở shell)
- Responsive: mobile-first classes (md:, lg:)
- Copy tiếng Việt, "bạn" (không "anh/chị")
- KHÔNG markdown wrapper, chỉ HTML section
- Section padding: py-16 md:py-24. Container: max-w-6xl mx-auto px-6

## Quy ước link/CTA (BẮT BUỘC)
- **Scroll link** ("Xem chi tiết", "Xem giá"): \`<a href="#section-id">\` — KHÔNG có \`data-cta\`. Đảm bảo section đích có \`id="section-id"\`.
- **Primary CTA** ("Đăng ký ngay", "Mua ngay"): \`<a data-cta="1">\` hoặc \`<button data-cta="1">\` — KHÔNG cần href.
- **Upsell page — CHỈ khi step_type="upsell"**:
  - Nút CÓ (nhận offer): \`<button data-cta="upsell-yes">CÓ, tôi lấy thêm</button>\`
  - Nút KHÔNG (bỏ qua): \`<a data-cta="upsell-no">Cảm ơn, tôi chỉ cần đơn này</a>\`
  - Cả 2 nút phải nằm cạnh nhau, style rõ ràng: YES = brand color, NO = subtle/outline text
- **External**: \`<a href="https://..." target="_blank">\`

## Form (BẮT BUỘC)
- \`<form data-form="1">\` — portal tự inject action/method/hidden funnel_id/step_id.
- Input name đúng theo form_fields config.
`

const BLOCK_TO_HTML_GUIDE = `
# BLOCK → HTML RENDERING GUIDE

Render mỗi block theo semantic + Tailwind. Ví dụ:
- \`hero\`: <section class="min-h-[80vh] flex items-center px-6 py-20">...</section>
- \`pain-list\`: <section><h2>{title}</h2><ul class="grid md:grid-cols-2 gap-4">{bullets as cards}</ul></section>
- \`testimonials-grid\`: <section><h2>{title}</h2><div class="grid md:grid-cols-3 gap-6">{items as quote cards}</div></section>
- \`pricing-table\`: <section><h2>{title}</h2><div class="grid md:grid-cols-3 gap-4">{tiers, highlight ring nếu highlighted}</div></section>
- \`cta-simple\`, \`cta-repeat\`: centered, large button có \`data-cta="1"\` — KHÔNG cần href (portal inject).
- \`cta-with-form\`: \`<form data-form="1">\` — portal inject action/method/hidden.

**UPSELL steps (page_type="upsell")**: Cuối trang PHẢI có 1 section với 2 nút song song:
  - \`<button data-cta="upsell-yes" class="...brand...">CÓ, tôi lấy thêm ưu đãi này</button>\`
  - \`<a data-cta="upsell-no" class="text-neutral-500 underline">Cảm ơn, tôi chỉ cần đơn hàng này</a>\`
  YES nổi bật (bg brand, font-bold, py-4); NO subtle (link text màu xám).

Với \`kind: "custom"\`: dùng content.html nếu có, else convert content.markdown → HTML.

Section padding chuẩn: py-16 md:py-24. Container max-w-6xl mx-auto. Whitespace generous.
`

export interface StyleInstructions {
  vibe?: 'cyberpunk' | 'minimal' | 'warm' | 'corporate' | 'startup' | 'editorial'
  fontPair?: string           // e.g. 'Inter+Playfair Display'
  layout?: 'airy' | 'balanced' | 'dense'
  density?: 'compact' | 'balanced' | 'spacious'
  brandColor?: string          // hex
}

const VIBE_INSTRUCTIONS: Record<string, string> = {
  cyberpunk: 'Neon dark theme (bg-neutral-950, accent {brandColor} default #B6FF00). Sharp corners, thin borders, monospace headings, glow effects. Gaming/tech feel.',
  minimal: 'Clean white bg (bg-white or bg-neutral-50). Lots of whitespace. Thin borders, subtle shadows. No gradients. Focus on content.',
  warm: 'Warm cream/beige palette (bg-amber-50, text-stone-800). Rounded-2xl. Soft shadows. Friendly, lifestyle feel.',
  corporate: 'Navy blue (bg-slate-900, accent blue-600). Structured grid. Serif headlines optional. Professional B2B.',
  startup: 'Purple/pink gradient hero (bg-gradient-to-br from-purple-600 to-pink-500). Bold sans-serif. Playful, energetic.',
  editorial: 'Magazine-style: large serif headlines, drop-caps, generous line-height. Image-heavy layout. Focus on typography.',
}

const FONT_PAIRS: Record<string, string> = {
  'Inter+Playfair Display': 'Google Fonts: Inter (body 400/600) + Playfair Display (headlines, italic optional). Link both in <head>.',
  'Manrope+Fraunces': 'Google Fonts: Manrope (body geometric) + Fraunces (modern serif headlines).',
  'IBM Plex Sans+IBM Plex Serif': 'IBM Plex Sans + IBM Plex Serif. Technical feel.',
  'Space Grotesk+Instrument Serif': 'Space Grotesk (body) + Instrument Serif (headlines). Trendy.',
  'System': 'System font stack (Inter fallback). No Google Fonts load. Safe default.',
}

export function styleInstructionsBlock(s: StyleInstructions): string {
  const lines: string[] = ['# STYLE INSTRUCTIONS', '']
  if (s.vibe) {
    const inst = VIBE_INSTRUCTIONS[s.vibe] || ''
    lines.push(`Vibe: **${s.vibe}** — ${inst.replace('{brandColor}', s.brandColor || '#B6FF00')}`)
  }
  if (s.fontPair) {
    lines.push(`Font pair: **${s.fontPair}** — ${FONT_PAIRS[s.fontPair] || FONT_PAIRS.System}`)
  }
  if (s.layout) lines.push(`Layout: **${s.layout}** — ${s.layout === 'airy' ? 'sections cách nhau 120-160px, padding container 48px+' : s.layout === 'dense' ? 'compact, section 48-64px, less padding' : 'balanced 80-120px between sections'}`)
  if (s.density) lines.push(`Density: **${s.density}** — ${s.density === 'compact' ? 'max 3 bullets per section, tight' : s.density === 'spacious' ? 'longer paragraphs, more breathing room' : 'balanced 4-6 bullets max'}`)
  if (s.brandColor) lines.push(`Brand accent color: **${s.brandColor}** — dùng cho CTA, links, hover states`)
  return lines.join('\n')
}

// ─── DB helpers ──────────────────────────────────────────────────────────────
export interface ComposeDraftInput {
  funnelId: string
  stepId: string
  formulaKey: string
  rawInput: string
  sharedContext: Record<string, any>
  stepMeta: { name: string; page_type: string; has_form: boolean }
}

export interface ComposeRenderInput {
  funnelId: string
  stepId: string
  copyDraft: any               // { blocks: [...] }
  style: StyleInstructions
  stepMeta: { name: string; page_type: string; has_form: boolean; form_fields?: any[] }
}

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** Resolve base prompt: funnel.custom_prompt if set, else type.system_prompt. */
async function resolveBasePrompt(funnelId: string): Promise<{ prompt: string; source: 'custom' | 'type' }> {
  const db = adminDb()
  const { data: flow } = await db.from('funnel_flows')
    .select('custom_prompt, type_key').eq('id', funnelId).single()
  if (flow?.custom_prompt && flow.custom_prompt.trim()) {
    return { prompt: flow.custom_prompt, source: 'custom' }
  }
  const { data: type } = await db.from('funnel_types')
    .select('system_prompt').eq('key', flow?.type_key || '').maybeSingle()
  return { prompt: type?.system_prompt || '', source: 'type' }
}

/** Load formula prompt by key. */
async function loadFormulaPrompt(key: string): Promise<string> {
  if (!key) return ''
  const db = adminDb()
  const { data } = await db.from('copy_formulas').select('system_prompt').eq('key', key).maybeSingle()
  return data?.system_prompt || ''
}

// ─── PHASE 1: Draft (input → structured JSON) ─────────────────────────────────
export async function composeDraftPrompts(input: ComposeDraftInput): Promise<{ system: string; user: string }> {
  const [base, formulaPrompt, catalog, ctx] = await Promise.all([
    resolveBasePrompt(input.funnelId),
    loadFormulaPrompt(input.formulaKey),
    Promise.resolve(getBlockCatalogPrompt()),
    resolveStepContext(input.stepId),
  ])

  const parts: string[] = []
  if (base.prompt) parts.push(base.prompt)
  if (ctx) parts.push('---\n\n' + renderContextBlock(ctx))
  if (formulaPrompt) parts.push('---\n\n# COPY FORMULA\n\n' + formulaPrompt)
  parts.push('---\n\n' + catalog)
  parts.push('---\n\n' + DRAFT_RUNTIME_RULES)

  const system = parts.join('\n\n')

  const userLines: string[] = [
    `# User Raw Input for this step`,
    input.rawInput || '(user chưa nhập, dùng FUNNEL CONTEXT + shared context làm chính)',
    ``,
    `# Task`,
    `Sinh copy_draft JSON theo formula ở trên + block catalog. Số lượng blocks phù hợp page_type "${input.stepMeta.page_type}".`,
    `BẮT BUỘC dùng thông tin sản phẩm/giá/next-step từ FUNNEL CONTEXT ở system prompt — không viết chung chung.`,
  ]

  return { system, user: userLines.join('\n') }
}

// ─── PHASE 2B: Per-block render (avoid max-output-tokens + parallelize) ────────
export interface BlockExtras {
  additional_prompt?: string   // Per-block requirement
  image_urls?: string[]         // Images to embed
}
export interface ComposeBlockRenderInput {
  funnelId: string
  stepId?: string                // NEW: enables FUNNEL CONTEXT injection
  block: { kind: string; content: any; extras?: BlockExtras }
  style: StyleInstructions
  stepMeta: { name: string; page_type: string; has_form: boolean; form_fields?: any[] }
  renderInstructions?: string    // Step-level extra requirements
}

export async function composeBlockRenderPrompts(input: ComposeBlockRenderInput): Promise<{ system: string; user: string }> {
  const [base, ctx] = await Promise.all([
    resolveBasePrompt(input.funnelId),
    input.stepId ? resolveStepContext(input.stepId) : Promise.resolve(null),
  ])

  const parts: string[] = []
  if (base.prompt) parts.push(base.prompt)
  if (ctx) parts.push('---\n\n' + renderContextBlock(ctx))
  parts.push('---\n\n' + styleInstructionsBlock(input.style))
  parts.push('---\n\n' + BLOCK_TO_HTML_GUIDE)
  if (input.renderInstructions && input.renderInstructions.trim()) {
    parts.push('---\n\n# YÊU CẦU BỔ SUNG CHO STEP (BẮT BUỘC ÁP DỤNG)\n\n' + input.renderInstructions.trim())
  }
  const extras = input.block.extras
  const extraLines: string[] = []
  if (extras?.additional_prompt && extras.additional_prompt.trim()) {
    extraLines.push(`Requirements for this block: ${extras.additional_prompt.trim()}`)
  }
  if (extras?.image_urls && extras.image_urls.length > 0) {
    extraLines.push(`Images available for this block (embed in HTML — sử dụng <img> hoặc background):`)
    extras.image_urls.forEach(u => extraLines.push(`- ${u}`))
  }
  if (extraLines.length > 0) {
    parts.push('---\n\n# YÊU CẦU RIÊNG CHO BLOCK NÀY\n\n' + extraLines.join('\n'))
  }
  parts.push('---\n\n' + BLOCK_RUNTIME_RULES)

  const system = parts.join('\n\n')

  const userLines: string[] = [
    `# Render 1 block cho step: ${input.stepMeta.name} (${input.stepMeta.page_type})`,
    ``,
    `# Block content`,
    `Kind: **${input.block.kind}**`,
    ``,
    '```json',
    JSON.stringify(input.block.content, null, 2),
    '```',
    ``,
  ]
  if (input.stepMeta.has_form && input.block.kind.includes('form') && input.stepMeta.form_fields?.length) {
    userLines.push(`# Form fields (BẮT BUỘC render với đúng name attributes)`)
    for (const f of input.stepMeta.form_fields) {
      userLines.push(`- name="${f.name}" type="${f.type}" ${f.required ? 'required' : ''} label="${f.label}"`)
    }
    userLines.push('')
  }
  userLines.push(
    `# Task`,
    `Render block này thành 1 <section> HTML với Tailwind. Giữ content text đúng. Follow BLOCK_RUNTIME_RULES.`,
  )

  return { system, user: userLines.join('\n') }
}

/**
 * Build HTML shell (head + body wrapper) around concatenated block HTMLs.
 * Static — no AI call needed. Includes Tailwind CDN + Google Fonts + form JS.
 */
export function buildHtmlShell(opts: {
  title: string
  description?: string
  style: StyleInstructions
  bodyContent: string
}): string {
  const font = opts.style.fontPair || 'Inter+Playfair Display'
  const fontLinks = fontPairToGoogleFontsHref(font)
  const bodyFont = fontFamily(font, 'body')
  const headingFont = fontFamily(font, 'heading')
  const brand = opts.style.brandColor || '#B6FF00'
  const desc = opts.description?.trim()

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title>
${desc ? `<meta name="description" content="${escapeHtml(desc)}">` : ''}
${desc ? `<meta property="og:description" content="${escapeHtml(desc)}">` : ''}
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:type" content="website">
<script src="https://cdn.tailwindcss.com"></script>
${fontLinks}
<style>
  :root { --brand: ${brand}; }
  body { font-family: ${bodyFont}; }
  h1, h2, h3, h4 { font-family: ${headingFont}; }
  [data-cta="1"], [data-cta="next"], [data-cta="upsell-yes"] { background: var(--brand); color: #0a0a0a; transition: opacity .2s; cursor: pointer; }
  [data-cta="1"]:hover, [data-cta="next"]:hover, [data-cta="upsell-yes"]:hover { opacity: 0.9; }
  [data-cta="upsell-no"] { color: #6b7280; text-decoration: underline; cursor: pointer; }
  [data-cta="upsell-no"]:hover { color: #374151; }
</style>
</head>
<body class="bg-white text-neutral-900">
${opts.bodyContent}
</body>
</html>`
}

const FONT_PAIR_MAP: Record<string, { body: string; heading: string; family: [string, string] }> = {
  'Inter+Playfair Display':      { body: 'Inter, system-ui, sans-serif', heading: '"Playfair Display", Georgia, serif', family: ['Inter:wght@400;500;600;700', 'Playfair+Display:wght@400;700;900&display=swap'] },
  'Manrope+Fraunces':             { body: 'Manrope, system-ui, sans-serif', heading: '"Fraunces", Georgia, serif', family: ['Manrope:wght@400;500;700', 'Fraunces:wght@400;700;900&display=swap'] },
  'IBM Plex Sans+IBM Plex Serif': { body: '"IBM Plex Sans", sans-serif', heading: '"IBM Plex Serif", Georgia, serif', family: ['IBM+Plex+Sans:wght@400;500;700', 'IBM+Plex+Serif:wght@400;700&display=swap'] },
  'Space Grotesk+Instrument Serif': { body: '"Space Grotesk", sans-serif', heading: '"Instrument Serif", Georgia, serif', family: ['Space+Grotesk:wght@400;500;700', 'Instrument+Serif:wght@400&display=swap'] },
  'System': { body: 'system-ui, -apple-system, sans-serif', heading: 'system-ui, -apple-system, sans-serif', family: [] },
}

function fontFamily(pair: string, which: 'body' | 'heading'): string {
  return (FONT_PAIR_MAP[pair] || FONT_PAIR_MAP.System)[which]
}

function fontPairToGoogleFontsHref(pair: string): string {
  const p = FONT_PAIR_MAP[pair] || FONT_PAIR_MAP.System
  if (!p.family.length) return ''
  const families = p.family.map(f => `family=${f}`).join('&')
  return `<link href="https://fonts.googleapis.com/css2?${families}" rel="stylesheet">`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── PHASE 2: Render (JSON → HTML) ────────────────────────────────────────────
export async function composeRenderPrompts(input: ComposeRenderInput): Promise<{ system: string; user: string }> {
  const base = await resolveBasePrompt(input.funnelId)

  const parts: string[] = []
  if (base.prompt) parts.push(base.prompt)
  parts.push('---\n\n' + styleInstructionsBlock(input.style))
  parts.push('---\n\n' + BLOCK_TO_HTML_GUIDE)
  parts.push('---\n\n' + HTML_RUNTIME_RULES)

  const system = parts.join('\n\n')

  const userLines: string[] = [
    `# Step: ${input.stepMeta.name} (${input.stepMeta.page_type})`,
    ``,
    `# Approved Copy Draft (JSON)`,
    '```json',
    JSON.stringify(input.copyDraft, null, 2),
    '```',
    ``,
  ]
  if (input.stepMeta.has_form && input.stepMeta.form_fields?.length) {
    userLines.push(`# Form Fields (BẮT BUỘC render với đúng name attributes)`)
    for (const f of input.stepMeta.form_fields) {
      userLines.push(`- name="${f.name}" type="${f.type}" ${f.required ? 'required' : ''} label="${f.label}"`)
    }
    userLines.push('')
  }
  userLines.push(
    `# Task`,
    `Render copy_draft JSON thành HTML landing page hoàn chỉnh với style ở trên. Áp dụng block-to-HTML guide. Giữ nội dung text đúng, không sửa copy.`,
  )

  return { system, user: userLines.join('\n') }
}
