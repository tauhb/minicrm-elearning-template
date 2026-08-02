-- D.1: Unify cohort/start_date as enrollment-only fields
-- Source of truth = customer_courses (per-enrollment), bỏ legacy customers.cohort + payments.cohort

-- 1. Thêm payments.course_id và payments.enrollment_id
ALTER TABLE payments ADD COLUMN IF NOT EXISTS course_id     UUID REFERENCES courses(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES customer_courses(id);

-- 2. Backfill: customers có legacy cohort/start_date nhưng chưa có enrollment → tạo enrollment vào default course
INSERT INTO customer_courses (customer_id, course_id, cohort, start_date, status)
SELECT c.id, (SELECT id FROM courses WHERE slug='default' LIMIT 1),
       c.cohort, c.start_date, 'active'
FROM customers c
WHERE (c.cohort IS NOT NULL OR c.start_date IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM customer_courses cc
    WHERE cc.customer_id = c.id
      AND cc.course_id = (SELECT id FROM courses WHERE slug='default' LIMIT 1)
  );

-- 3. Backfill payments.course_id: đơn cũ có cohort, chưa có product_id → mặc định trỏ về default course
UPDATE payments p
SET course_id = (SELECT id FROM courses WHERE slug='default' LIMIT 1)
WHERE p.course_id IS NULL AND p.product_id IS NULL AND p.cohort IS NOT NULL;

-- 4. Backfill payments.enrollment_id từ customer_courses tương ứng
UPDATE payments p
SET enrollment_id = (
  SELECT cc.id FROM customer_courses cc
  WHERE cc.customer_id = p.student_id AND cc.course_id = p.course_id
  LIMIT 1
)
WHERE p.enrollment_id IS NULL AND p.course_id IS NOT NULL AND p.student_id IS NOT NULL;

-- 5. DROP cột legacy — schema sạch, 1 nguồn dữ liệu duy nhất
ALTER TABLE customers DROP COLUMN IF EXISTS cohort;
ALTER TABLE customers DROP COLUMN IF EXISTS start_date;
ALTER TABLE payments  DROP COLUMN IF EXISTS cohort;
