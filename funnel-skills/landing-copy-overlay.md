---
name: landing-copy
description: "Viết copy cho mọi loại landing page — output là Copy Brief theo section, mỗi section có TYPE + INTENT + VISUAL để AI designer đọc và quyết định layout."
version: 2.0.0
agent: funnel
tags: [copywriting, landing-page, copy-brief, conversion, direct-response]
---

# Skill: Landing Copy

**Mục tiêu của skill này:** Tạo ra Copy Brief — tài liệu trung gian giữa ý tưởng marketing và HTML. Copy Brief phải đủ để AI designer đọc và biết *section này cần làm gì* mà không cần hỏi thêm.

**Skill này KHÔNG generate HTML.** HTML đến sau, do Designer SKILL đảm nhiệm.

---

## Khi Nào Dùng

- Opt-in / lead capture page
- Booking / call / application page
- Sales page (ngắn hoặc dài)
- Thank-you page
- Not-a-fit / redirect page
- VSL landing page

---

## Load Order

```
1. BUSINESS.md                                    → offer, avatar, brand voice
2. SKILL.md (file này)                            → quy trình + format
3. references/section-types.md                    → 15 section types vocabulary
4. references/masters-principles.md               → copywriting principles
5. references/headline-formulas.md                → headline formulas
6. references/fascination-bullets.md              → bullet templates
7. references/copy-[page-type].md                 → spec riêng cho từng loại trang
8. references/vn-market-adaptations.md            → VN market nuances
9. references/natural-transitions.md              → phrases to avoid + transition patterns
10. references/page-structure-patterns.md         → weak vs strong structure examples
11. references/copy-order-bump.md                 → nếu page type là order-form có order bump
```

---

## Quy tắc xưng hô trong copy

**KHÔNG BAO GIỜ dùng "anh/chị" trong copy output.**

| Ngữ cảnh | Xưng hô đúng | Sai |
|----------|-------------|-----|
| Nói với độc giả | **bạn** | ~~anh/chị~~ |
| Thương hiệu/founder tự xưng | **tôi** | ~~mình, em~~ |
| Headline, CTA, bullet | **bạn** | ~~anh/chị~~ |
| Testimonial (quote) | Giữ nguyên giọng người dùng | — |

**Lý do:** "anh/chị" tạo khoảng cách, nghe formal và cứng. "bạn/tôi" thân thiện, trực tiếp, convert tốt hơn.

Ví dụ:
- ❌ `Giúp anh/chị tự động hóa toàn bộ vận hành`
- ✅ `Giúp bạn tự động hóa toàn bộ vận hành`

---

## Quy Trình 3 Bước

### Bước 1 — Phân Tích Offer + Avatar

Trước khi viết, xác định rõ:

- **Offer:** tên, giá, kết quả cụ thể hứa hẹn
- **Avatar:** ai họ là, đang ở đâu trong hành trình, đã thử gì và thất bại
- **Mechanism:** tên riêng của phương pháp/hệ thống (không để trống)
- **Primary fear + desire:** viết bằng chính ngôn ngữ của avatar
- **Page type:** opt-in / booking / sales / thank-you / not-a-fit
- **Awareness stage:** Unaware → Problem Aware → Solution Aware → Product Aware → Most Aware
- **Một CTA duy nhất:** xác định trước khi viết bất kỳ chữ nào

### Bước 2 — Viết Copy Theo Section

Đọc `references/copy-[page-type].md` để biết cần bao nhiêu sections và thứ tự.

Với mỗi section, viết đủ 5 trường:

1. **TYPE** — chọn từ 15 types trong `references/section-types.md`
2. **INTENT** — copy này muốn reader CẢM thấy gì hoặc QUYẾT ĐỊNH gì (1 câu, bắt buộc)
3. **EMPHASIS** — từ khoá wrap `<em>` — liệt kê tất cả
4. **VISUAL** — `none` / `image-placeholder` / `svg-icon` / `video-embed` / `screenshot`
5. **COPY** — nội dung đúng như xuất hiện trên trang, không phải placeholder

**Nguyên tắc khi viết copy:**
- Dùng ngôn ngữ của avatar (từ Bước 1), không phải từ ngữ marketing
- Số liệu cụ thể > tuyên bố chung chung ("47 người" > "hàng trăm người")
- Mỗi section phải có thể đứng độc lập — người chỉ đọc section đó vẫn hiểu
- Không dùng: "chất lượng cao", "hiệu quả", "uy tín" — thay bằng bằng chứng cụ thể

### Bước 3 — Dừng Lại, Chờ Duyệt

Output Copy Brief → trình bày → **dừng lại và chờ duyệt**.

Không tự chuyển sang Design Brief hay HTML. Designer SKILL đảm nhiệm bước tiếp theo.

---

## Copy Brief Format — Output Chuẩn

```markdown
## Copy Brief — [Tên trang] — [Funnel slug]
> Style template: [để trống — Designer SKILL chọn sau]
> Audience: [1 câu mô tả avatar]
> Tone: [direct / warm / authoritative / technical / playful]
> CTA duy nhất: [text của nút bấm chính]

---

### SECTION [số]: [Tên section]

**Type:** [1 trong 15 types từ section-types.md]
**Intent:** [Copy này muốn reader cảm thấy gì hoặc quyết định gì — 1 câu]
**Emphasis:** [từ khoá 1], [từ khoá 2], [từ khoá 3]
**Visual:** [none / image-placeholder / svg-icon / video-embed / screenshot / illustration]

**Copy:**
[Nội dung thật — headline, body, list items, CTA text — đúng như xuất hiện trên trang]

**Designer note:** [Thứ gì đặc biệt AI designer cần biết về section này — optional]

---
```

**Số sections theo page type:**
- Opt-in page: 4–5 sections
- Booking page: 5–7 sections
- Sales page (ngắn): 7–9 sections
- Sales page (dài): 10–14 sections
- Thank-you page: 3–4 sections
- Not-a-fit page: 2–3 sections

---

## Checklist Trước Khi Submit

**Structure:**
- [ ] Mỗi section có đủ TYPE + INTENT + COPY
- [ ] INTENT là hành động/cảm xúc, không phải mô tả copy
- [ ] Hero headline nói outcome — không phải product name hay company name
- [ ] CTA xuất hiện above fold và lặp lại ít nhất 2 lần
- [ ] Không kết trang bằng FAQ — luôn kết bằng CTA
- [ ] Có ít nhất 1 social proof element (số liệu cụ thể, tên thật, trước/sau)

**Copy quality:**
- [ ] Copy dùng ngôn ngữ của avatar, không phải marketing speak
- [ ] Không có tính từ không có bằng chứng: "chất lượng cao", "hiệu quả", "uy tín"
- [ ] Không dùng AI writing tics — xem `references/natural-transitions.md`
- [ ] Headline có ít nhất 2 options với formula name
- [ ] Bullets theo I=B+C (benefit + curiosity đồng thời)
- [ ] Claim nào cũng có số liệu hoặc ví dụ cụ thể đi kèm

**Format:**
- [ ] Emphasis keywords được liệt kê rõ
- [ ] Không có section nào copy chung chung, vague
- [ ] Không có placeholder text còn sót (`[...]`, `TBD`, `lorem ipsum`)

---

## Output Path

```
output/funnel/[type]/[slug]/copy-brief.md
```

Thêm vào `.vercelignore` — không deploy.

---

## Nguyên Tắc Copywriting (Tóm Tắt)

Đọc `references/masters-principles.md` để có full context. Quick reference:

| Principle | Áp dụng |
|-----------|---------|
| Specificity = Credibility (Halbert + Ogilvy) | Số liệu lẻ, tên thật, ngày cụ thể |
| I = B + C (Halbert) | Mỗi bullet: benefit + curiosity đồng thời |
| Before → After (Deiss) | Mô tả rõ trạng thái trước và sau |
| Story Before Sell | Mở bằng story hoặc insight, không bằng product |
| One idea, one action | Mỗi trang 1 CTA duy nhất |
| Edu-marketing (Suby) | Frame như giáo dục, không phải bán hàng |
