-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin', 'sales')),
  cohort TEXT,
  start_date DATE,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded')),
  payment_ref TEXT,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  order_index INT NOT NULL,
  start_day INT NOT NULL DEFAULT 1,
  end_day INT NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quests (
  id SERIAL PRIMARY KEY,
  zone_id INT REFERENCES zones(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'NORMAL' CHECK (type IN ('NORMAL', 'CHECKPOINT')),
  submission_placeholder TEXT,
  order_index INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  quest_id INT REFERENCES quests(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_mandatory BOOLEAN DEFAULT true,
  order_index INT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  quest_id INT REFERENCES quests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  cohort TEXT,
  order_index INT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  quest_id INT REFERENCES quests(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'link', 'tool', 'text')),
  label TEXT NOT NULL,
  url TEXT,
  content TEXT,
  order_index INT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  quest_id INT REFERENCES quests(id),
  completed_at TIMESTAMPTZ,
  xp_earned INT DEFAULT 0,
  UNIQUE(user_id, quest_id)
);

CREATE TABLE IF NOT EXISTS task_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_id INT REFERENCES tasks(id),
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, task_id)
);

CREATE TABLE IF NOT EXISTS video_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  video_id INT REFERENCES videos(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  quest_id INT REFERENCES quests(id),
  content TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_streaks (
  user_id UUID REFERENCES profiles(id) PRIMARY KEY,
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_activity_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INT NOT NULL,
  is_won BOOLEAN DEFAULT false,
  is_lost BOOLEAN DEFAULT false
);

INSERT INTO pipeline_stages (name, color, order_index) VALUES
  ('New Lead', '#6366f1', 0),
  ('Contacted', '#f59e0b', 1),
  ('Demo Booked', '#3b82f6', 2),
  ('Proposal Sent', '#8b5cf6', 3),
  ('Won', '#10b981', 4),
  ('Lost', '#ef4444', 5)
ON CONFLICT DO NOTHING;

UPDATE pipeline_stages SET is_won = true WHERE name = 'Won';
UPDATE pipeline_stages SET is_lost = true WHERE name = 'Lost';

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  source TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  pipeline_stage_id UUID REFERENCES pipeline_stages(id),
  assigned_to UUID REFERENCES profiles(id),
  score INT DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  converted_at TIMESTAMPTZ,
  converted_to UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'call', 'email', 'stage_change', 'converted')),
  content TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES profiles(id),
  lead_id UUID REFERENCES leads(id),
  amount INT NOT NULL,
  currency TEXT DEFAULT 'VND',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  gateway TEXT DEFAULT 'sepay',
  gateway_ref TEXT,
  gateway_payload JSONB,
  cohort TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Students see own data
CREATE POLICY "own_profile" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_progress" ON user_progress FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_tasks" ON task_completions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_videos" ON video_views FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_submissions" ON submissions FOR ALL USING (auth.uid() = user_id);

-- Public read for leaderboard-adjacent data
CREATE POLICY "public_read_profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "public_read_progress" ON user_progress FOR SELECT USING (true);

-- Admin/sales can manage leads
CREATE POLICY "admin_leads" ON leads FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'sales')));

-- Public read for course content
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_zones" ON zones FOR SELECT USING (true);
CREATE POLICY "public_quests" ON quests FOR SELECT USING (true);
CREATE POLICY "public_tasks" ON tasks FOR SELECT USING (true);
CREATE POLICY "public_videos" ON videos FOR SELECT USING (true);
CREATE POLICY "public_resources" ON resources FOR SELECT USING (true);
CREATE POLICY "public_settings" ON app_settings FOR SELECT USING (true);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
