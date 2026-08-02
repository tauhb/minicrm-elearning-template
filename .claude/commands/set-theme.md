# /portal set-theme — Chuyển Theme

Switch giữa 5 themes có sẵn. Wrapper của `/portal rebrand` chỉ đổi field `theme`.

## Usage

```
/portal set-theme                # Interactive picker
/portal set-theme cyberpunk
/portal set-theme aurora
/portal set-theme synthwave
/portal set-theme minimal
/portal set-theme zen
```

## 5 Themes Có Sẵn

| Theme | Vibe | Phù hợp |
|---|---|---|
| `cyberpunk` | Neon green + dark bg | Tech, gaming, coding courses (default) |
| `aurora` | Purple + teal gradient | Creative, design, marketing |
| `synthwave` | Pink + magenta 80s retro | Music, entertainment, personal brand |
| `minimal` | Clean white + gray | Business, finance, professional |
| `zen` | Warm neutrals + serif | Wellness, coaching, mindfulness |

Xem full CSS variables ở `themes.css`.

## Execution Steps

### 1. Get Current Theme

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/app_settings?select=theme" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

### 2. Prompt (nếu không có arg)

Show 5 themes với vibe/phù hợp, hỏi user chọn.

### 3. Validate

Theme phải là 1 trong 5 valid. Nếu user gõ tên khác → gợi ý closest match, không tự bịa.

### 4. Update

```bash
curl -X PATCH "$VITE_SUPABASE_URL/rest/v1/app_settings?id=eq.1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"theme": "aurora"}'
```

### 5. Report

```
✓ Theme changed: <old> → <new>
Reload portal to see changes (no redeploy needed).
Portal URL: <CUSTOMER_PORTAL_URL>
```

## Thêm Theme Mới (Advanced)

Nếu user muốn theme của riêng họ (không phải 5 mặc định):

1. Sửa `themes.css` — thêm block `[data-theme="myteam"] { --primary: ...; ... }`
2. Rebuild + redeploy portal
3. Update DB: `theme = "myteam"`

Agent gợi ý user dùng `/portal rebrand` với `--color` nếu chỉ cần đổi primary color mà không cần full new theme.
