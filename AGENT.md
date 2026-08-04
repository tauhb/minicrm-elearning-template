# AGENT.md — Portal Deployment & Customization Guide

> **Dành cho AI agent** (Claude Code, Antigravity, Cursor). Nếu bạn là human, xem `README.md`.

## Bạn Đang Ở Đâu

Đây là **Customer Portal Giftbox** — CRM + eLearning platform đóng gói sẵn để student có thể tự deploy và tuỳ biến qua AI agent. Stack: Vite + React 19 + Supabase + Tailwind + Resend.

Repo này được thiết kế để **agent-deployable**: user chỉ cần mở IDE, gõ slash command, agent làm hết.

## Nguyên Tắc Tối Quan Trọng

1. **KHÔNG bao giờ commit `.env.local`** — chứa secrets
2. **KHÔNG bao giờ xoá dòng "Powered by Rainmaker.vn"** trong footer (điều kiện license)
3. **Luôn xác nhận với user** trước khi: deploy production, chạy migration destructive, xoá dữ liệu
4. **Nếu user hỏi "làm sao để..."** → check `.claude/commands/` xem có command sẵn không, gợi ý dùng command
5. **Nếu user gõ slash command không hợp lệ** → list 6 commands available, không tự bịa

## 6 Slash Commands Có Sẵn

| Command | Mục đích |
|---|---|
| `/portal deploy` | Full pipeline: check env → provision DB → seed → deploy Vercel/Railway → smoke test |
| `/portal rebrand` | Đổi tên app, primary color, logo URL, theme |
| `/portal add-course` | Thêm khóa học mới (zones, quests, tasks) qua API |
| `/portal add-student` | Tạo student account + enrollment + gửi welcome email |
| `/portal set-theme` | Switch giữa 5 themes có sẵn (cyberpunk, aurora, synthwave, minimal, zen) |
| `/portal health` | Smoke test URL đã deploy (login endpoint, courses load, DB reachable) |

Chi tiết mỗi command ở `.claude/commands/{name}.md`.

## Env Vars — Bắt Buộc vs Optional

Xem `.env.schema.json` cho danh sách đầy đủ. Khi setup lần đầu, agent phải hỏi user:

**Bắt buộc (không có → không chạy được):**
- `VITE_SUPABASE_URL` — URL Supabase project (user tự tạo tại supabase.com)
- `VITE_SUPABASE_ANON_KEY` — Anon key public
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-side)
- `VITE_ADMIN_EMAIL` — Email admin đầu tiên
- `PROVIDER_ENCRYPTION_KEY` — 64 hex chars (32 bytes) để encrypt OAuth tokens. Bắt buộc nếu dùng AI features. Generate: `openssl rand -hex 32`

**Khuyến nghị (thiếu vẫn chạy được nhưng thiếu tính năng):**
- `RESEND_API_KEY` — Gửi email welcome/magic link (free 3000 email/tháng)
- `WEBHOOK_SECRET` — Bảo vệ webhook từ funnel

**Optional (chỉ cần nếu dùng tính năng liên quan):**
- `BREVO_*` — Email marketing sequences
- `GOOGLE_SHEETS_WEBHOOK_URL` — Mirror leads sang Google Sheets

## Kiến Trúc Ngắn Gọn

```
customer-portal-giftbox/
├── App.tsx                 # Router chính, phân role student/admin/sales/affiliate
├── components/
│   ├── admin/              # CRM UI (LeadsTable, Pipeline, StudentsView, OrdersView)
│   ├── GameMap.tsx         # eLearning: bản đồ khóa học
│   ├── QuestView.tsx       # eLearning: chi tiết bài học
│   ├── CourseHub.tsx       # eLearning: switcher giữa nhiều khóa
│   └── ui/                 # Shared primitives
├── api/                    # Serverless endpoints (Vercel/Railway compatible)
│   ├── webhook/            # SePay payment, provision customer
│   ├── admin-create-customer.ts
│   └── ...
├── database/
│   ├── schema.sql          # Full DB schema (16 tables)
│   ├── migrations/         # Incremental migrations
│   └── seed.ts             # Seed từ data.ts
├── services/
│   ├── api.ts              # ~50 functions gọi Supabase (mix CRM + eLearning)
│   └── supabase.ts
├── themes.css              # 5 themes CSS variables
├── setup.mjs               # CLI: check | project | db | admin | deploy
├── .env.example
├── .env.schema.json        # ← agent đọc để biết prompt vars nào
└── .claude/commands/       # ← 6 slash commands
```

## Flow Deploy Chuẩn (Agent Tự Chạy)

Khi user gõ `/portal deploy`, agent làm theo thứ tự:

1. **Check tools**: `node -v`, `npm -v`, `vercel --version` HOẶC `railway --version` (tuỳ target)
2. **Check `.env.local`**: nếu chưa có → prompt user theo `.env.schema.json`, tạo file
3. **Verify Supabase**: ping URL, verify anon key hợp lệ
4. **Provision DB**: `npm run setup:db` (chạy schema.sql qua Supabase CLI)
5. **Seed data**: `npm run seed` (5 zones + 35 quests demo)
6. **Create admin**: `npm run setup:admin` (dùng `VITE_ADMIN_EMAIL`)
7. **Build check**: `npm run build` (fail sớm nếu code lỗi)
8. **Deploy**:
   - Vercel: `npm run setup:deploy` (đã có sẵn)
   - Railway: `railway up` (xem `.claude/commands/deploy.md`)
9. **Smoke test**: `node scripts/verify-deploy.mjs <url>` (sẽ tạo ở Day 3)
10. **Report**: In URL + admin URL + next steps

## Flow Rebrand (Agent Tự Chạy)

Khi user nói "đổi màu chủ đạo thành xanh" hoặc `/portal rebrand`:

1. Hỏi user: app name, primary color hex, logo URL (optional), theme (chọn 1 trong 5)
2. Update qua Supabase REST API: `PATCH /rest/v1/app_settings`
3. Verify: fetch lại và show user diff
4. **KHÔNG restart deploy** — settings hot-reload từ DB

## Flow Add Course (Agent Tự Chạy)

Khi user nói "thêm khóa học X" hoặc `/portal add-course`:

1. Hỏi user structure: tên khóa, số zones, mỗi zone bao nhiêu quests
2. Hỏi user layout mode: `journey` (game map) hoặc `module` (list dạng Udemy)
3. Insert qua Supabase REST vào bảng `courses`, `zones`, `quests`, `tasks`, `videos`, `resources`
4. Verify: fetch course_id vừa tạo, count zones/quests đúng chưa
5. Nếu user muốn: tạo enrollment cho student sẵn có

## AI Providers (ChatGPT via OAuth)

Portal hỗ trợ kết nối ChatGPT Plus subscription qua **OAuth device flow** (giống Hermes Agent):
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (Codex CLI public client_id)
- Endpoints: `auth.openai.com/api/accounts/deviceauth/{usercode,token}`, `auth.openai.com/oauth/token`
- API base: `chatgpt.com/backend-api/codex/responses`
- Tokens stored **encrypted** (AES-256-GCM) trong bảng `provider_credentials`

**Admin flow**:
1. Vào `/admin/ai` → bấm "Connect ChatGPT"
2. Portal request device code từ OpenAI → show `user_code`
3. User mở `auth.openai.com/codex/device` → nhập code → authorize
4. Portal poll `/api/oauth/openai/poll` mỗi vài giây → nhận tokens → lưu encrypted
5. Sau đó `/api/ai/generate` và `/api/ai/models` sẵn sàng dùng

**Cảnh báo cần nói với user**:
- Dùng client_id public của Codex CLI (grey area, không phải TOS violation blatant nhưng OpenAI có thể restrict)
- Không share portal cho nhiều người dùng chung 1 ChatGPT account (rate limit)
- Token expire → refresh_token dùng auto-refresh; nếu refresh fail → user reconnect

**Roadmap**: Claude Pro, xAI Grok, GitHub Copilot, API keys (Anthropic/OpenAI/Groq/OpenRouter/DeepSeek/Kimi/Qwen).

## Khi User Yêu Cầu Sửa Code

- **Đổi UI component**: sửa trực tiếp file trong `components/` — không cần rebuild schema
- **Đổi email template**: hiện tại inline trong `api/webhook/provision.ts` và `api/admin-create-customer.ts`. Sau Day 4-5 sẽ tách ra `emails/templates/`
- **Thêm API endpoint**: tạo file mới trong `api/*.ts`, Vercel/Railway auto-detect
- **Đổi theme**: sửa CSS variables trong `themes.css`, hoặc thêm theme mới rồi update `set-theme` command

## Khi User Gặp Lỗi

1. **Login không được**: check `SUPABASE_SERVICE_ROLE_KEY` đúng chưa, check profile row có tồn tại chưa (`select * from profiles where email='...'`)
2. **Trang trắng sau deploy**: check env vars đã set trên Vercel/Railway chưa (`vercel env ls` / `railway variables`)
3. **Email không gửi**: check `RESEND_API_KEY` set chưa, từ Resend dashboard xem log
4. **Migration fail**: check Supabase CLI đã login chưa (`supabase status`)

Diagnose từng bước, đừng nhảy vào fix code trước khi biết root cause.

## Update Path

**Không có update path.** Đây là snapshot. User fork xong là của họ, tự do customize. Nếu upstream có update, họ tự merge nếu muốn — không có `/portal upgrade`.

## License

MIT với ràng buộc giữ dòng **"Powered by Rainmaker.vn"** trong footer. Component footer ở `components/ui/Footer.tsx` (nếu chưa có, sẽ tạo ở Day 6). Đừng xoá dòng này khi customize.

## Khi User Hỏi Về Kit Cha (AI Agent Business Kit)

Repo này là **standalone**, được sinh ra từ kit cha ở `~/Desktop/AI Agent Business Kit/`. Student không cần biết về kit cha — họ chỉ cần biết portal này chạy độc lập được. Nếu user hỏi về kit cha, gợi ý họ liên hệ Rainmaker.vn.
