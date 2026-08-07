---
name: sales-page-funnel
description: "Build sales page funnels dựa trên direct response research: Brunson, Deiss, Kern, Todd Brown, Sabri Suby, Schwartz. Covers VSL page, long-form sales letter, short-form product page."
version: 2.0.0
agent: funnel
tags: [sales-page, funnel, direct-response, VSL, copywriting]
---

# Sales Page Funnel Skill

**Mục tiêu:** Tạo ra sales page convert — không phải đẹp, không phải dài, mà đúng **sequence** dẫn prospect từ skeptical → believing → buying.

**Research source:** Russell Brunson, Ryan Deiss, Frank Kern, Todd Brown, Sabri Suby, Eugene Schwartz, Gary Halbert, Claude Hopkins.

---

## Execution Mode

**Mặc định: Step-by-Step** — không one-shot trừ khi user nói `automode`.

```
STEP 1 — Thu thập input
  → Hỏi 6 câu (offer, avatar, traffic, video, testimonials, order bump)
  → Chờ user trả lời đầy đủ trước khi tiếp tục

STEP 2 — Viết copy từng trang
  → Viết Copy Brief cho trang 1 (index.html)
  → Trình bày → CHỜ DUYỆT
  → Nếu duyệt → viết trang 2
  → Nếu sửa → sửa rồi chờ duyệt lại
  → Lặp cho đến hết tất cả pages

STEP 3 — Build HTML từng trang
  → Build index.html từ copy brief đã duyệt
  → Trình bày (tóm tắt sections + screenshot nếu được)
  → CHỜ DUYỆT
  → Nếu duyệt → build trang tiếp theo
  → Nếu sửa → sửa rồi chờ duyệt lại
  → Lặp cho đến hết
```

**Automode** (`user nói "automode"` hoặc `"làm một lần"`):
→ Bỏ qua tất cả checkpoint → build toàn bộ funnel một lần.

---

## ⚠️ Media Slots — Bắt Buộc Trước Khi Build HTML

**Trước khi build HTML**, phải hỏi user câu hỏi media và map slot vào đúng section. Không có ảnh thật ≠ bỏ slot — dùng placeholder chuẩn.

### Câu hỏi media (hỏi sau 6 câu input, trước khi viết copy):

```
Trước khi build, em cần biết anh/chị có sẵn media nào:

□ Video bán hàng (VSL) / testimonial video   → slot [VIDEO] S4
□ Ảnh sản phẩm / screenshot tool / output    → slot [PRODUCT] S11, Hero
□ Screenshots kết quả của khách hàng         → slot [RESULT] S13
□ Ảnh mặt khách hàng / beta user             → slot [PERSON] S13
□ Ảnh tác giả / founder                      → slot [PERSON] S14
□ Chưa có gì                                 → dùng placeholder đẹp, thay sau

Chưa có media không sao — page vẫn đầy đủ với placeholder.
```

### Media Requirements — mapping per section:

| Section | Slot | data-role | Bắt buộc? | Ghi chú |
|---------|------|-----------|-----------|---------|
| S4 VSL / Hero Image | 16:9 video hoặc full-bleed image | `VIDEO` / `CONTEXT` | Nếu có video | Luôn reserve slot dù chưa có — placeholder "Video sắp ra" |
| S11 What's Inside | Screenshot sản phẩm đang chạy | `PRODUCT` | Có thể có | Terminal chạy lệnh, hoặc output mẫu (landing page, carousel) |
| S11 Agents (featured cell) | Screenshot output của agent đó | `PRODUCT` | Optional | Ví dụ: Funnel Agent → screenshot landing page đã build |
| S13 Testimonials — mỗi testi | Ảnh mặt người thật | `PERSON` | **Bắt buộc** | Không có ảnh = testimonial mất credibility với cold traffic |
| S13 Featured case study | Screenshot kết quả (dashboard, revenue, output) | `RESULT` | **Bắt buộc** | Social proof mạnh nhất của page |
| S14 About / Credibility | Ảnh tác giả / founder | `PERSON` | **Bắt buộc** | Không có ảnh thật = cold traffic không tin |
| S14 About | Logo media / certifications đã xuất hiện | `CONTEXT` | Có thể có | "Như đã xuất hiện trên..." |
| Hero | Product mockup / screenshot | `PRODUCT` | Highly recommended | Show sản phẩm đang hoạt động — tăng desire |

### Placeholder chuẩn cho sales page:

**[PERSON] circular (testimonial avatar):**
```html
<div class="media-slot" data-role="PERSON"
     style="width:64px;height:64px;border-radius:50%;
            background:var(--surface2);border:2px dashed var(--faint);
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" stroke="var(--subtle)" stroke-width="1.4"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="var(--subtle)" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
</div>
```

**[PERSON] large (about/founder):**
```html
<div class="media-slot" data-role="PERSON"
     style="width:120px;height:120px;border-radius:50%;
            background:var(--surface2);border:2px dashed var(--faint);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" stroke="var(--subtle)" stroke-width="1.2"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="var(--subtle)" stroke-width="1.2" stroke-linecap="round"/>
  </svg>
  <span style="font-size:10px;color:var(--faint);font-family:var(--font-mono);">Ảnh founder</span>
</div>
```

**[RESULT] screenshot (case study / proof):**
```html
<div class="media-slot" data-role="RESULT"
     style="width:100%;aspect-ratio:16/9;border-radius:10px;
            background:var(--surface2);border:2px dashed var(--faint);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="14" rx="2" stroke="var(--subtle)" stroke-width="1.4"/>
    <path d="M8 21h8M12 17v4" stroke="var(--subtle)" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <span style="font-size:12px;color:var(--subtle);">[Screenshot kết quả — dashboard/revenue/output]</span>
  <span style="font-size:11px;color:var(--faint);font-family:var(--font-mono);">16:9 · min 1200px</span>
</div>
```

**[PRODUCT] screenshot (tool in action):**
```html
<div class="media-slot" data-role="PRODUCT"
     style="width:100%;aspect-ratio:16/9;border-radius:10px;
            background:var(--surface2);border:2px dashed var(--faint);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--subtle)" stroke-width="1.4"/>
    <polyline points="9 12 11 14 15 10" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
  <span style="font-size:12px;color:var(--subtle);">[Screenshot sản phẩm đang chạy]</span>
  <span style="font-size:11px;color:var(--faint);font-family:var(--font-mono);">16:9 · terminal / output mẫu</span>
</div>
```

**[VIDEO] slot:**
```html
<div class="media-slot" data-role="VIDEO"
     style="width:100%;aspect-ratio:16/9;border-radius:12px;
            background:var(--surface2);border:2px dashed var(--faint);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">
  <div style="width:56px;height:56px;border-radius:50%;background:var(--accent-dim);
              border:2px solid rgba(182,255,0,.3);display:flex;align-items:center;justify-content:center;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  </div>
  <span style="font-size:13px;color:var(--subtle);">[Video bán hàng — VSL]</span>
  <span style="font-size:11px;color:var(--faint);font-family:var(--font-mono);">Embed YouTube / Vimeo URL khi có</span>
</div>
```

**Rule tuyệt đối:** Không bao giờ bỏ trống slot vì "chưa có ảnh". Placeholder phải trông intentional — dashed border + label rõ + icon SVG. Khi có ảnh thật: thay `<div class="media-slot">...</div>` bằng `<img src="..." class="slot-img w-full h-full object-cover">`.

---

## ⚠️ Offer Agent Dependency

**Trước khi viết offer section, kiểm tra:**
```
1. Đọc output/offer/[slug]/ — có output từ /offer build không?
2. Đọc BUSINESS.md — offer đã định nghĩa chưa?
```
- **Có** → pull: tên, giá, bonuses, guarantee, USP, case studies → dùng ngay
- **Chưa** → nhắc: *"Chạy `/offer build [tên sản phẩm]` trước — sales page cần offer hoàn chỉnh để build offer stack và guarantee section."*

---

## Load Order

```
1. BUSINESS.md                                      → offer, avatar, brand voice
2. THEME.md                                         → brand tokens
3. output/offer/[slug]/ hoặc BUSINESS.md            → offer details (từ Offer Agent)
4. SKILL.md (file này)                              → funnel structure
5. references/expert-frameworks.md                  → synthesis từ các experts
6. references/page-types.md                         → chọn đúng page type
7. references/section-sequence.md                   → master section order
8. skills/funnel/landing-copy/SKILL.md              → nếu cần generate copy
9. skills/funnel/landing-copy/references/copy-sales.md
10. skills/funnel/page-designer/SKILL.md            → nếu cần generate HTML
```

---

## Bước 1 — Xác Định Awareness Level (Schwartz)

**Trước tiên:** Xác định audience đang ở đâu trong 5 tầng nhận thức. Điều này quyết định độ dài page và cách mở đầu.

| Level | Họ đang biết gì | Page approach | Độ dài |
|-------|----------------|--------------|--------|
| **1. Unaware** | Không biết mình có vấn đề | Mở bằng story/insight về world | 3000–5000+ words |
| **2. Problem Aware** | Biết vấn đề, không biết giải pháp | Mở bằng problem + agitation | 2000–4000 words |
| **3. Solution Aware** | Biết có giải pháp, chưa biết của bạn | Mở bằng mechanism mới | 1500–3000 words |
| **4. Product Aware** | Biết bạn nhưng chưa mua | Mở bằng offer + proof | 800–1500 words |
| **5. Most Aware** | Sẵn sàng mua, đang chờ deal | Mở thẳng bằng offer | Under 800 words |

**Rule:** Đừng educate audience đã educated. Đừng pitch audience chưa ready.

---

## Bước 2 — Chọn Page Type

Đọc `references/page-types.md` để chọn đúng format:

| Page Type | Dùng khi | Offer giá | Awareness |
|-----------|---------|----------|-----------|
| **VSL Page** | Video là hook chính | Mọi mức giá | Level 2–4 |
| **Long-form Sales Letter** | High-ticket, cold traffic, cần build trust | 2M+ VND | Level 1–3 |
| **Short-form Product Page** | Warm traffic, đã biết bạn | Under 1M VND | Level 4–5 |
| **Launch / Limited-Time** | Open/close cart, cohort-based | Mọi mức giá | Level 3–5 |

> ⚠️ Nếu mục tiêu là đặt lịch tư vấn / qualify leads → dùng `/funnel booking` (booking-call-funnel), không phải skill này.

---

## Bước 3 — Section Sequence

**Core Law (Todd Brown + Brunson):** Prospect phải tin vào **tất cả beliefs cần thiết** trước khi thấy offer. Sai sequence = page không convert dù copy tốt.

**Master sequence — đọc `references/section-sequence.md` để có chi tiết từng section:**

```
ABOVE FOLD
├── [S1] Audience Call-Out (eyebrow) ← Sabri Suby: ai đọc trang này
├── [S2] Main Headline ← Brunson: hook = 5 giây quyết định
├── [S3] Sub-headline + first CTA (optional)
└── [S4] Video (VSL) hoặc Hero Image

PROBLEM ZONE — "Tôi hiểu bạn"
├── [S5] Lead / Hook Story ← Kern: story trước pitch
├── [S6] Problem Identification ← PAS: name the pain cụ thể
└── [S7] Problem Agitation ← Consequences nếu không giải quyết

MECHANISM ZONE — "Tại sao cách cũ không work"
├── [S8] The Hidden Cause ← Todd Brown: big marketing idea
└── [S9] The New Mechanism ← Brunson: unique process/system

SOLUTION ZONE — "Đây là cách mới"
├── [S10] Solution Introduction ← Before → After (Ryan Deiss)
├── [S11] What's Inside / Curriculum
└── [S12] Benefits (không phải features)

PROOF ZONE — "Đừng tin tôi, tin kết quả"
├── [S13] Testimonials / Case Studies ← Specificity (Hopkins)
├── [S14] About / Credibility
└── [S15] For / Not For

OFFER ZONE — "Đây là deal"
├── [S16] Offer Stack (value stacking)
├── [S17] Price Reveal ← After value, không trước
└── [S18] Guarantee / Risk Reversal

CLOSE — "Đừng bỏ lỡ"
├── [S19] FAQ / Objection Handling
├── [S20] Urgency / Scarcity (phải thật)
└── [S21] Final CTA
```

---

## Bước 4 — Order Bump (nếu có)

Đặt trên Order Form, không phải sales page. Đọc:
`skills/funnel/landing-copy/references/copy-order-bump.md`

---

## Bước 5 — Upsell / Downsell Flow

```
Main Offer purchased?
  YES → Upsell (30–50% giá main, complementary)
    Accepted? → Thank You (full stack)
    Declined? → Downsell (lighter version) hoặc → Thank You
  NO  → Exit popup hoặc Downsell
```

---

## Funnel Output Structure

```
output/funnel/sales/[slug]/
├── index.html            ← sales page
├── order/
│   └── index.html        ← order form + Order ID generation + dynamic SePay QR
├── oto/
│   └── index.html        ← One Time Offer page (chỉ tạo khi user yêu cầu)
├── thank-you/
│   └── index.html        ← confirmation + access + next steps + community + refer
├── api/
│   └── webhook.js        ← SePay payment webhook (copy từ payment-confirm/scripts/api/webhook.js)
├── assets/
│   └── images/           ← ảnh generated (từ image-generator skill)
├── vercel.json           ← Vercel config: route /api/webhook → serverless function
├── package.json          ← dependencies: googleapis (cho webhook Google Sheet)
├── funnel.json           ← manifest: status, urls, placeholders checklist
├── copy-brief.md         ← copy brief (không deploy)
└── _design-log.md        ← design decisions (không deploy)
```

### funnel.json — manifest bắt buộc

Tạo file này khi scaffold funnel. Điền dần khi setup:

```json
{
  "slug": "[funnel-slug]",
  "product": "[Tên sản phẩm]",
  "price": 0,
  "status": "draft",
  "urls": {
    "production": "",
    "order": "/order/",
    "thank_you": "/thank-you/",
    "webhook": "/api/webhook"
  },
  "sepay": {
    "account": "[SEPAY_ACCOUNT]",
    "bank_code": "[SEPAY_BANK_CODE]",
    "webhook_secret": ""
  },
  "formspree": {
    "form_id": "[FORM_ID]"
  },
  "crm": {
    "google_sheet_id": "",
    "sheet_tab": "Orders"
  },
  "telegram": {
    "bot_token": "",
    "chat_id": ""
  },
  "checklist": {
    "html_built": false,
    "order_form_configured": false,
    "affiliate_snippet_injected": false,
    "portal_url_replaced": false,
    "webhook_deployed": false,
    "sepay_webhook_url_set": false,
    "google_sheet_connected": false,
    "telegram_configured": false,
    "test_payment_passed": false,
    "domain_live": false,
    "registered_in_portal": false
  }
}
```

### Webhook — tự động đi kèm funnel

Khi build funnel có payment (sales page, booking, challenge VIP):

1. **Copy** `skills/deliver/payment-confirm/scripts/api/webhook.js` → `output/funnel/sales/[slug]/api/webhook.js`
2. **Copy** `skills/deliver/payment-confirm/scripts/vercel.json` → `output/funnel/sales/[slug]/vercel.json`
3. **Copy** `skills/deliver/payment-confirm/scripts/package.json` → `output/funnel/sales/[slug]/package.json`
4. Điền placeholders trong `funnel.json` → user cần set env vars trên Vercel dashboard

Deploy 1 lần duy nhất = cả static HTML + webhook serverless function live cùng domain.

### ⚠️ Affiliate Tracking — BẮT BUỘC Inject Mọi Sales Funnel

KHÔNG được skip dù user không nhắc affiliate. Snippet ở yên không gây hại — nhưng thiếu sẽ mất attribution khi muốn enable affiliate sau, và phải re-deploy toàn bộ funnel.

Load `skills/funnel/affiliate-integration/SKILL.md` để lấy snippet đầy đủ. Tóm tắt:

**Bước 1:** Thêm snippet vào `<head>` của **mọi page** (`index.html`, `order/index.html`, `thank-you/index.html`):

```html
<script>
(function(){
  var p = new URLSearchParams(window.location.search);
  var ref = p.get('ref');
  if (ref) { localStorage.setItem('aff_ref', ref.toUpperCase()); localStorage.setItem('aff_ref_ts', Date.now().toString()); }
  var ts = parseInt(localStorage.getItem('aff_ref_ts') || '0');
  if (Date.now() - ts > 30*24*60*60*1000) { localStorage.removeItem('aff_ref'); localStorage.removeItem('aff_ref_ts'); }
})();
function getAffiliateRef() { return localStorage.getItem('aff_ref') || null; }
</script>
```

**Bước 2:** Trong `order/index.html`, tìm đoạn tạo SePay payment description và inject ref:

```javascript
// Thay dòng tạo description:
// TRƯỚC: const description = `THANHTOAN ${slug} ${email}`;
// SAU:
const affRef = getAffiliateRef();
const description = affRef
  ? `THANHTOAN ${slug} ${email} REF-${affRef}`
  : `THANHTOAN ${slug} ${email}`;
```

SePay webhook (`api/webhook.js`) tự parse `REF-XXXXX` → tạo `affiliate_conversion` + `affiliate_commission` trong Customer Portal. Không cần thêm gì vào webhook code nếu dùng Customer Portal Scenario A.

**Bước 3:** Cập nhật `funnel.json`:
```json
{
  "affiliate": {
    "enabled": true,
    "tracking": "localStorage + SePay REF token",
    "param": "?ref=AFFILIATE_CODE"
  }
}
```

### Abandoned Order Recovery — tích hợp vào webhook

Khi order tạo nhưng chưa thanh toán sau 30 phút → tự động trigger recovery sequence qua Email Marketing Agent.

```js
// Trong api/webhook.js — sau khi tạo order, chưa có payment
const { enrollAbandoned } = require('./email'); // email.js chọn provider từ EMAIL_PROVIDER

async function onOrderCreated({ orderId, email, name, product, amount }) {
  setTimeout(async () => {
    const isPaid = await checkPaymentStatus(orderId);
    if (!isPaid) {
      await enrollAbandoned({
        email, name, product,
        amount: amount.toLocaleString('vi-VN'),
        orderId,
        checkoutLink: `${process.env.SITE_URL}/order/?ref=${orderId}`,
      }).catch(console.error);
    }
  }, 30 * 60 * 1000);
}
```

**Nội dung + setup recovery sequence:** `skills/email-marketing/abandoned-cart/SKILL.md`
**Setup tự động:** `node skills/integrations/email/scripts/setup-funnel-email.js --type abandoned --slug [slug]`

---

## Pricing Psychology (VN Market)

| Giá | Framing |
|-----|---------|
| Under 500K | "Chỉ Xk" — làm nhỏ |
| 500K–2M | Per-day: "Ít hơn 1 ly cà phê/ngày" |
| 2M–10M | 2–3 installments |
| 10M+ | Luôn có installment, show ROI math |

**Charm pricing VN:** `297.000đ`, `997.000đ`, `1.997.000đ`, `4.970.000đ`

---

## Câu Hỏi Cần Hỏi User Trước Khi Viết

1. Awareness level của traffic (cold / warm / hot)?
2. Offer là gì — tên + giá + deliverables cụ thể?
3. Có VSL video chưa, hay dùng text-only?
4. Testimonials / case studies có sẵn không?
5. Có order bump đi kèm không?
6. Traffic source (paid ads / email list / organic)?
7. Có muốn thêm OTO page không? (chỉ build khi user xác nhận)

**Payment rules (order.html):**
- Mặc định chỉ VietQR — không thêm MoMo / chuyển khoản trừ khi user yêu cầu rõ
- Order bump: layout 2 cột — ảnh trái, checkbox + copy phải, click cả card để toggle

**OTO page rules (oto.html — opt-in):**
- Chỉ build khi user yêu cầu ("thêm OTO", "one time offer")
- Trigger: SePay xác nhận đơn chính → redirect oto.html
- YES → QR hiện ngay tại trang · NO → redirect thank-you.html
- Dùng patterns: `oto-header` → `oto-offer` → `oto-proof` → `oto-countdown` → `oto-cta-qr`

**Thank You page (thank-you.html):**
- Dùng pattern stack: `ty-purchase-header` → `ty-access` → `ty-next-steps` → `ty-community` → `ty-refer`
- `ty-access` phải là CTA to nhất trang — resolve buyer's remorse ngay
- Nếu có OTO: uncomment Prompt Vault block trong `ty-purchase-header`
