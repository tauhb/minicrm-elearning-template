# /portal deploy — Deploy Portal End-to-End

Full pipeline: check env → provision DB → seed → deploy → smoke test.

## Usage

```
/portal deploy                  # Default target: Vercel
/portal deploy --target=railway # Deploy to Railway
/portal deploy --skip-seed      # Skip demo data seeding (nếu đã seed rồi)
```

## Execution Steps

Agent MUST follow in order. Halt on any failure and report to user.

### 1. Pre-flight Check

Verify tools installed. If missing, guide user to install:
```bash
node -v          # >= 20
npm -v           # >= 10
vercel --version # if target=vercel
railway --version # if target=railway
supabase --version # for DB migrations
```

### 2. Verify `.env.local`

Read `.env.schema.json`. For each `required: true` var:
- If missing in `.env.local` → prompt user với `description` + `where_to_find` + `example`
- If value doesn't match `pattern` (regex) → warn and re-prompt
- Auto-generate `WEBHOOK_SECRET` nếu bỏ trống (32 random chars)

Write final `.env.local` (do NOT commit).

### 3. Verify Supabase

```bash
# Ping REST API
curl -s "$VITE_SUPABASE_URL/rest/v1/" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```
Response should be `{}` or JSON. If 401/404 → keys sai, halt.

### 4. Provision Database

```bash
npm run setup:db
```

This runs `setup.mjs db` which:
- Copies `database/schema.sql` → `supabase/migrations/`
- Runs `supabase db push`

If Supabase CLI chưa login: `supabase login` (interactive, user tự làm — agent báo instruction).

### 5. Seed Demo Data

```bash
npm run seed
```

Seeds 5 zones + 35 quests từ `data.ts`. Skip if `--skip-seed` flag.

### 6. Create Admin

```bash
npm run setup:admin
```

Tạo user Supabase Auth với email `VITE_ADMIN_EMAIL` và random password. Set `profiles.role = 'admin'`. In ra password cho user copy.

### 7. Build Check

```bash
npm run build
```

Fail sớm nếu code lỗi. Halt on build error.

### 8. Deploy

**If target=vercel:**
```bash
npm run setup:deploy
```
Requires `vercel login` done beforehand. Setup script sync all env vars to Vercel production.

**If target=railway:**
```bash
# Check railway.json exists (Day 3 will add)
railway login          # if not logged in
railway link           # link to project (or create new)
railway up             # deploy
# Sync env vars:
for var in $(grep -v '^#' .env.local | cut -d= -f1); do
  railway variables set "$var=$(grep ^$var= .env.local | cut -d= -f2-)"
done
```

Capture deploy URL from output.

### 9. Smoke Test

```bash
node scripts/verify-deploy.mjs <deploy-url>
```

Checks:
- URL responds 200
- `/api/health` endpoint alive
- Login page renders
- Supabase connection works

(Script sẽ tạo ở Day 3. Nếu chưa có, agent skip step này và cảnh báo.)

### 10. Report to User

Print:
```
✓ Portal deployed: <deploy-url>
✓ Admin login: <deploy-url>/admin
✓ Admin email: <VITE_ADMIN_EMAIL>
✓ Admin password: <generated>

Next steps:
1. Login at admin URL
2. Course Builder → tạo/edit khóa học
3. Rebrand: /portal rebrand
4. Add student: /portal add-student
```

## Common Failures

| Error | Fix |
|---|---|
| `vercel: command not found` | `npm i -g vercel` |
| `Supabase CLI not logged in` | `supabase login` (browser interactive) |
| `Build failed` | Check `npm run lint` (typescript errors) |
| `Env var missing on Vercel` | Manually add via `vercel env add <NAME> production` |
| `RLS policy denied` | User đã disable RLS trong Supabase Dashboard? Migrations cần chạy đầy đủ |

## Safety

- **NEVER** commit `.env.local` — check `.gitignore` includes it
- **NEVER** run `supabase db reset` on production DB without user confirm
- **Ask user** before destructive actions (delete data, drop tables)
