/**
 * services/funnel-generator.ts — AI Funnel Builder
 *
 * Ba loại funnel: leads, sales, webinar.
 * Mỗi loại có system prompt riêng với framework (PAS/AIDA/BAB) + section structure.
 * Output: HTML hoàn chỉnh, self-contained (Tailwind CDN inline).
 */

import { runCompletion, ProviderId } from './ai-router'

export type FunnelType = 'sales' | 'leads' | 'webinar'

export interface FunnelCopyInput {
  // Common
  productName?: string
  audience?: string
  painPoints?: string
  bigPromise?: string
  usp?: string
  cta?: string
  brandColor?: string    // hex, optional (defaults to portal primary)

  // Sales-specific
  offer?: string
  pricing?: string
  bonuses?: string
  guarantee?: string
  testimonials?: string
  urgency?: string

  // Leads-specific
  leadMagnetName?: string
  leadMagnetBenefit?: string

  // Webinar-specific
  webinarTitle?: string
  webinarDate?: string
  webinarSpeaker?: string
  webinarAgenda?: string
}

const COMMON_RULES = `
QUY TẮC BẮT BUỘC:
- Output PHẢI là HTML hoàn chỉnh, bắt đầu <!DOCTYPE html>, có <head> + <body>
- KHÔNG dùng framework. Tailwind CSS qua CDN: <script src="https://cdn.tailwindcss.com"></script> trong <head>
- Font: Inter qua Google Fonts
- Self-contained, không load external JS ngoài Tailwind CDN
- Responsive (mobile-first)
- Copy TIẾNG VIỆT — TUYỆT ĐỐI KHÔNG dùng "anh/chị". Chỉ dùng "bạn"
- CTA button PHẢI có class \`data-cta="1"\` để tracking pixel bắt được click
- Form (nếu có) PHẢI có \`data-form="1"\` và action="#" (portal sẽ intercept submit)
- Không nhồi bullshit "AI-generated". Copy phải như copywriter thật viết.
- Đặt các section theo thứ tự đề xuất, không skip section nào
`

const SALES_SYSTEM = `Bạn là copywriter direct-response chuyên viết sales page tiếng Việt cho thị trường VN.

Áp dụng framework PAS + StoryBrand. Cấu trúc bắt buộc:
1. Hero: headline lớn (BIG PROMISE) + sub-headline (giải thích trong 1 dòng) + CTA đầu tiên
2. Pain agitation: 3-5 nỗi đau cụ thể của target audience (kể theo dạng "Bạn có phải đang...")
3. Solution reveal: giới thiệu offer, giải thích cách nó giải quyết vấn đề
4. Features/benefits (không chỉ features, mỗi feature phải nói ĐƯỢC GÌ)
5. Testimonials/social proof (nếu có input)
6. Pricing section: giá anchor + giá thực + payment plan (nếu có)
7. Bonuses (nếu có): stack value, mỗi bonus 1 dòng + giá trị
8. Guarantee (nếu có): risk reversal
9. Urgency/scarcity (nếu có input)
10. FAQ ngắn (3-5 câu)
11. Final CTA lớn với urgency

Giá VN charm pricing (297k, 997k, 1.997k). CTA button nổi bật.

${COMMON_RULES}`

const LEADS_SYSTEM = `Bạn là copywriter chuyên viết lead magnet landing page tiếng Việt.

Áp dụng AIDA. Cấu trúc bắt buộc:
1. Hero: BIG BENEFIT của lead magnet (không phải feature). CTA form + tên/email
2. What's inside: liệt kê 3-5 điểm chính trong lead magnet
3. Who is this for: mô tả rõ target audience
4. Social proof mini: 1-2 testimonials hoặc "X người đã tải"
5. Author bio ngắn (nếu có input)
6. Final CTA form (repeat CTA)

Form phải có 2 field: name + email. Submit button rõ ràng. Không hỏi phone/company (thêm friction).
FORM inline trong hero + repeat cuối page.

${COMMON_RULES}`

const WEBINAR_SYSTEM = `Bạn là copywriter chuyên viết webinar/live event landing page tiếng Việt.

Áp dụng "Webinar Framework" của Russell Brunson. Cấu trúc bắt buộc:
1. Hero: Tên webinar + ngày giờ + BIG PROMISE (bạn sẽ học được gì)
2. What you'll discover: 3-5 điểm cụ thể bạn sẽ học (không phải curriculum, phải là OUTCOME)
3. Who is this for: rõ ai nên tham dự, ai không
4. Speaker bio (nếu có input): credibility + relevance
5. Agenda tóm tắt (nếu có)
6. Registration form: name + email + phone (webinar cần phone để nhắc)
7. Urgency: countdown timer đến ngày webinar, số slot còn lại
8. FAQ (Live vs recording, có được replay không, có chi phí không...)
9. Final CTA form

Form action="#" data-form="1". Đề xuất countdown JS đơn giản inline.

${COMMON_RULES}`

const SYSTEM_PROMPTS: Record<FunnelType, string> = {
  sales: SALES_SYSTEM,
  leads: LEADS_SYSTEM,
  webinar: WEBINAR_SYSTEM,
}

function buildUserPrompt(type: FunnelType, input: FunnelCopyInput): string {
  const lines: string[] = [
    `Loại funnel: ${type}`,
    `Sản phẩm/Tên: ${input.productName || '(chưa có)'}`,
    `Target audience: ${input.audience || '(chưa có)'}`,
    `Nỗi đau chính: ${input.painPoints || '(chưa có)'}`,
    `Big promise: ${input.bigPromise || '(chưa có)'}`,
    `USP: ${input.usp || '(chưa có)'}`,
    `CTA text mong muốn: ${input.cta || 'Đăng ký ngay'}`,
  ]
  if (input.brandColor) lines.push(`Màu chủ đạo: ${input.brandColor}`)

  if (type === 'sales') {
    lines.push(`Offer: ${input.offer || '(chưa có)'}`)
    lines.push(`Giá: ${input.pricing || '(chưa có)'}`)
    if (input.bonuses) lines.push(`Bonuses: ${input.bonuses}`)
    if (input.guarantee) lines.push(`Guarantee: ${input.guarantee}`)
    if (input.testimonials) lines.push(`Testimonials: ${input.testimonials}`)
    if (input.urgency) lines.push(`Urgency: ${input.urgency}`)
  } else if (type === 'leads') {
    lines.push(`Tên lead magnet: ${input.leadMagnetName || '(chưa có)'}`)
    lines.push(`Benefit lead magnet: ${input.leadMagnetBenefit || '(chưa có)'}`)
  } else if (type === 'webinar') {
    lines.push(`Tên webinar: ${input.webinarTitle || '(chưa có)'}`)
    lines.push(`Ngày giờ: ${input.webinarDate || '(chưa có)'}`)
    if (input.webinarSpeaker) lines.push(`Speaker: ${input.webinarSpeaker}`)
    if (input.webinarAgenda) lines.push(`Agenda: ${input.webinarAgenda}`)
  }

  lines.push('')
  lines.push('Sinh HTML hoàn chỉnh theo cấu trúc quy định. Không giải thích, không markdown wrapper, chỉ HTML.')
  return lines.join('\n')
}

export interface GenerateFunnelOptions {
  type: FunnelType
  input: FunnelCopyInput
  provider?: ProviderId
  model?: string
  iterationInstruction?: string   // Nếu regenerate với instruction cụ thể ("đổi màu CTA thành xanh")
  previousHtml?: string             // Nếu iterate, pass previous HTML để AI edit thay vì làm từ đầu
}

export async function generateFunnelHtml(opts: GenerateFunnelOptions): Promise<{
  html: string
  meta: {
    provider: string
    model: string
    inputTokens?: number
    outputTokens?: number
    generatedAt: string
  }
}> {
  const systemPrompt = SYSTEM_PROMPTS[opts.type]

  let userPrompt: string
  if (opts.previousHtml && opts.iterationInstruction) {
    // Iteration mode
    userPrompt = `Đây là HTML hiện tại của landing page:

\`\`\`html
${opts.previousHtml}
\`\`\`

Yêu cầu chỉnh sửa từ user:
"${opts.iterationInstruction}"

Sinh lại toàn bộ HTML với thay đổi này. Giữ nguyên các phần khác không liên quan. Output chỉ HTML, không giải thích.`
  } else {
    userPrompt = buildUserPrompt(opts.type, opts.input)
  }

  const result = await runCompletion({
    provider: opts.provider || 'openai-codex',
    model: opts.model || 'gpt-5.6-sol',
    systemPrompt,
    userPrompt,
    maxTokens: 16000,
    temperature: 0.7,
  })

  // Strip markdown code fence if AI wrapped it
  let html = result.text.trim()
  const fenceMatch = html.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/)
  if (fenceMatch) html = fenceMatch[1].trim()

  // Ensure it starts with DOCTYPE
  if (!html.toLowerCase().startsWith('<!doctype')) {
    html = `<!DOCTYPE html>\n${html}`
  }

  return {
    html,
    meta: {
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Inject tracking pixel into HTML before </body>.
 * Sends visit + cta_click + form_submit events to /api/f/track.
 */
export function injectTrackingPixel(html: string, funnelId: string, portalBaseUrl: string): string {
  const script = `
<script>
(function(){
  var FUNNEL_ID='${funnelId}';
  var TRACK_URL='${portalBaseUrl}/api/f/track';
  function send(type, extra){
    try {
      fetch(TRACK_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          funnel_id: FUNNEL_ID, event_type: type,
          referrer: document.referrer, extra: extra || {}
        }),
        keepalive: true
      }).catch(function(){})
    } catch(e){}
  }
  send('visit');
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-cta="1"], [data-cta]');
    if (el) send('cta_click', { text: (el.innerText||'').slice(0,80) });
  });
  document.addEventListener('submit', function(e){
    var form = e.target.closest('[data-form="1"], form');
    if (form) send('form_submit', { form_id: form.id || '' });
  }, true);
})();
</script>`.trim()
  if (html.includes('</body>')) return html.replace('</body>', `${script}\n</body>`)
  return html + '\n' + script
}
