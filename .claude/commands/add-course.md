# /portal add-course — Thêm Khóa Học Mới

Insert khóa học mới (zones, quests, tasks, videos, resources) vào Supabase mà không cần sửa `data.ts` hay re-seed.

## Usage

```
/portal add-course
/portal add-course --name="AI Marketing 101" --layout=journey
```

## Data Model

Cấu trúc phân cấp:
```
Course (bảng: courses)
  └─ Zone (bảng: zones) — 1 zone = 1 chương/tuần
      └─ Quest (bảng: quests) — 1 quest = 1 bài học/ngày
          ├─ Task (bảng: tasks) — checklist trong bài
          ├─ Video (bảng: videos) — video embed (YouTube/Vimeo)
          └─ Resource (bảng: resources) — link PDF, ebook, worksheet
```

## Execution Steps

### 1. Prompt User for Structure

Hỏi lần lượt:
- **Tên khóa** (course name)
- **Slug** (URL-friendly, agent auto-generate từ name nếu bỏ trống)
- **Mô tả ngắn** (description)
- **Layout mode**: `journey` (game map, unlock từng ngày) hoặc `module` (list dạng Udemy, xem tự do)
- **Số zones** (chương/tuần)
- **Với mỗi zone**: tên + số quests + tên mỗi quest
- **Với mỗi quest** (optional): tasks, video URL, resources

Nếu user muốn nhanh: agent gợi ý structure mẫu (5 zones × 5 quests) và user confirm/edit.

### 2. Create Course Row

```bash
curl -X POST "$VITE_SUPABASE_URL/rest/v1/courses" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"name": "AI Marketing 101", "slug": "ai-marketing-101", "layout_mode": "journey", "description": "..."}'
```

Save returned `course_id`.

### 3. Create Zones

Loop qua zones user cung cấp:
```bash
curl -X POST "$VITE_SUPABASE_URL/rest/v1/zones" \
  -d '{"course_id": "<course_id>", "name": "Tuần 1: Nền tảng", "order_index": 0}'
```

Save `zone_id` cho từng zone.

### 4. Create Quests

Loop qua quests trong mỗi zone:
```bash
curl -X POST "$VITE_SUPABASE_URL/rest/v1/quests" \
  -d '{"zone_id": "<zone_id>", "name": "Bài 1: Intro", "day_number": 1, "xp_reward": 100, "order_index": 0}'
```

### 5. Create Tasks / Videos / Resources (Optional)

Nếu user cung cấp:
```bash
# Task (checklist item)
POST /rest/v1/tasks { "quest_id": "...", "text": "Xem video intro", "order_index": 0 }

# Video (YouTube/Vimeo embed)
POST /rest/v1/videos { "quest_id": "...", "url": "https://youtu.be/xxx", "title": "..." }

# Resource
POST /rest/v1/resources { "quest_id": "...", "url": "https://...", "title": "Worksheet", "type": "pdf" }
```

### 6. Verify

Fetch course vừa tạo với đầy đủ zones/quests:
```bash
curl "$VITE_SUPABASE_URL/rest/v1/courses?id=eq.<course_id>&select=*,zones(*,quests(*,tasks(*),videos(*),resources(*)))"
```

Show user tree structure để confirm.

### 7. Optional: Auto-Enroll Students

Hỏi user: "Enroll students hiện có vào khóa này không?"
- Yes → insert `customer_courses` cho từng student
- No → skip, user sẽ enroll thủ công qua admin UI

### 8. Report

```
✓ Course created: <course_id>
  - <zones_count> zones
  - <quests_count> quests
  - <tasks_count> tasks

View course: <portal_url>/admin/courses/<course_id>
Or student view: <portal_url>/course/<slug>
```

## Bulk Import (Advanced)

Nếu user có file JSON/CSV với structure course:
```
/portal add-course --from=course.json
```

Agent parse file, validate, insert tất cả 1 lần. Format `course.json`:
```json
{
  "name": "...",
  "slug": "...",
  "layout_mode": "journey",
  "zones": [
    {
      "name": "Tuần 1",
      "quests": [
        {
          "name": "Bài 1",
          "day_number": 1,
          "tasks": ["Xem video", "Làm bài tập"],
          "videos": [{"url": "https://...", "title": "..."}]
        }
      ]
    }
  ]
}
```

## Safety

- **Verify course_id** tồn tại trước khi insert zones (tránh orphan rows)
- **Rollback nếu fail giữa chừng**: nếu insert zones fail, delete course vừa tạo
- **Không duplicate slug**: check trước khi insert (`courses?slug=eq.<slug>`)
