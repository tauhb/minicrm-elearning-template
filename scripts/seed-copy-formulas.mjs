#!/usr/bin/env node
/**
 * seed-copy-formulas.mjs — Seed 6 built-in copy formulas.
 * Runs on setup + on-demand: node scripts/seed-copy-formulas.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

for (const f of ['.env', '.env.local']) {
  const p = join(ROOT, f)
  if (existsSync(p)) {
    readFileSync(p, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) { const v = m[2].replace(/^['"]|['"]$/g, '').trim(); if (v) process.env[m[1]] = v }
    })
  }
}

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Missing SUPABASE keys'); process.exit(1) }

const LANDING_FILTER = ['landing', 'opt-in', 'custom']
const FORMULAS = [
  {
    key: 'pas',
    name: 'PAS — Problem, Agitate, Solution',
    description: 'Direct response classic. Xoáy pain point mạnh trước khi giới thiệu giải pháp.',
    sort_order: 10, page_type_filter: LANDING_FILTER,
    system_prompt: `Formula: PAS (Problem → Agitate → Solution)

Bạn viết copy theo cấu trúc 3 bước:

1. **Problem** — Nêu ra vấn đề cụ thể của target audience. Chi tiết, dùng tình huống thực tế họ trải qua hàng ngày. Câu hỏi kiểu "Bạn có bao giờ..." rất hiệu quả.

2. **Agitate** — Xoáy vào đau. Làm cho họ CẢM NHẬN được vấn đề nặng đến mức nào nếu không giải quyết. Nhắc hậu quả cụ thể (mất thời gian, mất tiền, mất cơ hội, mất tự tin). KHÔNG được cường điệu bịa đặt — phải chân thật.

3. **Solution** — Giới thiệu giải pháp một cách nhẹ nhàng, như câu trả lời tự nhiên cho vấn đề. Không hard-sell ngay, giới thiệu mechanism (cách nó hoạt động) trước, sau đó mới list benefits.

Block order gợi ý cho landing page dùng PAS:
- hero (headline nêu problem hoặc big promise)
- pain-list HOẶC pain-story (agitate)
- solution-reveal (bridge)
- mechanism (why it works)
- feature-benefit (benefits chính)
- testimonials-grid
- pricing-table hoặc cta-with-form
- guarantee
- faq-accordion
- cta-repeat`
  },
  {
    key: 'aida',
    name: 'AIDA — Attention, Interest, Desire, Action',
    description: 'Classic marketing framework. Cân bằng, dùng cho phần lớn cases.',
    sort_order: 20, page_type_filter: LANDING_FILTER,
    system_prompt: `Formula: AIDA (Attention → Interest → Desire → Action)

Bạn viết copy theo cấu trúc 4 bước:

1. **Attention** — Hook mạnh. Headline gây tò mò/shock/promise lớn. Sub-headline giải thích trong 1 câu. Visual/video hero nếu cần.

2. **Interest** — Nêu vấn đề của họ VÀ giải pháp bạn có. Tạo curiosity gap. Introduce mechanism/USP đặc biệt của bạn.

3. **Desire** — Làm họ MUỐN có. Benefits > features. Transformation story ("bạn sẽ như thế nào SAU KHI dùng"). Social proof mạnh (testimonials, case study, stats). Giá trị vs giá tiền.

4. **Action** — CTA rõ ràng, không mơ hồ. Risk reversal (guarantee). Urgency nếu có. Repeat CTA nhiều lần trên page.

Block order gợi ý:
- hero (Attention)
- pain-list (transition to Interest)
- solution-reveal + mechanism (Interest)
- feature-benefit (Desire)
- case-study hoặc testimonials-grid (Desire proof)
- stats-numbers hoặc logos-strip (Desire proof)
- pricing-table (Action prep)
- bonus-stack + guarantee (Action risk-reduce)
- countdown hoặc scarcity-list (Action urgency)
- cta-simple hoặc cta-with-form (Action)`
  },
  {
    key: 'bab',
    name: 'BAB — Before, After, Bridge',
    description: 'Transformation story. Ideal khi target đang stuck ở tình huống rõ ràng.',
    sort_order: 30, page_type_filter: LANDING_FILTER,
    system_prompt: `Formula: BAB (Before → After → Bridge)

Bạn viết copy theo cấu trúc transformation:

1. **Before** — Vẽ ra bức tranh RẤT CỤ THỂ về hiện tại của họ. Frustration, limitation, bế tắc. Câu chuyện ngắn nếu có. Người đọc phải nghĩ "đúng, đây là mình".

2. **After** — Vẽ tương lai mà họ MUỐN. Không mô tả sản phẩm, mô tả CUỘC SỐNG SAU KHI dùng sản phẩm. Vivid, sensory, cảm xúc. Freedom, confidence, results.

3. **Bridge** — Giải pháp của bạn CHÍNH LÀ cây cầu nối. Introduce ngắn gọn, focus vào việc "làm sao đi từ Before sang After". Mechanism > features.

Sau bridge, tất cả sections còn lại phục vụ 1 mục đích: convince đây là cầu duy nhất.

Block order:
- hero (headline focus on After outcome, not product)
- pain-story (Before)
- pain-list (nếu cần bổ sung pain)
- hero-split hoặc timeline (After — visual transformation)
- solution-reveal (Bridge)
- mechanism (how bridge works)
- case-study (proof: người khác đã đi qua bridge)
- testimonials-grid (Before/After quotes)
- pricing-single hoặc pricing-table
- guarantee
- cta-simple
- faq-accordion
- cta-repeat`
  },
  {
    key: '4ps',
    name: '4Ps — Picture, Promise, Prove, Push',
    description: 'Long-form narrative. Phù hợp sales page dài, chuyện kể sâu.',
    sort_order: 40, page_type_filter: LANDING_FILTER,
    system_prompt: `Formula: 4Ps (Picture → Promise → Prove → Push)

Bạn viết copy theo cấu trúc long-form narrative:

1. **Picture** — Vẽ bức tranh visual về giấc mơ/tương lai/hoặc pain hiện tại. Vivid, cinematic. Tạo cảm xúc từ chữ đầu tiên. 2-3 đoạn văn ngắn.

2. **Promise** — Big promise cụ thể + đo lường được. "Bạn sẽ đạt được X trong Y ngày". Càng cụ thể càng credible. Kèm mechanism hint (bạn làm được nhờ đâu).

3. **Prove** — Nhiều layer proof:
   - Testimonials (chi tiết, có tên, ảnh)
   - Case studies (before-after cụ thể)
   - Data/stats
   - Credentials của bạn (background, kinh nghiệm)
   - Media mentions nếu có
   - Guarantee (proof of confidence)

4. **Push** — CTA mạnh, urgency thực (không fake), scarcity nếu có, final risk reversal. Push mạnh nhưng không hung hăng.

Block order (long-form):
- hero (Picture — cinematic headline)
- pain-story hoặc pain-list (Picture context)
- solution-reveal (Promise)
- feature-benefit x2 (Promise details)
- mechanism (Promise credibility)
- testimonials-grid (Prove)
- case-study x1-2 (Prove)
- stats-numbers (Prove)
- pricing-table (Push setup)
- bonus-stack (Push value)
- guarantee (Push risk-reversal)
- countdown hoặc scarcity-list (Push urgency)
- cta-simple lặp lại 2-3 lần trong page
- faq-accordion
- cta-repeat final`
  },
  {
    key: 'quest',
    name: 'QUEST — Qualify, Understand, Educate, Stimulate, Transition',
    description: 'Advanced. Cho audience niche hoặc high-ticket. Filter khách phù hợp.',
    sort_order: 50, page_type_filter: LANDING_FILTER,
    system_prompt: `Formula: QUEST (Qualify → Understand → Educate → Stimulate → Transition)

Bạn viết copy theo cấu trúc filter-and-convert:

1. **Qualify** — Filter audience TRÊN đầu page. "Landing page này DÀNH CHO người...". "KHÔNG dành cho người...". Người không phù hợp bounce ngay = tiết kiệm compute + tăng conversion rate.

2. **Understand** — Chứng minh bạn HIỂU họ. Nêu pain sâu, insight họ chưa nghĩ tới, ngôn ngữ nội bộ họ dùng. Họ phải nghĩ "wow tác giả này biết chính xác vấn đề của mình".

3. **Educate** — Dạy họ điều gì đó có giá trị NGAY trên page. Không giấu key insight vào lead magnet. Cho free content để build authority. Frame giải pháp qua lens giáo dục ("cách để giải quyết X là...").

4. **Stimulate** — Kích thích cảm xúc mong muốn hành động. Consequences of inaction. Vision of transformation. Case studies inspire.

5. **Transition** — Chuyển sang offer một cách tự nhiên, KHÔNG hard pitch. "Nếu bạn muốn thực hiện những điều trên nhanh hơn, đây là cách...".

Block order:
- hero (Qualify — "For X who want Y")
- pain-list hoặc pain-story (Understand)
- solution-reveal (Educate — chia sẻ framework)
- mechanism (Educate deeper)
- feature-benefit (Stimulate — vision)
- case-study (Stimulate — proof)
- pricing-table (Transition)
- bonus-stack
- guarantee
- testimonials-grid
- cta-simple
- faq-accordion (address objections)
- cta-repeat`
  },
  {
    key: 'star-story-solution',
    name: 'Star-Story-Solution — Personal brand',
    description: 'Cho personal brand / coach / creator. Kể chuyện bạn để bán.',
    sort_order: 60, page_type_filter: LANDING_FILTER,
    system_prompt: `Formula: Star → Story → Solution

Bạn viết copy theo cấu trúc personal brand narrative:

1. **Star** — Character introduction. Không phải "tôi giỏi thế nào", mà là "tôi giống bạn thế nào". Kể ngắn về background của bạn, đặc biệt phần **thất bại/struggle**. Người đọc phải empathize.

2. **Story** — Câu chuyện transformation của bạn (hoặc của học viên đầu tiên). Hook → Struggle → Turning point → Discovery → Result. Chuẩn story arc. Cụ thể, có số, có timeline.

3. **Solution** — Đây là lúc reveal offer. Framing: "Đây là cách tôi làm, và giờ tôi teach lại cho bạn". Không phải "mua khoá của tôi", mà là "hãy đi theo con đường tôi đã đi".

Sau Solution, thêm social proof (nhiều học viên đã đi con đường này thành công) và CTA.

Block order:
- hero (Star — headline personal)
- pain-story (Story arc — Struggle)
- solution-reveal (Story — Turning point + Discovery)
- feature-benefit (Solution details)
- case-study (Solution — người khác cũng làm được)
- testimonials-grid (Solution proof)
- pricing-single (Solution offer)
- bonus-stack
- guarantee
- faq-accordion
- cta-simple`
  },
  // ═════════════════ Order Form templates ═════════════════
  {
    key: 'order-form-basic',
    name: 'Order Form — Basic',
    description: 'Layout đơn giản: form thu info + tóm tắt đơn hàng, không thêm gì.',
    sort_order: 100, page_type_filter: ['order'],
    system_prompt: `Formula: Order Form Basic

Bạn generate block outline cho ORDER FORM PAGE — nơi customer điền info và (tùy) thanh toán.

Cấu trúc bắt buộc (đơn giản, focus conversion):
1. **Hero mini** — Tiêu đề ngắn "Điền thông tin để hoàn tất đơn" + sub xác nhận sản phẩm đang mua
2. **Order summary** — Custom block hoặc pricing-single hiển thị:
   - Tên sản phẩm/khóa học
   - Giá (không có anchor, thẳng thắn)
   - Bonuses list ngắn nếu có
3. **Form section** — cta-with-form — LUÔN có form với name/email/phone. Form fields dùng structure step.form_fields
4. **Trust footer** — 1 dòng ngắn: "Thanh toán an toàn · Hoàn tiền 14 ngày" — custom block hoặc guarantee

Block order:
- hero (tiêu đề + xác nhận sản phẩm)
- pricing-single (order summary)
- cta-with-form (form thu info)
- guarantee (trust footer)

KHÔNG: nhồi thêm pain, testimonials, case study — page này để convert, không phải sell.`
  },
  {
    key: 'order-form-trust',
    name: 'Order Form — With Trust Signals',
    description: 'Order form kèm social proof + guarantee đậm — giảm hesitation lúc chốt.',
    sort_order: 110, page_type_filter: ['order'],
    system_prompt: `Formula: Order Form + Trust Signals

Bạn generate block outline cho ORDER FORM có trust signals để giảm friction chốt đơn.

Cấu trúc:
1. **Hero mini** — Tiêu đề + sub xác nhận sản phẩm
2. **Order summary** — pricing-single với đầy đủ features/bonuses
3. **Trust block** — testimonial-quote (1 quote strongest) HOẶC stats-numbers (X khách hàng, Y% hài lòng)
4. **Form section** — cta-with-form
5. **Guarantee** — guarantee block đậm
6. **Payment methods** — custom block: hiển thị các phương thức (VietQR, Bank transfer, cards logos)

Block order:
- hero
- pricing-single
- testimonial-quote HOẶC stats-numbers
- cta-with-form
- guarantee
- custom (payment methods)

Tone: chuyên nghiệp, không hype. Copy ngắn gọn — page này visitors đã ready to buy.`
  },
  // ═════════════════ Thank You templates ═════════════════
  {
    key: 'thank-you-simple',
    name: 'Thank You — Simple',
    description: 'Xác nhận đơn/đăng ký + hint tiếp theo. Tối giản.',
    sort_order: 200, page_type_filter: ['thank-you'],
    system_prompt: `Formula: Thank You Simple

Bạn generate block outline cho THANK YOU PAGE — page hiện sau khi user submit form hoặc thanh toán.

Cấu trúc tối giản:
1. **Hero** — Icon tick + "Cảm ơn bạn!" + xác nhận (VD: "Chúng tôi đã nhận đơn của bạn")
2. **What next** — custom block ngắn: "Trong 24h chúng tôi sẽ liên lạc / email đã gửi tới hộp mail của bạn"
3. **Support** — custom block: "Cần hỗ trợ? Zalo/Email ở đây"

Block order:
- hero (celebration + xác nhận)
- custom (what next — hướng dẫn kế tiếp)
- custom (support contact)

Tone: thân thiện, nhẹ nhàng. Không upsell. Không lặp lại sales pitch.`
  },
  {
    key: 'thank-you-instructions',
    name: 'Thank You + Hướng dẫn',
    description: 'Cảm ơn + hướng dẫn 3 bước tiếp theo + link Zalo Group / community.',
    sort_order: 210, page_type_filter: ['thank-you'],
    system_prompt: `Formula: Thank You + Instructions

Bạn generate block outline cho THANK YOU PAGE với hướng dẫn onboarding rõ ràng.

Cấu trúc:
1. **Hero** — Icon tick + Cảm ơn + xác nhận rõ ràng gì đã xảy ra
2. **3 bước tiếp theo** — timeline block với 3 steps concrete:
   - Bước 1: check email (subject cụ thể)
   - Bước 2: tham gia Zalo Group (link cụ thể)
   - Bước 3: đợi lịch học / delivery hint
3. **FAQ ngắn** — 3-5 câu hỏi phổ biến ("Chưa nhận email?", "Thanh toán chưa vào?", "Bao giờ bắt đầu?")
4. **Support** — custom block: liên hệ

Block order:
- hero
- timeline (3 steps)
- faq-accordion
- custom (support contact)

Tone: rõ ràng, professional, giúp user biết chính xác họ cần làm gì tiếp.`
  },
  {
    key: 'thank-you-upsell',
    name: 'Thank You + Upsell nhẹ',
    description: 'Cảm ơn + one-time offer bổ sung (bonus, add-on, membership).',
    sort_order: 220, page_type_filter: ['thank-you'],
    system_prompt: `Formula: Thank You + Soft Upsell

Bạn generate block outline cho THANK YOU PAGE có soft upsell (không aggressive).

Cấu trúc:
1. **Hero** — Cảm ơn ngắn
2. **Confirmation** — custom block: xác nhận email/delivery
3. **Special one-time offer** — bonus-stack HOẶC pricing-single:
   - "Nhân dịp bạn vừa mua, đây là 1 ưu đãi đặc biệt CHỈ HÔM NAY"
   - Product bổ sung (add-on, workshop, community access)
   - Giá discount rõ ràng
4. **CTA** — cta-simple: "Thêm vào đơn" hoặc "Thanh toán riêng"
5. **Skip option** — custom block: "Không cảm ơn, tôi sẽ dùng ưu đãi này sau"

Block order:
- hero
- custom (confirmation)
- bonus-stack HOẶC pricing-single (upsell offer)
- cta-simple
- custom (skip option link)

Tone: thân thiện, không pushy. Upsell là gợi ý, không ép.`
  },
  // ═════════════════ Upsell templates ═════════════════
  {
    key: 'upsell-oto',
    name: 'Upsell OTO — One Time Offer',
    description: 'Wait/scarcity + bonus offer chỉ hiện 1 lần trước khi vào thank-you.',
    sort_order: 300, page_type_filter: ['upsell'],
    system_prompt: `Formula: Upsell OTO (One Time Offer)

Bạn generate block outline cho UPSELL PAGE — page hiện SAU khi order, TRƯỚC thank-you, để offer thêm.

Cấu trúc classic OTO:
1. **Hero pattern interrupt** — Custom block: "KHOAN ĐÓNG TRANG!" hoặc "Trước khi đơn của bạn hoàn tất, đọc kỹ điều này":
   - Xác nhận đơn đã ghi nhận
   - "Bạn có 1 cơ hội đặc biệt CHỈ XUẤT HIỆN 1 LẦN trên trang này"
2. **Offer reveal** — solution-reveal + hero visual:
   - Sản phẩm bổ sung (khóa nâng cao, 1-1 session, workshop)
   - Lý do nó value cho customer đã mua sản phẩm gốc
3. **Value stack** — bonus-stack: gì họ nhận thêm
4. **Special price** — pricing-single với anchor rõ:
   - Giá gốc: X đ
   - Giá TRÊN TRANG NÀY DUY NHẤT: Y đ (chiết khấu Z%)
5. **Urgency** — countdown hoặc scarcity-list: "Trang này biến mất trong 15 phút"
6. **CTA + Skip** — cta-simple "Có, thêm vào đơn ngay" + smaller link "Không, tôi hài lòng với đơn hiện tại"

Block order:
- custom (pattern interrupt)
- solution-reveal
- feature-benefit
- bonus-stack
- pricing-single
- countdown (optional)
- cta-simple + custom (skip link)

Tone: khẩn trương nhưng không lừa. Skip option PHẢI có để không bị coi là dark pattern.`
  },
]

async function upsertFormula(f) {
  const getRes = await fetch(`${SB_URL}/rest/v1/copy_formulas?key=eq.${encodeURIComponent(f.key)}&select=id`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  const existing = await getRes.json()

  const payload = {
    key: f.key, name: f.name, description: f.description,
    system_prompt: f.system_prompt,
    page_type_filter: f.page_type_filter || null,
    is_builtin: true, is_active: true, sort_order: f.sort_order,
    updated_at: new Date().toISOString(),
  }

  const url = existing.length > 0
    ? `${SB_URL}/rest/v1/copy_formulas?key=eq.${encodeURIComponent(f.key)}`
    : `${SB_URL}/rest/v1/copy_formulas`
  const method = existing.length > 0 ? 'PATCH' : 'POST'

  const res = await fetch(url, {
    method,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`${f.key}: ${await res.text()}`)
  console.log(`\x1b[32m✓\x1b[0m ${existing.length > 0 ? 'Updated' : 'Inserted'}: ${f.key} — ${f.name}`)
}

console.log(`\n\x1b[36mSeeding ${FORMULAS.length} copy formulas...\x1b[0m\n`)
try {
  for (const f of FORMULAS) await upsertFormula(f)
  console.log(`\n\x1b[32m✓ Done.\x1b[0m Users can edit via Settings → Copy Formulas.\n`)
} catch (e) {
  console.error(`\x1b[31m✗\x1b[0m ${e.message}`)
  process.exit(1)
}
