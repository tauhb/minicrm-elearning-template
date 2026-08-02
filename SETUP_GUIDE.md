# 🚀 Hướng Dẫn Cài Đặt Customer Portal

> Tổng thời gian: **~20 phút** | Không cần biết code

---

## Chuẩn Bị (làm 1 lần duy nhất)

Trước khi bắt đầu, đảm bảo anh/chị có:

| Cần có | Đăng ký tại | Ghi chú |
|--------|------------|---------|
| Tài khoản **Supabase** | [supabase.com](https://supabase.com) | Miễn phí |
| Tài khoản **Vercel** | [vercel.com](https://vercel.com) | Miễn phí |
| **Node.js 18+** | [nodejs.org](https://nodejs.org) → bản LTS | Kiểm tra: `node --version` |

---

## Bước 1 — Cài Công Cụ

Mở Terminal (Mac) hoặc Command Prompt (Windows), chạy lần lượt:

```bash
# Cài Supabase CLI
npm install -g supabase

# Cài Vercel CLI
npm install -g vercel
```

**✅ Kiểm tra thành công:**
```bash
supabase --version   # phải ra số phiên bản, ví dụ: 2.x.x
vercel --version     # phải ra số phiên bản, ví dụ: 53.x.x
```

---

## Bước 2 — Đăng Nhập

```bash
# Đăng nhập Supabase (sẽ mở browser)
supabase login

# Đăng nhập Vercel (sẽ mở browser)
vercel login
```

> Browser sẽ tự mở. Đăng nhập bằng tài khoản đã tạo ở bước Chuẩn Bị.  
> Sau khi xong, quay lại Terminal — sẽ thấy thông báo thành công.

---

## Bước 3 — Vào Thư Mục Project

```bash
cd đường/dẫn/đến/apps/customer-portal
```

> Ví dụ: `cd ~/Desktop/Vibe\ Code/AI\ Agent\ Business\ Kit/apps/customer-portal`

**✅ Kiểm tra đúng chỗ:**
```bash
ls    # phải thấy: App.tsx, package.json, setup.mjs, ...
```

---

## Bước 4 — Tạo Supabase Project

```bash
npm run setup:project
```

Script sẽ hỏi:
- **Tên project** (ví dụ: `customer-portal`)
- **Region**: nhập `1` để chọn Singapore (gần Việt Nam nhất)
- **DB Password**: tự sinh, không cần nhớ

⏳ Chờ ~2 phút để Supabase tạo xong database.

**✅ Kiểm tra thành công:** terminal in ra `Project ref: xxxxx`

---

## Bước 5 — Chạy Database Schema

```bash
npm run setup:db
```

Tự động:
- Tạo 16 bảng dữ liệu (students, quests, leads, payments, ...)
- Cài đặt bảo mật (RLS policies)
- Deploy webhook SePay

**✅ Kiểm tra thành công:** terminal in ra `Schema applied successfully`

---

## Bước 6 — Lấy API Keys

Vào [app.supabase.com](https://app.supabase.com) → chọn project vừa tạo → **Project Settings → API**

Copy 2 giá trị:
- **Project URL** (dạng `https://xxxxx.supabase.co`)
- **anon public** key (chuỗi dài bắt đầu bằng `eyJ...`)

---

## Bước 7 — Tạo File Cấu Hình

```bash
cp .env.example .env.local
```

Mở file `.env.local` bằng Notepad/TextEdit, điền vào:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> Paste đúng 2 giá trị đã copy ở Bước 6.

---

## Bước 8 — Seed Dữ Liệu Khóa Học

```bash
npm run seed
```

Tự động thêm vào database: 5 zones, 35 quests, các tasks và video.

**✅ Kiểm tra thành công:** terminal in ra `Quest 35: ... Done!`

---

## Bước 9 — Tạo Tài Khoản Admin

Vào [app.supabase.com](https://app.supabase.com) → project của bạn → **Authentication → Users → Add user**

Điền:
- **Email**: email của bạn (ví dụ: `admin@truong.com`)
- **Password**: mật khẩu (tối thiểu 8 ký tự)
- ✅ Tick **Auto Confirm User**
- Bấm **Create User**

Sau đó vào **Table Editor → profiles** → tìm user vừa tạo → đổi cột `role` từ `student` thành `admin` → bấm **Save**.

---

## Bước 10 — Deploy Lên Vercel

```bash
npm run setup:deploy
```

Script tự động:
- Build project
- Deploy lên Vercel
- Set các env vars
- In ra URL của portal

**✅ Kiểm tra thành công:** terminal in ra `https://your-portal.vercel.app`

---

## Kiểm Tra Cuối

Mở URL vừa nhận được:
1. **Trang học viên** (`/`) — màn hình login terminal xanh
2. **Trang admin** (`/admin`) — login bằng email admin → thấy Dashboard, Students, Leads Pipeline
3. Vào `/admin/deliver` → copy SePay webhook URL → cấu hình trong SePay dashboard

---

## Nếu Gặp Lỗi

| Lỗi | Nguyên nhân | Cách xử lý |
|-----|------------|-----------|
| `command not found: supabase` | Chưa cài CLI | Chạy lại Bước 1 |
| `not logged in` | Chưa đăng nhập | Chạy lại Bước 2 |
| `invalid API key` | Sai key | Kiểm tra lại `.env.local` |
| Schema error | DB chưa sẵn sàng | Chờ thêm 1-2 phút rồi thử lại |
| Build failed | Thiếu env vars | Kiểm tra file `.env.local` |

> Cần hỗ trợ? Chụp màn hình lỗi và gửi cho đội kỹ thuật.

---

## Tóm Tắt Nhanh (cho lần sau)

```bash
# Nếu đã có project Supabase, chỉ cần:
cp .env.example .env.local   # điền keys
npm run seed                 # seed data
npm run setup:deploy         # deploy Vercel
```
