# 🎓 Customer Portal Giftbox

Full-stack CRM + eLearning platform, **agent-deployable**. Clone, mở AI IDE, gõ 1 lệnh — portal chạy.

## ⚡ Quick Start

```bash
git clone <this-repo> my-portal
cd my-portal
```

Mở Claude Code / Antigravity / Cursor trong folder, gõ:

```
/portal deploy
```

Agent sẽ:
1. Hỏi bạn Supabase keys + admin email
2. Provision database + seed demo course
3. Deploy lên Vercel (hoặc Railway với `--target=railway`)
4. Trả về URL portal live

**Xong.** Login bằng admin email → thấy portal đầy đủ với 1 khóa mẫu.

## 🎁 Bạn Nhận Được Gì

Xem [WHAT_YOU_GET.md](./WHAT_YOU_GET.md) — full feature list.

TL;DR: **CRM + eLearning + Email hub** với 5 themes có sẵn, admin dashboard, gamification (XP + streak + leaderboard), payment webhook, affiliate program, và slash commands để agent tự tuỳ biến sau này.

## 🎨 Tuỳ Biến

Xem [CUSTOMIZE.md](./CUSTOMIZE.md) — 10 câu lệnh phổ biến để nói với agent.

Ví dụ:
- `/portal rebrand` — đổi tên, màu, logo
- `/portal set-theme aurora` — đổi theme
- `/portal add-course` — thêm khóa học mới
- `/portal add-student` — tạo học viên + gửi welcome
- `/portal health` — kiểm tra portal sống chưa

## 📋 Yêu Cầu

- Node.js ≥ 20
- Supabase account (free tier ok) — tự tạo project tại [supabase.com](https://supabase.com)
- Vercel account HOẶC Railway account (free tier ok)
- (Optional) Resend account cho email — [resend.com](https://resend.com), free 3000 email/tháng

## 🏗️ Stack

Vite + React 19 + Supabase + Tailwind + Resend

## 📖 Docs

- [AGENT.md](./AGENT.md) — Instructions cho AI agent (deploy flow, rebrand flow, kiến trúc)
- [WHAT_YOU_GET.md](./WHAT_YOU_GET.md) — Feature list chi tiết
- [CUSTOMIZE.md](./CUSTOMIZE.md) — Ngôn ngữ tự nhiên → agent action
- [SETUP_GUIDE.md](./SETUP_GUIDE.md) — Manual setup (nếu không dùng agent)
- [`.claude/commands/`](./.claude/commands/) — 6 slash commands có sẵn

## 🆓 License

MIT với ràng buộc giữ dòng "Powered by Rainmaker.vn" trong footer. Fork thoải mái, tuỳ biến của riêng bạn — không có update path, bạn tự quản.

Nếu bạn thấy hữu ích, có thể ghé thăm [Rainmaker.vn](https://rainmaker.vn).

---

**Câu hỏi?** Xem [SETUP_GUIDE.md](./SETUP_GUIDE.md) hoặc mở issue.
