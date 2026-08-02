-- 1. COURSES table
CREATE TABLE IF NOT EXISTS courses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  duration_days   INT DEFAULT 35,
  price           INT DEFAULT 0,                   -- VND
  cover_image_url TEXT,
  intro_video_url TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  order_index     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ZONES.course_id  — zones giờ thuộc về 1 course
ALTER TABLE zones ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE CASCADE;

-- 3. CUSTOMER_COURSES — enrollment (nhiều course / khách)
CREATE TABLE IF NOT EXISTS customer_courses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
  cohort      TEXT,                              -- per-enrollment cohort, ví dụ K1, K2
  start_date  DATE,                              -- per-enrollment start date
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','completed','paused')),
  granted_by  UUID REFERENCES customers(id),     -- admin nào gán
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, course_id)
);

-- 4. USER_PROGRESS.enrollment_id — scope progress theo enrollment (optional)
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES customer_courses(id) ON DELETE CASCADE;

-- 5. Default course "MiniCRM Course" + gán tất cả zones cũ vào
INSERT INTO courses (slug, title, description, duration_days, status)
VALUES ('default', 'Khóa Học Mặc Định', 'Khóa học gốc khi migrate từ single-course', 35, 'active')
ON CONFLICT (slug) DO NOTHING;

-- Backfill: gán tất cả zones chưa có course_id vào default course
UPDATE zones SET course_id = (SELECT id FROM courses WHERE slug='default' LIMIT 1)
WHERE course_id IS NULL;

-- Backfill: enroll tất cả customers (role=student) hiện có vào default course
INSERT INTO customer_courses (customer_id, course_id, cohort, start_date, status)
SELECT c.id, (SELECT id FROM courses WHERE slug='default' LIMIT 1),
       c.cohort, c.start_date, 'active'
FROM customers c
WHERE c.role = 'student'
ON CONFLICT (customer_id, course_id) DO NOTHING;

-- 6. RLS policies
ALTER TABLE courses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_courses ENABLE ROW LEVEL SECURITY;

-- Public read courses (cho catalog)
CREATE POLICY "public_courses_read" ON courses FOR SELECT USING (true);
-- Admin manage courses
CREATE POLICY "admin_courses_write" ON courses FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin','sales')));

-- Customer xem enrollment của mình
CREATE POLICY "own_enrollments" ON customer_courses FOR SELECT
  USING (auth.uid() = customer_id);
-- Admin/sales manage tất cả
CREATE POLICY "admin_enrollments" ON customer_courses FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('admin','sales')));
