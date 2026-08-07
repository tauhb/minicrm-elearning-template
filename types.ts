

export enum TaskType {
  MANDATORY = 'MANDATORY',
  OPTIONAL = 'OPTIONAL'
}

export enum NodeState {
  LOCKED = 'LOCKED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED'
}

export enum QuestType {
  NORMAL = 'NORMAL',
  CHECKPOINT = 'CHECKPOINT' // Zoom/Boss days
}

export interface Resource {
  title: string;
  url: string;
  type: 'PDF' | 'LINK' | 'TOOL' | 'TEXT'; // Added TEXT
}

export interface VideoResource {
  title: string;
  url: string; // Embed URL
  duration?: string;
  type: 'LESSON' | 'TUTORIAL' | 'ZOOM_RECORDING'; // Added ZOOM_RECORDING
  cohort?: string; // Optional: To display "ZOOM K1", "ZOOM K2"
}

export interface Task {
  id: string;
  text: string;
  type: TaskType;
}

export interface Submission {
  timestamp: string; // ISO String
  content: string;
}

export interface Quest {
  id: number; // Day number 1-33
  title: string;
  description: string;
  zoneId: number;
  type: QuestType;
  tasks: Task[];
  preparationTasks?: string[]; // For checkpoints

  // Updated for multiple videos
  videos?: VideoResource[];

  resources?: Resource[];
  submissionPlaceholder?: string; // Hint text for submission
}

export interface Zone {
  id: number;
  title: string;
  description: string;
  startDay: number;
  endDay: number;
  color: string;
}

export interface UserProgress {
  currentDay: number; // The day currently active (highest unlocked)
  completedQuests: number[]; // Array of completed quest IDs
  completedTasks: Record<number, string[]>; // Map of questID -> array of taskIDs
  watchedVideos: Record<number, number[]>; // Map of questID -> array of video indices that are watched
  submissions: Record<number, Submission[]>; // Map of questID -> array of submissions history

  // Gamification Fields
  streak: number;
  lastCompletedDate: string | null; // ISO Date YYYY-MM-DD
}

// --- LEADERBOARD TYPE ---
export interface LeaderboardEntry {
  rank: number;
  student_code: string;
  display_name: string;
  khoa: string; // Cohort
  total_xp: number;
  weekly_xp: number;
  week_id: string; // Format: YYYY-Www (e.g., 2024-W10)
  streak: number;
  is_current_user: boolean;
  avatar_color?: string; // UI helper
}

// --- SETTINGS TYPES ---
export interface GameSettings {
  [key: string]: any;
}

export type PortalTheme = 'cyberpunk' | 'aurora' | 'carbon' | 'paper' | 'solar'

export interface CourseSettings {
  title: string;
  description: string;
  primaryColor: string; // Hex code
  logoUrl?: string;
  guideVideoUrl?: string;
  supportZaloLink?: string;
  theme?: PortalTheme;
}

// --- SUPABASE PROFILE ---
export type CustomerRole = 'owner' | 'admin' | 'sales' | 'support' | 'student' | 'affiliate'
export type CustomerStatus = 'active' | 'deactivated'

export interface Customer {
  id: string
  email: string
  display_name: string
  role: CustomerRole
  status?: CustomerStatus                 // NEW (migration 015): soft-delete
  phone?: string | null                    // NEW (migration 015): backfilled from lead on convert
  // cohort, start_date đã được chuyển sang customer_courses (enrollment-based)
  payment_status: 'pending' | 'paid' | 'refunded'
  payment_ref: string | null
  tags: string[]
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PipelineStage {
  id: string
  name: string
  color: string
  order_index: number
  is_won: boolean
  is_lost: boolean
}

export interface Lead {
  id: string
  name: string
  email: string
  phone: string | null
  source: string | null
  utm_source: string | null
  utm_campaign: string | null
  utm_medium: string | null
  utm_term: string | null
  utm_content: string | null
  pipeline_stage_id: string | null
  pipeline_stage?: PipelineStage
  assigned_to: string | null
  score: number
  tags: string[]
  notes: string | null
  converted_at: string | null
  converted_to: string | null
  created_at: string
  updated_at: string
}

export interface LeadActivity {
  id: string
  lead_id: string
  type: 'note' | 'call' | 'email' | 'stage_change' | 'converted'
  content: string | null
  created_by: string | null
  created_at: string
  creator?: { display_name: string }
}

export type CareHistoryType = 'call' | 'zalo' | 'email' | 'meeting' | 'note' | 'follow_up'
export type CareHistoryResult = 'success' | 'no_answer' | 'interested' | 'not_interested' | 'purchased'
export type CareHistoryKind = 'care_log' | 'task'      // NEW (migration 015)
export type TaskStatus = 'open' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high'

/**
 * care_history serves 2 roles (kind field):
 *   - 'care_log' (default): past event, backward compat with pre-015 rows.
 *   - 'task': future scheduled action with due_at + status + optional assignment.
 * Fields marked "task-only" are only meaningful when kind='task'.
 */
export interface CareHistory {
  id: string
  lead_id: string | null
  customer_id: string | null
  order_id?: string | null                 // task-only: link to payments row
  type: CareHistoryType
  content: string | null
  result: CareHistoryResult | null
  next_follow_up_date: string | null       // legacy DATE-precision follow-up (care_log)
  created_by: string | null
  created_at: string
  creator?: { display_name: string }

  // ── kind='task' fields (all NULL for care_log rows) ─────────────────────
  kind?: CareHistoryKind
  title?: string | null                    // task title
  status?: TaskStatus                       // open | done | cancelled
  priority?: TaskPriority                   // low | medium | high
  due_at?: string | null                    // TIMESTAMPTZ
  completed_at?: string | null
  assigned_to?: string | null
}

/** Alias for callers thinking in "task" terms — same row, different lens.
 *  (Note: bare "Task" is taken by the gamification model in this file.) */
export type CrmTask = CareHistory

export interface AuditLogEntry {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string                            // e.g. 'lead.convert', 'user.role_change'
  target_type: string | null
  target_id: string | null
  changes: Record<string, any> | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

export interface Payment {
  id: string
  student_id: string | null
  lead_id: string | null
  product_id: string | null
  course_id: string | null
  enrollment_id: string | null
  amount: number
  currency: string
  status: 'pending' | 'completed' | 'refunded' | 'failed'
  gateway: string
  gateway_ref: string | null
  created_at: string
}

export interface DashboardStats {
  totalStudents: number
  activeToday: number
  totalRevenue: number
  avgCompletion: number
}

// Legacy Student interface — kept for backward compatibility with QuestView, LeaderboardView, sheetData
export interface Student {
  student_code: string;
  password?: string;
  display_name: string;
  start_date: string; // ISO Date YYYY-MM-DD
  khoa: string;
}

export interface Course {
  id: string
  slug: string
  title: string
  description: string | null
  duration_days: number
  price: number
  discount_price: number | null
  discount_from: string | null
  discount_to: string | null
  cover_image_url: string | null
  intro_video_url: string | null
  status: 'active' | 'draft' | 'archived'
  order_index: number
  created_at: string
  updated_at: string
}

export interface CustomerCourse {
  id: string
  customer_id: string
  course_id: string
  cohort: string | null
  start_date: string | null
  status: 'active' | 'completed' | 'paused'
  granted_by: string | null
  created_at: string
  course?: Course
  customer?: { id: string; email: string; display_name: string }
}

export const STORAGE_KEY = 'creators-journey-progress-v1';

// Backward compat alias
export type Profile = Customer

// --- DIGITAL PRODUCTS ---
export type ProductAccessType = 'public' | 'password' | 'course' | 'assigned'

export interface Product {
  id: string
  name: string
  type: string                  // 'ebook' | 'template' | 'toolkit' | 'video' | 'other'
  price: number
  description: string | null
  status: 'active' | 'draft'
  slug: string | null
  content_html: string | null
  cover_image_url: string | null
  access_type: ProductAccessType
  password: string | null
  course_id: string | null
  delivery_url: string | null
  created_at: string
}

export interface CustomerProduct {
  id: string
  customer_id: string
  product_id: string
  granted_at: string
  granted_by: string | null
  product?: Product
  customer?: { id: string; email: string; display_name: string }
}
