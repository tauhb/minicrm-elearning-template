-- 018_chat_canned_responses.sql
-- Canned responses (snippets) for chat reply composer.
--
-- Usage:
--   - Sales/support saves reusable message templates
--   - In chat reply box, typing "/" pops a dropdown; Enter inserts the body
--   - shortcut is optional; when present it becomes a "/slash" trigger
--
-- Row-level security:
--   - Admin/sales/support can read + write all rows
--   - No public / unauthenticated access

CREATE TABLE IF NOT EXISTS chat_canned_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,                                    -- Short label, e.g. "Chào hỏi"
  body TEXT NOT NULL,                                     -- Full message body
  shortcut TEXT UNIQUE,                                   -- Optional /slash trigger, e.g. "greet"
  created_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_canned_shortcut ON chat_canned_responses(shortcut);
CREATE INDEX IF NOT EXISTS idx_chat_canned_title ON chat_canned_responses(title);

ALTER TABLE chat_canned_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_canned_admin_read" ON chat_canned_responses;
CREATE POLICY "chat_canned_admin_read" ON chat_canned_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers
       WHERE id = auth.uid()
         AND role IN ('admin', 'sales', 'support')
    )
  );

DROP POLICY IF EXISTS "chat_canned_admin_write" ON chat_canned_responses;
CREATE POLICY "chat_canned_admin_write" ON chat_canned_responses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM customers
       WHERE id = auth.uid()
         AND role IN ('admin', 'sales', 'support')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers
       WHERE id = auth.uid()
         AND role IN ('admin', 'sales', 'support')
    )
  );

-- Seed a few defaults in Vietnamese (use "bạn/tôi" per project rules)
INSERT INTO chat_canned_responses (title, body, shortcut) VALUES
  (
    'Chào hỏi',
    'Xin chào bạn! Cảm ơn bạn đã liên hệ. Tôi có thể hỗ trợ gì cho bạn hôm nay?',
    'chao'
  ),
  (
    'Cảm ơn phản hồi',
    'Cảm ơn bạn đã phản hồi. Tôi sẽ kiểm tra và trả lời bạn trong ít phút nữa.',
    'thanks'
  ),
  (
    'Yêu cầu thông tin',
    'Để hỗ trợ tốt hơn, bạn vui lòng cho tôi biết: (1) email đã dùng đăng ký, (2) sản phẩm/khoá học đang quan tâm, và (3) vấn đề cụ thể đang gặp phải nhé.',
    'info'
  ),
  (
    'Đã xử lý',
    'Vấn đề của bạn đã được xử lý. Nếu bạn còn câu hỏi khác, cứ nhắn cho tôi bất cứ lúc nào nhé!',
    'done'
  )
ON CONFLICT (shortcut) DO NOTHING;
