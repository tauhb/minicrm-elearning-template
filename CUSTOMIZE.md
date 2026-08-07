# 🎨 Customize — Nói Với Agent Bằng Tiếng Việt

Bạn không cần code. Chỉ cần nói tiếng Việt với AI agent (Claude Code / Antigravity / Cursor). Bên dưới là 10 câu lệnh phổ biến + kỳ vọng.

## 1. Đổi thương hiệu

**Bạn nói:**
> "Đổi tên portal thành 'Học Viện AI Việt' và đổi màu chủ đạo thành xanh dương #1E88E5"

**Agent làm:**
1. Load `.claude/commands/rebrand.md`
2. Update `app_settings` qua Supabase REST
3. Xác nhận: title + primaryColor đã đổi
4. Reload portal để thấy thay đổi (không cần redeploy)

## 2. Đổi theme

**Bạn nói:**
> "Đổi theme sang aurora"

**Agent làm:**
1. Load `.claude/commands/set-theme.md`
2. Update `app_settings.theme = 'aurora'`
3. Portal auto reload với theme mới

**Themes có sẵn:** cyberpunk, aurora, synthwave, minimal, zen.

## 3. Thêm khóa học mới

**Bạn nói:**
> "Thêm khóa 'Content Marketing 30 Ngày' — 4 chương, mỗi chương 7-8 bài, layout journey"

**Agent làm:**
1. Load `.claude/commands/add-course.md`
2. Có thể hỏi thêm: tên các chương, danh sách bài từng chương
3. Generate JSON structure
4. Chạy `scripts/add-course.mjs --from=course.json`
5. Verify: fetch course vừa tạo, show tree structure

## 4. Import khóa từ file

**Bạn nói:**
> "Tôi có file course.json ở Desktop. Import vào portal giúp"

**Agent làm:**
```bash
node scripts/add-course.mjs --from=/Users/you/Desktop/course.json
```

## 5. Tạo học viên mới

**Bạn nói:**
> "Tạo tài khoản cho học viên: email a@x.com, tên Nguyễn Văn A, enroll vào khóa 'ai-marketing-101', gửi welcome bằng magic link"

**Agent làm:**
1. Load `.claude/commands/add-student.md`
2. Tạo user Supabase Auth
3. Insert profile với `role='student'`
4. Insert enrollment vào `customer_courses`
5. Gửi welcome email qua Resend

## 6. Import bulk students

**Bạn nói:**
> "Có file students.csv với 50 học viên, import hết + enroll vào khóa 'ai-marketing-101'"

**Agent làm:**
```bash
node scripts/add-student.mjs --from=students.csv --course-slug=ai-marketing-101
```

## 7. Broadcast email

**Bạn nói:**
> "Gửi email announcement cho tất cả học viên khóa 'ai-marketing-101' — chủ đề: 'Buổi live tối nay 8h', body: 'Chào bạn, tối nay 8h có buổi live Q&A...', CTA link: https://meet.google.com/xxx"

**Agent làm:**
1. Load admin JWT
2. POST tới `/api/email/broadcast` với `audience=course`, `course_id=<id>`
3. Portal gửi batch 10/lần, sleep 1s giữa batch (rate limit)
4. Return: sent/failed count

## 8. Deploy hoặc redeploy

**Bạn nói:**
> "Deploy portal lên Vercel"

**Hoặc:**
> "Deploy lên Railway"

**Agent làm:**
1. Load `.claude/commands/deploy.md`
2. Check `.env.local`, prompt vars còn thiếu theo `.env.schema.json`
3. Chạy full pipeline: DB migration → seed → build → deploy → smoke test
4. Return: URL portal + admin URL

## 9. Kiểm tra portal có sống không

**Bạn nói:**
> "Kiểm tra xem portal có bị lỗi gì không"

**Agent làm:**
```bash
node scripts/verify-deploy.mjs
```

Hiển thị 7 checks + gợi ý fix nếu fail.

## 10. Sửa UI cụ thể

**Bạn nói:**
> "Trong Course Builder, đổi label 'Zone' thành 'Chương'"

**Agent làm:**
1. Grep tìm 'Zone' trong components/CourseBuilder.tsx
2. Edit từng chỗ với text replacement phù hợp
3. Vite hot-reload — bạn thấy ngay

## AI Funnel Builder (mới)

### 11. Tạo funnel Sales với AI

**Bạn nói:**
> "Tạo funnel Sales cho khoá 'AI Marketing 30 Ngày', giá 1.997k, target là chủ shop online muốn tăng doanh số bằng AI. Guarantee 14 ngày hoàn tiền."

**Agent làm:**
1. Vào `/admin/settings` → Funnel Types → check "Sales Funnel" có sẵn
2. `/admin` → AI Funnels → "+ Tạo funnel mới"
3. Fill wizard: name, slug auto, type=sales, style vibe (khuyên "minimal" cho education)
4. Shared context: nhập offer/audience/pain/USP/guarantee
5. Bấm "Tạo funnel" → auto có 4 steps ready (Landing/Order/Upsell/Thank-you)
6. Click Landing step → chọn formula PAS → "Draft nội dung với AI"
7. Review block outline → "Duyệt content → tạo HTML"
8. Repeat cho Order/Upsell/Thank-you
9. Bấm "Publish" → funnel live tại `/f/<slug>`

### 12. Kết nối SePay cho funnel

**Bạn nói:**
> "Setup thanh toán SePay cho funnel này, bank Vietcombank số 0123456789, chủ TK Nguyễn Văn A"

**Agent làm:**
1. Vào funnel detail → bấm nút "Payment" (top right header)
2. Chọn mode: "Inline VietQR (SePay)"
3. Fill: bank + account + holder + fixed_amount
4. Copy webhook URL từ portal → cho user dán vào SePay dashboard
5. User paste secret từ SePay → portal encrypt AES-GCM lưu
6. Save
7. Chỉnh Order step: form fields (name/email/phone), form_success_step_slug='thank-you'

### 13. Preview funnel end-to-end trước publish

**Bạn nói:**
> "Cho tôi xem thử funnel này chạy như thế nào trước khi publish"

**Agent làm:**
- Bấm "Preview flow" button trong FunnelDetail header
- Modal iframe hiện step 1, click CTA hoặc submit form → nhảy step 2, 3, 4
- Form không thực sự lưu, chỉ mô phỏng navigation

### 14. Import HTML từ nguồn khác

**Bạn nói:**
> "Tôi có landing page từ Framer, muốn import vào step Landing"

**Agent làm:**
1. Vào step Landing → Setting tab → chọn "Import HTML"
2. Paste HTML
3. Config: strip external scripts (recommend on), override form action, auto tag CTAs
4. Bấm Import → portal transform + save

### 15. Đổi công thức viết cho 1 step

**Bạn nói:**
> "Đổi step Landing sang formula BAB (Before-After-Bridge) thay vì PAS"

**Agent làm:**
1. Click step Landing → Setting tab
2. Đổi Formula dropdown sang "BAB"
3. Bấm "Regenerate draft" → AI redo với BAB structure
4. Sang Copy outline tab → review → approve

### 16. Thêm tag cho leads từ funnel

**Bạn nói:**
> "Thêm tag 'khoa-ai-marketing' và 'q4-2026' cho tất cả leads từ funnel này"

**Agent làm:**
- Vào wizard hoặc funnel settings → nhập 2 tag vào Tags chip input
- Enter/comma để add
- Sau save, mọi form submit tự merge tags vào lead

### 17. Add/remove/reorder steps

**Bạn nói:**
> "Xoá step Upsell khỏi funnel này, thêm step Order Bump giữa Landing và Order"

**Agent làm:**
1. Timeline: click icon ⚙️ trên step Upsell → Delete
2. Bấm "+ Add step" → chọn template "Custom" hoặc "Landing" → name="Order Bump", slug="order-bump"
3. Icon ⚙️ trên step mới → Move up/down đến vị trí giữa Landing và Order

### 18. Sửa system prompt của funnel type

**Bạn nói:**
> "Tôi muốn Sales Funnel type luôn viết theo giọng thân thiện hơn"

**Agent làm:**
1. Settings → Funnel Types → Edit "Sales Funnel"
2. Sang tab "System prompt" → thêm instruction "Viết giọng thân thiện, dùng ngôi thứ 2 'bạn', tránh sales-y"
3. Save. Từ giờ tất cả funnel Sales mới tạo sẽ dùng prompt này.

### 19. Tạo funnel type mới

**Bạn nói:**
> "Tạo type mới 'Webinar Funnel' với 3 steps: Register / Confirmation / Post-webinar Offer"

**Agent làm:**
1. Settings → Funnel Types → "+ Add type"
2. Name="Webinar Funnel", key="webinar", icon="video"
3. System prompt: copy nội dung webinar framework
4. Suggested steps tab: define 3 steps với page_type + form config
5. Save. User có thể chọn type này khi tạo funnel

## Nâng Cao — Câu Lệnh Ít Phổ Biến Hơn

### "Thêm 1 theme mới của riêng tôi"
Agent sẽ:
1. Sửa `themes.css` — thêm `[data-theme="myteam"] { --primary: ...; ... }`
2. Update `set-theme.md` để include theme mới
3. Rebuild + redeploy
4. `/portal set-theme myteam`

### "Đổi email template welcome"
Agent sẽ sửa `emails/templates/welcome-magic-link.html` (hoặc welcome-credentials.html tuỳ mode). Không cần redeploy — templates load runtime.

### "Thêm endpoint API mới cho webhook Stripe"
Agent sẽ:
1. Tạo file `api/webhook/stripe.ts` theo pattern `api/webhook/provision.ts`
2. Thêm route vào `scripts/api-server.mjs` (dev + Railway)
3. Vercel auto-detect file mới, không cần config

### "Đổi từ Resend sang SendGrid"
Agent sẽ:
1. Sửa `services/email.ts` — thay `new Resend()` bằng `@sendgrid/mail`
2. Update `.env.example` + `.env.schema.json` với `SENDGRID_API_KEY`
3. Rebuild + redeploy

## Câu Lệnh Agent KHÔNG Nên Làm

Agent phải confirm với bạn trước khi:
- Xoá dữ liệu (drop tables, delete rows)
- Force push / reset git
- Publish package
- Xoá "Powered by Rainmaker.vn" khỏi footer (điều kiện license)

Nếu agent auto làm những việc trên không hỏi bạn → dừng lại, report.

## Khi Nào Cần Google Search / Anthropic Docs?

Agent tự dùng tools như WebSearch/WebFetch nếu:
- Bạn hỏi về Supabase feature mới
- Cần biết Vercel/Railway API changes
- Debug lỗi lạ

Bạn không cần lo — cứ nói vấn đề, agent sẽ tự tra cứu.
