# /portal add-student — Tạo Student Account

Tạo student mới: Supabase Auth user + profile + enrollment + welcome email.

## Usage

```
/portal add-student
/portal add-student --email=student@x.com --name="Nguyễn Văn A" --course-slug=ai-marketing-101
/portal add-student --email=... --mode=magic-link   # Gửi magic link, không set password
/portal add-student --email=... --mode=password     # Set password random, gửi credentials qua email
```

## What Happens

1. Tạo user trong `auth.users` (Supabase Auth API)
2. Insert row vào `profiles` với `role='student'`
3. (Optional) Insert row vào `customer_courses` để enroll vào khóa cụ thể
4. Gửi welcome email qua Resend (nếu có `RESEND_API_KEY`)

## Execution Steps

### 1. Prompt User

- **Email** (required)
- **Tên** (name — required)
- **Mode**: `magic-link` (default, an toàn hơn) hoặc `password` (student login bằng email+password)
- **Course slug** (optional — enroll ngay vào khóa nào, hoặc để trống)
- **Phone** (optional)

Validate email format. Check user chưa tồn tại:
```bash
curl "$VITE_SUPABASE_URL/rest/v1/profiles?email=eq.<email>&select=id"
```
Nếu tồn tại → hỏi user có muốn re-send welcome email không.

### 2. Create Supabase Auth User

```bash
# Mode: password
curl -X POST "$VITE_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "student@x.com", "password": "<random-16-chars>", "email_confirm": true}'

# Mode: magic-link (no password)
curl -X POST "$VITE_SUPABASE_URL/auth/v1/admin/users" \
  -d '{"email": "student@x.com", "email_confirm": true}'
```

Save returned `user_id`.

### 3. Create Profile

```bash
curl -X POST "$VITE_SUPABASE_URL/rest/v1/profiles" \
  -d '{"id": "<user_id>", "email": "...", "name": "...", "role": "student", "phone": "..."}'
```

### 4. Enroll in Course (Optional)

Nếu user cung cấp `course-slug`:
```bash
# Get course_id from slug
COURSE_ID=$(curl "$VITE_SUPABASE_URL/rest/v1/courses?slug=eq.<slug>&select=id" | jq -r '.[0].id')

# Enroll
curl -X POST "$VITE_SUPABASE_URL/rest/v1/customer_courses" \
  -d '{"customer_id": "<user_id>", "course_id": "'$COURSE_ID'", "enrolled_at": "'$(date -u +%FT%TZ)'"}'
```

### 5. Send Welcome Email

Tuỳ mode:

**Magic link mode**: Portal tự gửi magic link qua Supabase Auth:
```bash
curl -X POST "$VITE_SUPABASE_URL/auth/v1/admin/generate_link" \
  -d '{"type": "magiclink", "email": "student@x.com"}'
```
Extract `action_link` và gửi qua Resend với template welcome.

**Password mode**: Gửi email với credentials:
```
Subject: Chào mừng bạn đến với {appName}

Xin chào {name},

Tài khoản của bạn đã được tạo:
Email: {email}
Password: {password}
Link đăng nhập: {portalUrl}

Vui lòng đổi password sau khi đăng nhập lần đầu.

Powered by Rainmaker.vn
```

Gọi qua Resend API:
```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -d '{"from": "onboarding@resend.dev", "to": "...", "subject": "...", "html": "..."}'
```

### 6. Report

```
✓ Student created:
  - Email: <email>
  - Name: <name>
  - User ID: <user_id>
  - Enrolled in: <course_slug>
  - Welcome email: sent to <email>
```

## Bulk Import

```
/portal add-student --from=students.csv
```

CSV format:
```
email,name,phone,course_slug,mode
a@x.com,Nguyễn A,0901,ai-marketing-101,magic-link
b@x.com,Trần B,,,password
```

Loop qua từng row, halt on first error nếu user muốn strict; hoặc continue+report errors nếu user muốn best-effort.

## Safety

- **Random password**: 16 chars, mixed case + digits + symbols. Show user 1 lần rồi discard (không lưu plain text).
- **Rate limit**: Nếu bulk import > 50 students, chunk 10/batch, sleep 1s giữa batch (tránh Supabase rate limit).
- **Rollback nếu email fail**: user đã tạo trong Auth rồi mà email fail → warn user, giữ account nhưng note "email chưa gửi được".
