# /portal rebrand — Change App Branding

Update app name, primary color, logo, theme without touching code or redeploying.

## Usage

```
/portal rebrand
/portal rebrand --name="My Academy" --color="#00D9FF" --theme=aurora
```

## What Gets Changed

All branding lives in Supabase `app_settings` table (single row). Portal loads settings at runtime via `ConfigContext` — hot-reloads without deploy.

Fields:
- `title` — App name (shows in header, emails)
- `primaryColor` — Hex color override for accent
- `logoUrl` — URL to logo image (nếu bỏ trống → dùng text title)
- `theme` — Chọn 1 trong: `cyberpunk`, `aurora`, `synthwave`, `minimal`, `zen`
- `description` — Meta description (SEO)
- `guideVideoUrl` — Video hướng dẫn hiện ở màn welcome
- `supportZaloLink` — Link Zalo support

## Execution Steps

### 1. Load Current Settings

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/app_settings?select=*" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```

Show user current values, hỏi họ muốn đổi field nào.

### 2. Prompt User

Nếu user không truyền flag, hỏi từng field. Skip field nào user không muốn đổi (giữ nguyên).

Validation:
- `primaryColor`: must match `^#[0-9A-Fa-f]{6}$`
- `theme`: must be one of 5 themes valid
- `logoUrl`: valid HTTPS URL nếu có
- `title`: 1-50 chars

### 3. Update via REST API

```bash
curl -X PATCH "$VITE_SUPABASE_URL/rest/v1/app_settings?id=eq.1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"title": "My Academy", "primaryColor": "#00D9FF", "theme": "aurora"}'
```

Only include fields user changed.

### 4. Verify

Fetch again, show user diff (before → after).

### 5. Instruct User

```
✓ Branding updated. Reload portal to see changes (no redeploy needed).
Portal URL: <CUSTOMER_PORTAL_URL>
```

## Nếu User Muốn Đổi Logo File (Không Chỉ URL)

Agent gợi ý 2 options:
1. Upload lên CDN của họ (Cloudinary, Imgur, S3), lấy URL, paste vào
2. Copy file vào `public/logo.png`, dùng URL `/logo.png` (relative), commit + redeploy

## Themes Available

| Theme | Vibe |
|---|---|
| `cyberpunk` | Neon green + dark bg (default) |
| `aurora` | Purple + teal gradient |
| `synthwave` | Pink + magenta 80s |
| `minimal` | Clean white + gray |
| `zen` | Warm neutrals + serif |

Sample tất cả themes: xem `themes.css`.

## Safety

- **NEVER** update settings với `service_role` key mà không confirm với user
- **KHÔNG xoá** field `title` (required, sẽ vỡ UI). Chỉ update, không set null.
