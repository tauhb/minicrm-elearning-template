# 🎁 What You Get

Portal đầy đủ tính năng, không phải starter kit trống.

## 📚 eLearning Platform

### Cho học viên
- **Bản đồ khóa học** (Game Map) — journey mode dạng game
- **Module view** — Udemy-style, xem tự do
- **Quest/lesson** — video embed (YouTube/Vimeo), checklist tasks, resources
- **Gamification** — XP reward, streak hàng ngày, unlock từng ngày
- **Leaderboard** — bảng xếp hạng theo XP + streak
- **Submissions** — học viên nộp bài, admin review
- **Multi-course** — 1 học viên học nhiều khóa, có switcher
- **Progress persist** — lưu ở Supabase + cache localStorage

### Cho giảng viên/admin
- **Course Builder** — UI kéo thả tạo/edit zones + quests + tasks
- **Course layouts** — chọn `journey` (game) hoặc `module` (Udemy) cho mỗi khóa
- **Enrollments** — grant khóa học cho từng học viên
- **Products** — bán sản phẩm số riêng ngoài khóa học

## 💼 CRM

- **Leads table** — danh sách leads với filter, sort, search
- **Sales pipeline** — kéo thả leads qua các stage (kanban)
- **Lead activities** — timeline hoạt động của lead (call, email, note)
- **Care history** — ghi chú chăm sóc từng lead
- **Convert lead → customer** — 1 click
- **Orders/Payments** — theo dõi tất cả đơn hàng
- **Students view** — danh sách học viên với thông tin đầy đủ
- **Assign leads** — phân công sales người phụ trách

## 🎯 AI Funnel Builder (mới)

### Multi-step funnels
- **Sales Funnel** (built-in): Landing → Order → Upsell → Thank-you (4 steps auto-suggested)
- **Leads Funnel** (built-in): Landing + form → Thank-you (2 steps)
- **Custom types**: tự tạo funnel type mới trong Settings → Funnel Types (VD Coaching Call, Product Launch, Webinar)

### Content-first workflow (2-step)
1. **Setting step tab**: pick formula (PAS/AIDA/BAB/4Ps/QUEST/Star-Story) + raw input
2. AI drafts **structured JSON blocks** (Hero, Pain, Solution, Testimonial, Pricing, FAQ, CTA...)
3. **Copy outline tab**: edit block tree inline, regenerate individual sections
4. Approve → **per-block HTML render** (parallel 3 blocks, avoids max_output_tokens)
5. Publish → live at `/f/<slug>`

### 20 known block types
Hero (3 variants), Pain (list/story), Solution reveal, Feature-benefit, Mechanism, Testimonials (grid/single), Stats, Logos, Case study, Pricing (table/single), Bonus stack, Guarantee, Countdown, Scarcity, FAQ, Comparison, Timeline, CTA (simple/form/repeat), Custom (AI freeform escape hatch)

### Content sources
- **AI Draft** (recommended): 2-step draft → approve → HTML
- **AI Direct**: 1-step input → HTML (coming soon)
- **Import HTML**: paste HTML từ Landingi/Framer/anywhere → analyzer strips scripts + overrides form action + tags CTAs
- **Blank**: viết HTML tay (coming soon)

### Style picker
- **6 vibes**: Cyberpunk / Minimal / Warm / Corporate / Startup / Editorial
- **5 font pairs**: Inter+Playfair / Manrope+Fraunces / IBM Plex / Space Grotesk+Instrument / System
- Layout density (Airy/Balanced/Dense) + brand color hex

### Preview flow simulator
- Preview button trong FunnelDetail → modal iframe stack
- Click through steps + intercept form submits (không lưu thật)
- Test end-to-end trước khi publish

### Funnel Types & Copy Formulas — editable
- Settings → Funnel Types: 30k-char skill prompt per type (editable)
- Settings → Copy Formulas: 6 built-in copy formulas, add custom

### Form handling + CRM sync
- Form fields editor per step (name/label/type/required)
- Submit → auto-create lead trong CRM leads table
- Merge tags (`tags_to_apply` + `additional_tags`) vào lead
- UTM tracking từ referrer

### SePay VietQR payment
- Payment config drawer: bank + account + webhook secret (encrypted AES-GCM)
- QR generation via `qr.sepay.vn/img` với reference code auto-generated
- Payment page với countdown expiry + polling (3s)
- SePay webhook `/api/f/sepay-webhook` → verify Apikey → match reference → mark paid → convert lead → customer → create payments row
- Auto-redirect thank-you khi detect paid

### UX polish
- Auto-suggest steps từ type khi tạo funnel (transparent)
- Reorder steps ↑↓, add step (6 templates), rename, delete
- Version history (5 versions/step, auto-prune trigger)
- Regenerate all button trong Copy outline
- Formula + model badges

## 💰 Payment & Affiliate

- **SePay webhook** — nhận notify VietQR tự động → provision customer + enroll khóa học
- **Manual create customer** — admin tạo customer thủ công (magic link hoặc password)
- **Affiliate program** — đăng ký affiliate, referral code, hoa hồng
- **Affiliate dashboard** — affiliate xem earnings, clicks, conversions
- **Payout tracking** — admin duyệt payout cho affiliate

## 📧 Email Hub (Resend Default)

- **6 templates sẵn**: welcome (magic link + credentials), password reset, enrollment, payment confirmation, certificate, broadcast
- **Layout thống nhất** với "Powered by Rainmaker.vn" footer
- **`POST /api/email/send`** — funnel/integration gọi vào gửi email tuỳ ý
- **`POST /api/email/broadcast`** — admin broadcast cho all students / theo khóa / list custom
- **Rate limiting** — batch 10/lần, sleep 1s giữa batch
- **Provider swap** — chỉ cần đổi 1 file `services/email.ts` để chuyển provider

## 🎨 Design

- **5 themes có sẵn**: cyberpunk (default), aurora, synthwave, minimal, zen
- **Full CSS variables** — override 1 màu là đổi cả app
- **Branding editable** qua admin UI hoặc `/portal rebrand`: title, logo, primary color, description
- **Responsive** — desktop + tablet + mobile
- **Dark mode default**, themes tự chọn light nếu muốn

## 🔧 Deploy & DevOps

- **Vercel** — `npm run setup:deploy` tự động
- **Railway** — `npm run setup:deploy-railway` tự động (build + serve dist + API)
- **Supabase CLI** — `npm run setup:db` chạy migrations tự động
- **Seed script** — 5 zones + 35 quests demo có sẵn để không bị empty state
- **Health endpoint** — `GET /api/health` cho monitoring
- **`.env.schema.json`** — agent biết prompt user vars nào

## 🤖 Agent Integration

- **`AGENT.md`** — instructions cho AI agent
- **`.claude/commands/`** — 6 slash commands: deploy, rebrand, add-course, add-student, set-theme, health
- **REST wrapper scripts** — `scripts/rebrand.mjs`, `scripts/add-course.mjs`, `scripts/verify-deploy.mjs`
- **Bulk import** — CSV/JSON import qua script

## 📦 Database Schema

16 tables đã setup sẵn với RLS:
- Auth: `profiles` (mở rộng auth.users), `customers`
- Learning: `courses`, `zones`, `quests`, `tasks`, `videos`, `resources`, `submissions`, `customer_courses`, `user_progress`, `user_streaks`
- CRM: `leads`, `lead_activities`, `pipeline_stages`, `care_history`
- Commerce: `payments`, `products`, `customer_products`
- Growth: `affiliates`, `affiliate_referrals`, `affiliate_payouts`, `funnels`
- Config: `app_settings`, `webhook_events`

## 🎯 Đối Tượng Phù Hợp

- Chuyên gia/coach muốn có portal riêng cho khách hàng
- Người bán khóa học online
- Doanh nghiệp SaaS nhỏ muốn portal có sẵn CRM + email
- Người muốn nghiên cứu 1 codebase full-stack thật để học

**KHÔNG phù hợp nếu:** cần multi-tenant (1 portal serve nhiều customer riêng biệt), enterprise-grade compliance (HIPAA, SOC2).

## 🚫 Cái Không Có (Sẽ Cần Tự Add)

- Video hosting (dùng YouTube/Vimeo embed)
- Live streaming
- Certificate PDF generation (email template có, nhưng URL certificate bạn tự làm)
- Multi-language (Vietnamese hardcoded, tự dịch sang EN nếu cần)
- Mobile app (chỉ có web responsive)
