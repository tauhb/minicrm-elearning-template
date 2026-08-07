---
name: leads-funnel
description: "Xây phễu lead generation hoàn chỉnh — từ tạo lead magnet, opt-in page, thank you page, đến email sequence và deploy. Quy trình 5 bước có kiểm soát, mỗi bước chờ duyệt trước khi đi tiếp."
version: 3.0.0
agent: funnel
tags: [lead-magnet, opt-in, landing-page, email-sequence, crm, deploy]
---

# Leads Funnel Skill

## Dependencies — Load Trước Khi Bắt Đầu

```
1. BUSINESS.md                                                        → thông tin business, audience, offer
2. THEME.md                                                           → màu, font, CSS variables
3. skills/funnel/landing-copy/SKILL.md                                → Copy Brief trước khi HTML
4. skills/funnel/landing-copy/references/masters-principles.md        → stack theo page type
5. skills/funnel/landing-copy/references/copy-opt-in.md               → copy spec cho opt-in page
6. skills/funnel/landing-copy/references/headline-formulas.md         → headline options
7. skills/funnel/landing-copy/references/fascination-bullets.md       → bullets
8. skills/funnel/landing-copy/references/vn-market-adaptations.md     → VN copy norms
9. skills/funnel/page-designer/SKILL.md                               → design brief → HTML
```

**Thứ tự thực thi bắt buộc: Lead Magnet → Copy Brief → Design Brief → HTML → Email → CRM → Deploy**

---

## Quy Tắc Quan Trọng

> **Không được chạy sang bước tiếp theo khi chưa có xác nhận của user.**
> Sau mỗi bước, dừng lại: "Bạn muốn chỉnh sửa gì không, hay mình đi tiếp Bước [N+1]?"

### Đại từ trong content
- Tất cả nội dung (landing page, email, lead magnet) dùng **bạn / tôi**
- Không dùng "anh/chị" trừ khi BUSINESS.md hoặc user chỉ định khác

---

## Câu Hỏi Khởi Động (hỏi trước Bước 1)

Nếu chưa rõ từ args, hỏi tuần tự — không hỏi tất cả một lúc:

1. Topic và định dạng lead magnet? (checklist / guide PDF / template / swipe file...)
2. Audience cụ thể là ai?
3. Delivery method: Zalo / Telegram / direct download?
4. Có tripwire offer sau opt-in không? (tên + giá nếu có)
5. Traffic source chính: Facebook ads / organic / YouTube?

Nếu BUSINESS.md đã có thông tin → bỏ qua câu tương ứng.

---

## Bước 1 — Lead Magnet

### 1.0 Chọn Định Dạng

**Nguyên tắc cốt lõi — áp dụng mọi định dạng:**
- **Một vấn đề cụ thể** — hứa hẹn chung chung → opt-in thấp, càng cụ thể càng cao
- **Quick win trong 15 phút** — người nhận dùng được ngay → trust nhanh
- **Dẫn đến offer chính** — kết thúc bằng next step hướng về paid offer
- **Giảm ma sát tối đa** — chỉ xin email (+ tên nếu cần), giao ngay sau opt-in

**Chọn định dạng theo audience và timeline:**

| Định dạng | Tỷ lệ opt-in | Thời gian tạo | Phù hợp nhất |
|-----------|-------------|--------------|--------------|
| Checklist | 30–45% | 1–2h | Mọi audience |
| Template / Swipe File | 35–50% | 2–4h | Marketer, chủ shop |
| Guide PDF 5–10 trang | 25–35% | 4–8h | Audience thích đọc |
| Mini-course email | 20–30% | 6–10h | Topic phức tạp |
| Video training | 25–40% | 6–15h | Audience TikTok/YouTube |
| Quiz / Trắc nghiệm | 40–60% | 8–12h | Segmentation mạnh |

**Naming Formula:**
```
[Kết quả cụ thể] + [Dễ/Nhanh/Không cần X] + [Format]
```
Ví dụ:
- "7 Mẫu Caption Facebook Bán Hàng Chạy — Swipe File Miễn Phí"
- "Checklist 30 Bước Mở Shop Shopee Không Bỏ Sót"
- "Template Content Calendar 30 Ngày — Điền Vào Là Đăng"

**Kênh phân phối VN:**

| Kênh | Phù hợp | Cách dùng |
|------|---------|----------|
| **Email** | Audience 30+, B2B | MailerLite / GetResponse / EmailOctopus |
| **Zalo OA** | Audience VN phổ thông | Gửi tự động khi follow OA |
| **Telegram Bot** | Tech-savvy, creator | Bot tự động gửi file/link |
| **Link trực tiếp** | Đơn giản nhất | Google Drive / Vercel (không cần email) |
| **Combo** | Tối ưu nhất | Email delivery + Zalo follow-up |

**Lỗi thường gặp — tránh ngay từ đầu:**
1. Quá rộng: "Hướng dẫn kinh doanh" → không ai muốn
2. Quá dài: 50 trang nobody reads — 5–10 trang actionable là đủ
3. Không follow-up: 80% giá trị đến từ email sequence sau lead magnet
4. Giao bị lỗi: link Google Drive hết hạn / file không download được → mất trust ngay
5. Không có next step: luôn kết thúc bằng CTA dẫn đến offer hoặc trang tư vấn

### 1.1 Tạo Nội Dung

Tạo đầy đủ — không tóm tắt:
- Tên lead magnet + tagline 1 câu
- Định dạng được chọn + lý do
- Outline đầy đủ từng phần
- Nội dung hoàn chỉnh từng phần

Output dưới dạng text thuần để user đọc duyệt.

**Format nếu là guide/PDF — mỗi chương/agent phải có:**
- Tên + mô tả 1 câu
- Vấn đề giải quyết (2–3 câu)
- Hướng dẫn từng bước cụ thể
- Prompt mẫu sẵn sàng copy-paste (không dùng "ví dụ chung chung")
- Action box cuối trang

### 1.2 Checkpoint → Dừng

```
📋 Lead magnet đã sẵn sàng để duyệt.

Bạn muốn chỉnh sửa phần nào không?
Nếu ổn, mình tạo file HTML + convert sang PDF.
```

### 1.3 Sau Khi Được Duyệt

1. Tạo `assets/lead-magnet.html` — PDF document layout (single column, A4, không phải landing page)
2. Lưu vào `output/funnel/leads/[funnel-slug]/assets/lead-magnet.html`
3. Convert sang PDF:

```bash
node skills/funnel/leads-funnel/scripts/convert-pdf.js \
  output/funnel/leads/[funnel-slug]/assets/lead-magnet.html
```

Script dùng Puppeteer — tự cài nếu chưa có. Output: `assets/lead-magnet.pdf`.

4. Confirm: `✅ Bước 1 xong. lead-magnet.pdf đã lưu.`

---

## Bước 2 — Landing Page & Thank You Page

### 2.0 VSL (Optional)

```
Opt-in page này có cần video không?

VSL ngắn (2–5 phút) có thể tăng conversion bằng cách build trust nhanh hơn text-only.

A) Có — tạo VSL script trước, embed vào opt-in page
B) Không — dùng text + CSS visual (mặc định)
```

Nếu A → load `skills/funnel/vsl/SKILL.md`, lưu vào `output/funnel/leads/[slug]/vsl/`, rồi tiếp 2.1.

### 2.1 Tạo Copy (text thuần — chưa HTML)

**Form rule — DEFAULT: chỉ thu email, không thu tên.**

Friction thấp → opt-in rate cao hơn 20-40%. Cần name? Thu sau qua email đầu tiên ("Trước khi gửi, mình gọi bạn là gì cho thân?"). Chỉ thêm name field nếu lead magnet thực sự cần personalization ngay (ví dụ: "Diagnostic report cho [Tên]").

**Opt-in Page:**
- Headline chính
- Subheadline (dành cho ai + nhận được gì)
- 3 bullet benefits
- CTA button text
- Privacy micro-copy
- Social proof line (nếu có)
- Author bio ngắn (2 câu)

**Thank You Page copy:**
- Confirmation headline
- Delivery instruction (theo delivery method đã chọn)
- Quick win tip (1 insight actionable, 2–3 câu)
- Next step CTA (community / video / booking — chọn 1)
- Tripwire block (nếu có offer)

### 2.2 Checkpoint → Dừng

```
📋 Copy đã sẵn sàng.

Bạn muốn chỉnh sửa nội dung nào không?
Nếu ổn, mình chuyển sang chọn phong cách thiết kế.
```

### 2.3 Design Brief

Theo `skills/funnel/page-designer/SKILL.md` — Bước 2 (Section Design Brief).
Với mỗi section: xác định Background / Layout / Elements / Visuals / Pattern.
Trình bày toàn bộ → chờ duyệt.

**Rule cho opt-in page:**
- Form #1 above the fold (hero section)
- **Form #2 ở giữa hoặc cuối trang** (sau benefits / author bio) — recovery scroll-down visitor. Đây là pattern proven tăng conversion 15-25% cho visitor không opt-in lần đầu nhìn thấy.
- Cả 2 form trỏ về cùng webhook, cùng tracking. Form #2 có thể compact hơn (1 dòng email + button).

### 2.4 Hình Ảnh

```
Chuẩn bị hình ảnh:
A) Tự cung cấp (upload hoặc link)
B) Tạo bằng AI (Gemini / GPT Image) — ~$0.02–0.08/ảnh
C) Không cần ảnh — dùng CSS visual + media slot placeholder
```

Nếu B → tạo prompt chi tiết cho từng ảnh, hỏi confirm trước khi gọi API.

### 2.5 Generate HTML

1. Dùng HTML scaffold từ `skills/funnel/page-designer/SKILL.md`
2. **Bắt buộc** thêm `<meta name="robots" content="noindex,nofollow">` vào `<head>` của cả `index.html` và `thank-you.html` — opt-in page và thank-you page không nên index trên Google (tránh cạnh tranh SEO với main domain, không thu hút sai traffic).
3. Áp dụng đúng layout từ design brief đã duyệt
4. Tạo `index.html` (opt-in page) với 2 form positions theo Step 2.3
5. Tạo `thank-you.html` theo pattern stack:

```
ty-leadmag-header    ← check email icon · 3-step instruction · spam tip
ty-download          ← nếu có file tải thẳng — bỏ qua nếu gửi qua email
ty-social-follow     ← FB Page + Zalo OA + [OPTIONAL YouTube]
ty-while-you-wait    ← soft bridge → main offer · ghost CTA, không push hard
```

> Deliver lead magnet trước. `ty-while-you-wait` chỉ pitch nhẹ ở cuối — không redirect thẳng sang sales page.

5. Placeholder `[CRM_WEBHOOK_URL]` trong form
6. **⚠️ BẮT BUỘC — Affiliate tracking snippet** — thêm vào `<head>` của cả `index.html` và `thank-you.html`. KHÔNG được skip dù user không nhắc affiliate. Snippet này không hại nếu funnel chưa có affiliate, nhưng thiếu sẽ mất attribution khi muốn enable sau:

```html
<!-- Affiliate Tracking — xem skills/funnel/affiliate-integration/SKILL.md -->
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

7. **Form submit handler** — thêm `ref: getAffiliateRef()` vào payload gửi lên `capture-lead`:

```javascript
// Trong handleSubmit / submitForm:
const payload = {
  name:         nameInput?.value || '',
  email:        emailInput.value.trim(),
  source:       'funnel',
  page_url:     window.location.href,
  utm_source:   new URLSearchParams(location.search).get('utm_source'),
  utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
  ref:          getAffiliateRef(), // ← affiliate attribution
};
await fetch('[PORTAL_URL]/api/capture-lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

8. Lưu vào `output/funnel/leads/[funnel-slug]/`

### 2.6 Mobile Check → Dừng

```
Mobile Check:
□ Không có element overflow ngang
□ Button height ≥ 48px
□ Input font-size ≥ 16px
□ Form above-the-fold trên 375px
□ CTA button width: 100%
```

```
📱 HTML đã xong. Mở file trong browser và check trên mobile không?
(DevTools → toggle device toolbar → iPhone SE / 375px)

Báo biết nếu cần sửa, hoặc gõ "ok" để đi Bước 3.
```

---

## Bước 3 — Email Welcome Sequence

### 3.1 Tạo 7 Email

| # | Timing | Mục tiêu |
|---|--------|---------|
| 1 | Ngay lập tức | Deliver + first impression |
| 2 | Ngày 1 | Quick win |
| 3 | Ngày 2 | Story + connection |
| 4 | Ngày 4 | Deep value — framework |
| 5 | Ngày 5 | Social proof — case study |
| 6 | Ngày 6 | Objection handling |
| 7 | Ngày 7 | Soft offer |

Tạo đầy đủ: subject line + nội dung hoàn chỉnh từng email.
Lưu vào `email-sequence/email-[N]-[slug].md`.

### 3.2 Checkpoint → Dừng

```
📧 7 email đã sẵn sàng trong email-sequence/.

Xem và duyệt từng email, hay duyệt tất cả cùng lúc?
Nếu ổn, mình đi Bước 4 — kết nối CRM.
```

---

## Bước 4 — Kết Nối CRM

### 4.1 Kiểm Tra CRM_WEBHOOK_URL

Đọc `.env`:
- Có → dùng luôn
- Chưa có → nhắc: `Cần setup CRM trước: xem skills/funnel/crm/scripts/README.md`

### 4.2 Inject Webhook

Tìm `[CRM_WEBHOOK_URL]` trong `index.html` → thay bằng URL thực.
Thêm `source: '[funnel-slug]'` vào payload form.

### 4.3 Cập Nhật funnel.json

```json
{
  "slug": "[funnel-slug]",
  "name": "[Tên funnel]",
  "type": "leads",
  "lead_magnet": "[Tên lead magnet]",
  "delivery": "[zalo | telegram | download]",
  "crm_webhook": "[URL]",
  "created": "[YYYY-MM-DD]"
}
```

### 4.4 Checkpoint → Dừng

```
🔗 CRM đã kết nối.

Nhớ thêm row vào Google Sheet tab "🎯 Funnel Settings":
- Funnel Slug: [slug]
- Link Zalo/Telegram: [điền link nhóm]

Xác nhận xong thì gõ "ok" để đi Bước 5 — Deploy.
```

---

## Bước 4.5 — Kết Nối Brevo (Optional)

Brevo là marketing email layer — nếu đã setup (`BREVO_API_KEY` có trong `.env`), leads sẽ tự động vào Brevo "Leads" list và được trigger lead-nurture sequence.

### 4.5.1 Kiểm Tra

```
BREVO_API_KEY có trong .env?
  YES → thêm Brevo hook vào form submit handler
  NO  → skip, chỉ dùng CRM webhook
```

### 4.5.2 Inject Email Hook vào Form Handler

Trong `api/capture-lead.js` (hoặc form submit handler của landing page):

```js
// Thêm sau khi save lead vào CRM:
const { enrollLead } = require('./email'); // provider được chọn qua EMAIL_PROVIDER trong .env

if (process.env.EMAIL_PROVIDER) {
  await enrollLead({
    email:  req.body.email,
    name:   req.body.name || '',
    source: '[funnel-slug]',
  }).catch(err => console.error('[enrollLead]', err.message));
}
```

`email.js` tự chọn provider dựa vào `EMAIL_PROVIDER` trong `.env` — không cần thay code khi đổi provider.

### 4.5.3 Cập Nhật funnel.json

```json
{
  "email": {
    "provider": "[EMAIL_PROVIDER]",
    "leads_list_id": "[BREVO_LIST_ID_LEADS]",
    "sequence": "lead-nurture"
  }
}
```

Nếu chưa setup email → để `"email": null`.

> **Tham khảo:** `skills/integrations/email/SKILL.md` để setup đầy đủ.
> Setup script: `node skills/integrations/email/scripts/setup-email.js`

---

## Bước 5 — Deploy

### 5.1 Pre-Deploy Checklist

```
□ .vercelignore có email-sequence/ và funnel.json
□ vercel.json có cleanUrls: true
□ index.html có CRM webhook URL thật
□ thank-you.html có link Zalo/Telegram thật
□ lead-magnet.pdf tồn tại trong assets/
```

### 5.2 Setup Brevo Automation (nếu có BREVO_API_KEY)

```bash
node skills/integrations/email/scripts/setup-funnel-email.js --type leads --slug [funnel-slug]
```

Tự động: tạo Brevo list + 5 email templates với content từ `references/email-lead-nurture.md`.
Sau đó làm theo hướng dẫn được in ra (1 lần click trong Brevo UI, ~5 phút).

### 5.3 Deploy

```bash
cd output/funnel/leads/[funnel-slug]
vercel --prod
```

### 5.4 Test Sau Deploy

1. Submit form test → Google Sheet tab Leads có row mới
2. Mở thank-you page → nút Zalo/Telegram hoạt động
3. Telegram notification nhận được (nếu đã setup)
4. Brevo: submit email test → Email 1 arrives trong vài giây

### 5.4 Done

```
🎉 Funnel đã live!

📊 Opt-in page:   [URL]
💌 Thank-you:     [URL]/thank-you
📁 Lead magnet:   [URL]/assets/lead-magnet.pdf
📋 CRM:           [Google Sheet URL]

Bước tiếp theo:
→ Điền link live vào funnel.json
→ Setup traffic (Facebook ads / organic)
→ Monitor CRM tuần đầu
```

---

## Output — Cấu Trúc File

```
output/funnel/leads/[funnel-slug]/
├── index.html                    → opt-in page       (deploy ✓)
├── thank-you.html                → thank you page    (deploy ✓)
├── assets/
│   ├── lead-magnet.html          → nguồn PDF         (deploy ✓)
│   ├── lead-magnet.pdf           → file giao leads   (deploy ✓)
│   └── images/                   → ảnh nếu có        (deploy ✓)
├── email-sequence/               → KHÔNG deploy
│   ├── email-1-welcome.md
│   ├── email-2-quick-win.md
│   ├── email-3-story.md
│   ├── email-4-education.md
│   ├── email-5-social-proof.md
│   ├── email-6-objection.md
│   └── email-7-offer.md
├── .vercelignore
├── funnel.json                   → metadata nội bộ   (không deploy)
└── vercel.json
```

---

## Benchmarks Thị Trường VN

- Opt-in rate (cold traffic): 15–30% *(ít thói quen dùng email hơn US)*
- Opt-in rate (warm traffic): 35–55%
- Email welcome open rate: 50–70% (email 1), 30–50% (các email sau)
- Chuyển đổi sang paid từ welcome sequence: 3–8%

---

## CTA Button Copy (hiệu quả giảm dần)

1. "Nhận Miễn Phí Ngay →"
2. "Gửi Cho Tôi Ngay"
3. "Tôi Muốn Nhận"
4. "Tải Về Miễn Phí"
5. "Đăng Ký Ngay" ← tránh, quá generic
