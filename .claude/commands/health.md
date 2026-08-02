# /portal health — Smoke Test Deployed Portal

Kiểm tra portal đã deploy có sống không, DB reachable không, các endpoint chính có response đúng không.

## Usage

```
/portal health                       # Uses CUSTOMER_PORTAL_URL from .env.local
/portal health https://my.vercel.app # Explicit URL
/portal health --verbose             # Full request/response dump
```

## Checks Performed

| Check | Endpoint | Expected |
|---|---|---|
| 1. Portal HTML loads | `GET /` | 200, `<title>` chứa app name |
| 2. Static assets | `GET /assets/index-*.js` | 200 |
| 3. Login page | `GET /login` | 200, có form |
| 4. Supabase reachable | `GET $VITE_SUPABASE_URL/rest/v1/` | 200 |
| 5. Public settings loadable | `GET $VITE_SUPABASE_URL/rest/v1/app_settings?select=title` | 200, có row |
| 6. API health endpoint | `GET /api/health` | 200, `{status: "ok"}` |
| 7. Env vars set on host | `vercel env ls` / `railway variables` | Có đủ 4 required vars |
| 8. Admin login endpoint | `POST /api/admin-create-customer` (dry-run) | 401 hoặc 405 (không phải 500) |

## Execution Steps

### 1. Determine URL

- Arg 1 nếu có → dùng
- Không có → đọc `CUSTOMER_PORTAL_URL` từ `.env.local`
- Không có → halt, hỏi user

### 2. Run Checks

```bash
node scripts/verify-deploy.mjs <url>
```

(Script này sẽ được tạo ở Day 3. Nếu chưa có, agent chạy checks thủ công bằng `curl`.)

### 3. Report

Format:
```
🩺 Portal Health Check — <url>

✓ Portal HTML loads          (200, "My Academy")
✓ Static assets              (200)
✓ Login page renders         (200)
✓ Supabase reachable         (200)
✓ App settings loadable      ({title: "My Academy", theme: "aurora"})
✓ API /health endpoint       ({status: "ok"})
✓ Env vars on Vercel         (4/4 required set)
⚠ Admin endpoint returns 500 (should be 401)

Overall: 7/8 PASSED
Action needed: Check server logs at Vercel dashboard for /api/admin-create-customer errors
```

### 4. Nếu Fail

Agent gợi ý fix theo error type:

| Fail | Likely cause | Fix |
|---|---|---|
| Portal HTML 404 | Deploy chưa xong hoặc URL sai | Check `vercel ls` / `railway status` |
| Portal HTML 500 | Runtime error | Check `vercel logs` / `railway logs` |
| Supabase 401 | Anon key sai | Verify `VITE_SUPABASE_ANON_KEY` |
| Supabase 404 | URL sai | Verify `VITE_SUPABASE_URL` |
| App settings empty | Migration chưa chạy hoặc seed chưa xong | `npm run setup:db && npm run seed` |
| Env vars missing | Chưa sync sau deploy | `npm run setup:deploy` chạy lại |
| /api/health 404 | Endpoint chưa được tạo | Endpoint đơn giản, agent có thể tạo `api/health.ts` |

## Health Endpoint Template

Nếu chưa có `api/health.ts`, agent tạo:

```typescript
// api/health.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev'
  })
}
```

## Safety

- **Read-only checks**: không mutate data
- **No auth data leaked**: không log full env vars, chỉ log "set/unset"
- **Timeout 5s per check**: tránh hang forever
