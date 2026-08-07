import { differenceInCalendarDays, getISOWeek, getYear } from 'date-fns'
import { supabase } from './supabase'
import { Zone, Quest, QuestType, UserProgress, LeaderboardEntry, Customer, Lead, PipelineStage, LeadActivity, Payment, DashboardStats, CourseSettings, CareHistory, CareHistoryType, CareHistoryResult, Course, CustomerCourse, Product, CustomerProduct } from '../types'

// --- HELPERS (identical to original sheetData.ts) ---

export const getWeekID = (date: Date = new Date()): string => {
  const year = getYear(date)
  const week = getISOWeek(date)
  return `${year}-W${week.toString().padStart(2, '0')}`
}

export const calculateXP = (progress: UserProgress): number => {
  let xp = 0
  // 500 XP per Quest
  xp += progress.completedQuests.length * 500

  // 50 XP per Task
  Object.values(progress.completedTasks).forEach(tasks => {
    xp += tasks.length * 50
  })

  // 20 XP per Video
  Object.values(progress.watchedVideos).forEach(videos => {
    xp += videos.length * 20
  })

  return xp
}

// Helper to convert Google Drive links to DIRECT STREAM LINKS for <video> tag
export const processGoogleDriveUrl = (url: string): string => {
  if (!url) return ''
  const trimmedUrl = url.trim()

  // If user pasted a full HTML iframe code instead of URL, try to extract src
  if (trimmedUrl.startsWith('<iframe') && trimmedUrl.includes('src="')) {
    const srcMatch = trimmedUrl.match(/src="([^"]+)"/)
    if (srcMatch && srcMatch[1]) return processGoogleDriveUrl(srcMatch[1])
  }

  if (trimmedUrl.includes('drive.google.com')) {
    // 1. Try to extract ID from standard URL path: /file/d/ID/...
    const pathMatch = trimmedUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (pathMatch && pathMatch[1]) {
      return `https://drive.google.com/uc?export=download&id=${pathMatch[1]}`
    }

    // 2. Try to extract ID from query parameter: ?id=ID
    const queryMatch = trimmedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (queryMatch && queryMatch[1]) {
      return `https://drive.google.com/uc?export=download&id=${queryMatch[1]}`
    }
  }

  return trimmedUrl
}

export const calculateMaxAllowedDay = (startDateStr: string): number => {
  try {
    let start: Date
    const parts = startDateStr.split('-')
    if (parts.length === 3) {
      start = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
    } else {
      start = new Date(startDateStr)
    }

    const today = new Date()
    const daysPassed = differenceInCalendarDays(today, start)
    return Math.max(1, daysPassed + 1)
  } catch (e) {
    console.error('Date calc error', e)
    return 1
  }
}

// --- AUTH ---

export const getCurrentProfile = async (): Promise<Customer | null> => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('customers').select('*').eq('id', user.id).single()
  return data
}

// --- COURSE DATA ---

export const fetchGameData = async (userId?: string | null, cohort?: string | null) => {
  // Lấy course IDs user đã enroll (nếu có userId)
  let courseFilter: string[] | null = null
  if (userId) {
    const { data: enrollments } = await supabase
      .from('customer_courses')
      .select('course_id')
      .eq('customer_id', userId)
      .eq('status', 'active')
    courseFilter = (enrollments || []).map((e: any) => e.course_id)
    // Nếu user không enroll course nào → trả empty
    if (courseFilter.length === 0) {
      return { zones: [], quests: [], settings: {} as CourseSettings }
    }
  }

  let zonesQuery = supabase.from('zones').select('*').order('order_index')
  if (courseFilter) zonesQuery = zonesQuery.in('course_id', courseFilter)

  const [zonesRes, questsRes, settingsRes] = await Promise.all([
    zonesQuery,
    supabase.from('quests').select(`*, tasks(*), videos(*), resources(*)`).order('order_index'),
    supabase.from('app_settings').select('*')
  ])

  const zones: Zone[] = (zonesRes.data || []).map((z: any) => ({
    id: z.id,
    title: z.title,
    description: z.description || '',
    startDay: z.start_day,
    endDay: z.end_day,
    color: z.color || 'text-white'
  }))

  const quests: Quest[] = (questsRes.data || []).map((q: any) => ({
    id: q.day_number,
    zoneId: q.zone_id,
    title: q.title,
    description: q.description || '',
    type: q.type as QuestType,
    submissionPlaceholder: q.submission_placeholder,
    tasks: (q.tasks || []).sort((a: any, b: any) => a.order_index - b.order_index).map((t: any) => ({
      id: t.id.toString(),
      text: t.label,
      type: t.is_mandatory ? 'MANDATORY' : 'OPTIONAL'
    })),
    videos: (q.videos || [])
      .filter((v: any) => !cohort || !v.cohort || v.cohort === cohort)
      .sort((a: any, b: any) => a.order_index - b.order_index)
      .map((v: any) => ({ title: v.title, url: v.url, type: 'LESSON' as const })),
    resources: (q.resources || []).sort((a: any, b: any) => a.order_index - b.order_index).map((r: any) => ({
      title: r.label,
      url: r.url || '',
      type: r.type.toUpperCase() as any
    }))
  })).sort((a: Quest, b: Quest) => a.id - b.id)

  const settingsMap: Record<string, any> = {}
  ;(settingsRes.data || []).forEach((row: any) => { settingsMap[row.key] = row.value })

  const settings: CourseSettings = {
    title: settingsMap['title']?.value || 'MiniCRM',
    description: settingsMap['description']?.value || '',
    primaryColor: settingsMap['primaryColor']?.value || '#B6FF00',
    logoUrl: settingsMap['logoUrl']?.value,
    guideVideoUrl: settingsMap['guideVideoUrl']?.value,
    supportZaloLink: settingsMap['supportZaloLink']?.value,
    theme: (settingsMap['theme']?.value as any) || undefined,
  }

  return { zones, quests, settings }
}

// --- PROGRESS ---

export const loadUserProgress = async (userId: string): Promise<Partial<UserProgress>> => {
  const [progressRes, tasksRes, submissionsRes, streakRes] = await Promise.all([
    supabase.from('user_progress').select('quest_id, xp_earned').eq('user_id', userId),
    supabase.from('task_completions').select('task_id, tasks(quest_id)').eq('user_id', userId),
    supabase.from('submissions').select('quest_id, content, submitted_at').eq('user_id', userId).order('submitted_at', { ascending: false }),
    supabase.from('user_streaks').select('*').eq('user_id', userId).single()
  ])

  const completedQuests = (progressRes.data || []).map((r: any) => r.quest_id)

  const completedTasks: Record<number, string[]> = {}
  ;(tasksRes.data || []).forEach((r: any) => {
    const qid = (r.tasks as any)?.quest_id
    if (qid) {
      if (!completedTasks[qid]) completedTasks[qid] = []
      completedTasks[qid].push(r.task_id.toString())
    }
  })

  const watchedVideos: Record<number, number[]> = {}

  const submissions: Record<number, Array<{ timestamp: string; content: string }>> = {}
  ;(submissionsRes.data || []).forEach((r: any) => {
    if (!submissions[r.quest_id]) submissions[r.quest_id] = []
    submissions[r.quest_id].push({ timestamp: r.submitted_at, content: r.content })
  })

  return {
    completedQuests,
    completedTasks,
    watchedVideos,
    submissions,
    streak: streakRes.data?.current_streak || 0,
    lastCompletedDate: streakRes.data?.last_activity_date || null,
    currentDay: completedQuests.length > 0 ? Math.max(...completedQuests) + 1 : 1
  }
}

export const upsertQuestProgress = async (userId: string, questId: number, xpEarned: number) => {
  await supabase.from('user_progress').upsert({ user_id: userId, quest_id: questId, xp_earned: xpEarned, completed_at: new Date().toISOString() })
}

export const upsertTaskCompletion = async (userId: string, taskId: string) => {
  await supabase.from('task_completions').upsert({ user_id: userId, task_id: taskId })
}

export const deleteTaskCompletion = async (userId: string, taskId: string) => {
  await supabase.from('task_completions').delete().eq('user_id', userId).eq('task_id', taskId)
}

export const upsertVideoView = async (userId: string, videoId: string) => {
  await supabase.from('video_views').upsert({ user_id: userId, video_id: videoId })
}

export const insertSubmission = async (userId: string, questId: number, content: string) => {
  await supabase.from('submissions').insert({ user_id: userId, quest_id: questId, content })
}

export const updateStreak = async (userId: string, streak: number, date: string) => {
  await supabase.from('user_streaks').upsert({
    user_id: userId,
    current_streak: streak,
    last_activity_date: date,
    updated_at: new Date().toISOString()
  })
}

// --- LEADERBOARD ---

export const fetchLeaderboard = async (_cohort?: string): Promise<LeaderboardEntry[]> => {
  // Cohort filter removed — cohort không còn ở `customers`. Trả về toàn bộ student;
  // nếu cần group by cohort, query qua `customer_courses` ở caller.
  const { data } = await supabase
    .from('customers')
    .select(`id, display_name, user_streaks(current_streak), user_progress(xp_earned)`)
    .eq('role', 'student')

  return (data || []).map((p: any) => {
    const total_xp = (p.user_progress || []).reduce((sum: number, r: any) => sum + (r.xp_earned || 0), 0)
    return {
      rank: 0,
      student_code: p.id,
      display_name: p.display_name,
      khoa: '',
      total_xp,
      weekly_xp: 0,
      week_id: getWeekID(),
      streak: p.user_streaks?.[0]?.current_streak || 0,
      is_current_user: false
    }
  }).sort((a, b) => b.total_xp - a.total_xp).map((e, i) => ({ ...e, rank: i + 1 }))
}

// --- COURSE ADMIN ---

export const saveCourseData = async (zones: Zone[], quests: Quest[], settings?: any) => {
  if (settings) {
    const settingRows = Object.entries(settings).map(([key, value]) => ({ key, value: { value } }))
    await supabase.from('app_settings').upsert(settingRows)
  }
}

// --- ADMIN - STUDENTS ---

export const fetchStudents = async (filters?: { search?: string; course_id?: string; product_id?: string }): Promise<Customer[]> => {
  let allowedIds: string[] | null = null

  if (filters?.course_id) {
    const { data } = await supabase.from('customer_courses').select('customer_id').eq('course_id', filters.course_id)
    const ids = (data || []).map((e: any) => e.customer_id)
    allowedIds = ids
  }

  if (filters?.product_id) {
    const { data } = await supabase.from('customer_products').select('customer_id').eq('product_id', filters.product_id)
    const ids = (data || []).map((e: any) => e.customer_id)
    allowedIds = allowedIds !== null
      ? allowedIds.filter(id => ids.includes(id))   // AND with course filter
      : ids
  }

  if (allowedIds !== null && allowedIds.length === 0) return []

  let q = supabase.from('customers').select('*').eq('role', 'student').order('created_at', { ascending: false })
  if (allowedIds !== null) q = q.in('id', allowedIds)
  if (filters?.search) q = q.ilike('display_name', `%${filters.search}%`)
  const { data } = await q
  return data || []
}

// Lấy enrollment hiện tại (active, mới nhất) của customer
export const fetchPrimaryEnrollment = async (customerId: string): Promise<CustomerCourse | null> => {
  const { data } = await supabase
    .from('customer_courses')
    .select('*, course:courses(*)')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

// Lấy distinct cohorts đã dùng trong 1 course (để gợi ý datalist)
export const fetchCohortsForCourse = async (courseId: string): Promise<string[]> => {
  const { data } = await supabase
    .from('customer_courses')
    .select('cohort')
    .eq('course_id', courseId)
    .not('cohort', 'is', null)
  const set = new Set<string>()
  ;(data || []).forEach((r: any) => { if (r.cohort) set.add(r.cohort) })
  return Array.from(set).sort()
}

export const updateProfile = async (id: string, updates: Partial<Customer>): Promise<void> => {
  await supabase.from('customers').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
}

// --- ADMIN - LEADS ---

export const fetchLeads = async (search?: string): Promise<Lead[]> => {
  let q = supabase
    .from('leads')
    .select(`*, pipeline_stage:pipeline_stages(*)`)
    .order('created_at', { ascending: false })
  if (search) {
    q = q.or(`email.ilike.%${search}%,name.ilike.%${search}%,phone.ilike.%${search}%`)
  }
  const { data } = await q
  return data || []
}

export const fetchPipelineStages = async (): Promise<PipelineStage[]> => {
  const { data } = await supabase.from('pipeline_stages').select('*').order('order_index')
  return data || []
}

export const createLead = async (lead: Partial<Lead>): Promise<Lead | null> => {
  const { data } = await supabase.from('leads').insert(lead).select().single()
  return data
}

export const updateLead = async (id: string, updates: Partial<Lead>): Promise<void> => {
  await supabase.from('leads').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
}

export const fetchLeadActivities = async (leadId: string): Promise<LeadActivity[]> => {
  const { data } = await supabase
    .from('lead_activities')
    .select(`*, creator:profiles(display_name)`)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  return data || []
}

export const addLeadActivity = async (leadId: string, type: LeadActivity['type'], content: string, createdBy: string): Promise<void> => {
  await supabase.from('lead_activities').insert({ lead_id: leadId, type, content, created_by: createdBy })
}

// --- ADMIN - PAYMENTS ---

export const fetchPayments = async (studentId?: string): Promise<Payment[]> => {
  let query = supabase.from('payments').select('*').order('created_at', { ascending: false })
  if (studentId) query = query.eq('student_id', studentId)
  const { data } = await query
  return data || []
}

export const fetchAllPayments = async (filters?: { status?: string; search?: string }): Promise<any[]> => {
  let query = supabase
    .from('payments')
    .select(`*, student:customers(display_name, email), course:courses(title, slug), product:products(name, slug)`)
    .order('created_at', { ascending: false })
  if (filters?.status) query = query.eq('status', filters.status)
  const { data } = await query
  let results = data || []
  if (filters?.search) {
    results = results.filter((p: any) =>
      p.student?.display_name?.toLowerCase().includes(filters.search!.toLowerCase()) ||
      p.student?.email?.toLowerCase().includes(filters.search!.toLowerCase()) ||
      p.gateway_ref?.toLowerCase().includes(filters.search!.toLowerCase())
    )
  }
  return results
}

export const createManualOrder = async (order: { student_id?: string; amount: number; course_id?: string; enrollment_id?: string; product_id?: string; gateway_ref?: string; order_note?: string }): Promise<void> => {
  await supabase.from('payments').insert({ ...order, gateway: 'manual', status: 'completed', currency: 'VND' })
}

// --- DASHBOARD ---

export const fetchDashboardStats = async (): Promise<DashboardStats> => {
  const today = new Date().toISOString().split('T')[0]
  const [studentsRes, activeTodayRes, revenueRes] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    supabase.from('user_progress').select('id', { count: 'exact', head: true }).gte('completed_at', today),
    supabase.from('payments').select('amount').eq('status', 'completed')
  ])
  const totalRevenue = (revenueRes.data || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  return {
    totalStudents: studentsRes.count || 0,
    activeToday: activeTodayRes.count || 0,
    totalRevenue,
    avgCompletion: 0
  }
}

export const fetchRecentActivity = async () => {
  const { data } = await supabase
    .from('user_progress')
    .select(`completed_at, quest_id, user:customers(display_name)`)
    .order('completed_at', { ascending: false })
    .limit(10)
  return data || []
}

// --- LỊCH SỬ CHĂM SÓC ---

export const fetchCareHistory = async (params: { leadId?: string; customerId?: string }): Promise<CareHistory[]> => {
  let query = supabase
    .from('care_history')
    .select(`*, creator:customers!care_history_created_by_fkey(display_name)`)
    .order('created_at', { ascending: false })
  if (params.leadId)     query = query.eq('lead_id', params.leadId)
  if (params.customerId) query = query.eq('customer_id', params.customerId)
  const { data } = await query
  return data || []
}

export const addCareHistory = async (entry: {
  lead_id?: string
  customer_id?: string
  type: CareHistoryType
  content: string
  result?: CareHistoryResult
  next_follow_up_date?: string
  created_by: string
}): Promise<void> => {
  await supabase.from('care_history').insert(entry)
}

export const fetchUpcomingFollowUps = async (): Promise<CareHistory[]> => {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('care_history')
    .select(`*, creator:customers!care_history_created_by_fkey(display_name)`)
    .gte('next_follow_up_date', today)
    .order('next_follow_up_date', { ascending: true })
    .limit(20)
  return data || []
}

// --- CRM TASKS (kind='task' rows in care_history) ---

async function authHeader(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Phiên đăng nhập đã hết hạn')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  }
}

export interface TaskFilters {
  status?: 'open' | 'done' | 'cancelled' | 'all'
  assignee?: string     // 'me' | user_id | 'unassigned'
  lead_id?: string
  customer_id?: string
  due_before?: string
  overdue?: boolean
}

export const fetchTasks = async (filters: TaskFilters = {}): Promise<CareHistory[]> => {
  const params = new URLSearchParams()
  if (filters.status)     params.set('status', filters.status)
  if (filters.assignee)   params.set('assignee', filters.assignee)
  if (filters.lead_id)    params.set('lead_id', filters.lead_id)
  if (filters.customer_id) params.set('customer_id', filters.customer_id)
  if (filters.due_before) params.set('due_before', filters.due_before)
  if (filters.overdue)    params.set('overdue', 'true')
  const res = await fetch(`/api/tasks?${params.toString()}`, { headers: await authHeader() })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Load tasks lỗi')
  return json.tasks || []
}

export interface CreateTaskInput {
  title: string
  description?: string
  due_at?: string | null
  priority?: 'low' | 'medium' | 'high'
  type?: CareHistoryType
  lead_id?: string | null
  customer_id?: string | null
  order_id?: string | null
  assigned_to?: string | null
}

export const createTask = async (input: CreateTaskInput): Promise<CareHistory> => {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Tạo task thất bại')
  return json.task
}

export const updateTask = async (id: string, patch: Partial<CreateTaskInput>): Promise<CareHistory> => {
  const res = await fetch(`/api/tasks?action=update&id=${id}`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(patch),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Update task thất bại')
  return json.task
}

export const completeTask = async (id: string): Promise<CareHistory> => {
  const res = await fetch(`/api/tasks?action=complete&id=${id}`, {
    method: 'POST',
    headers: await authHeader(),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Đánh dấu hoàn thành lỗi')
  return json.task
}

export const reopenTask = async (id: string): Promise<CareHistory> => {
  const res = await fetch(`/api/tasks?action=reopen&id=${id}`, {
    method: 'POST',
    headers: await authHeader(),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Mở lại task lỗi')
  return json.task
}

export const cancelTask = async (id: string): Promise<CareHistory> => {
  const res = await fetch(`/api/tasks?action=cancel&id=${id}`, {
    method: 'POST',
    headers: await authHeader(),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Huỷ task lỗi')
  return json.task
}

export const deleteTask = async (id: string): Promise<void> => {
  const res = await fetch(`/api/tasks?id=${id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Xoá task lỗi')
}

export interface AssignableUser {
  id: string
  display_name: string
  email: string
  role: string
}

export const fetchAssignableUsers = async (): Promise<AssignableUser[]> => {
  const { data } = await supabase
    .from('customers')
    .select('id, display_name, email, role')
    .in('role', ['owner', 'admin', 'sales', 'support'])
    .order('display_name', { ascending: true })
  return (data as AssignableUser[]) || []
}

// --- COURSES ---

export const fetchCourses = async (): Promise<Course[]> => {
  const { data } = await supabase
    .from('courses')
    .select('*')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: false })
  return data || []
}

export const fetchCourse = async (id: string): Promise<Course | null> => {
  const { data } = await supabase.from('courses').select('*').eq('id', id).maybeSingle()
  return data
}

export const createCourse = async (course: Partial<Course>): Promise<Course | null> => {
  const slug = course.slug || (course.title || 'untitled').toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 50) + '-' + Date.now().toString(36)
  const { data } = await supabase.from('courses').insert({
    ...course,
    slug,
    status: course.status || 'draft',
    duration_days: course.duration_days || 35,
    price: course.price || 0,
  }).select().single()
  return data
}

export const updateCourse = async (id: string, updates: Partial<Course>): Promise<void> => {
  await supabase.from('courses').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
}

export const deleteCourse = async (id: string): Promise<void> => {
  await supabase.from('courses').delete().eq('id', id)
}

// Count zones + quests + enrollments cho mỗi course (cho list view)
export const fetchCoursesWithStats = async () => {
  const [coursesRes, zonesRes, enrollmentsRes] = await Promise.all([
    supabase.from('courses').select('*').order('order_index').order('created_at', { ascending: false }),
    supabase.from('zones').select('id, course_id, quests(id)'),
    supabase.from('customer_courses').select('course_id'),
  ])
  const courses = coursesRes.data || []
  const zones = zonesRes.data || []
  const enrollments = enrollmentsRes.data || []
  return courses.map(c => {
    const courseZones = zones.filter((z: any) => z.course_id === c.id)
    const totalQuests = courseZones.reduce((sum: number, z: any) => sum + (z.quests?.length || 0), 0)
    const enrolled = enrollments.filter((e: any) => e.course_id === c.id).length
    return {
      ...c,
      zone_count: courseZones.length,
      quest_count: totalQuests,
      enrolled_count: enrolled,
    }
  })
}

// --- ENROLLMENTS ---

export const fetchEnrollmentsByCustomer = async (customerId: string): Promise<CustomerCourse[]> => {
  const { data } = await supabase
    .from('customer_courses')
    .select('*, course:courses(*)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  return data || []
}

export const fetchEnrollmentsByCourse = async (courseId: string): Promise<CustomerCourse[]> => {
  const { data } = await supabase
    .from('customer_courses')
    .select('*, customer:customers(id, email, display_name)')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
  return data || []
}

export const enrollCustomer = async (params: { customer_id: string; course_id: string; cohort?: string; start_date?: string }): Promise<void> => {
  await supabase.from('customer_courses').upsert(params, { onConflict: 'customer_id,course_id' })
}

export const unenrollCustomer = async (customer_id: string, course_id: string): Promise<void> => {
  await supabase.from('customer_courses').delete()
    .eq('customer_id', customer_id).eq('course_id', course_id)
}

// --- DIGITAL PRODUCTS ---
export const fetchProducts = async (): Promise<Product[]> => {
  const { data } = await supabase.from('products').select('*').eq('status', 'active').order('created_at', { ascending: false })
  return data || []
}

export const fetchProductBySlug = async (slug: string): Promise<Product | null> => {
  const { data } = await supabase.from('products').select('*').eq('slug', slug).maybeSingle()
  return data
}

export const fetchProductsAssignedTo = async (customerId: string): Promise<CustomerProduct[]> => {
  const { data } = await supabase
    .from('customer_products')
    .select('*, product:products(*)')
    .eq('customer_id', customerId)
    .order('granted_at', { ascending: false })
  return data || []
}

export const fetchCustomersForProduct = async (productId: string): Promise<CustomerProduct[]> => {
  const { data } = await supabase
    .from('customer_products')
    .select('*, customer:customers(id, email, display_name)')
    .eq('product_id', productId)
    .order('granted_at', { ascending: false })
  return data || []
}

export const grantProductToCustomer = async (customer_id: string, product_id: string, granted_by?: string) => {
  await supabase.from('customer_products').upsert({ customer_id, product_id, granted_by }, { onConflict: 'customer_id,product_id' })
}

export const revokeProductFromCustomer = async (customer_id: string, product_id: string) => {
  await supabase.from('customer_products').delete()
    .eq('customer_id', customer_id).eq('product_id', product_id)
}

// Check user có quyền truy cập product không (server-side check tốt hơn nhưng tạm thời check ở client)
export const checkProductAccess = async (product: Product, userId?: string | null): Promise<{ allowed: boolean; reason?: string }> => {
  if (product.access_type === 'public') return { allowed: true }

  if (product.access_type === 'password') {
    // Password check làm ở UI level
    return { allowed: false, reason: 'password_required' }
  }

  if (!userId) return { allowed: false, reason: 'login_required' }

  if (product.access_type === 'course' && product.course_id) {
    const { data } = await supabase
      .from('customer_courses')
      .select('id')
      .eq('customer_id', userId)
      .eq('course_id', product.course_id)
      .eq('status', 'active')
      .maybeSingle()
    if (data) return { allowed: true }
    return { allowed: false, reason: 'course_not_enrolled' }
  }

  if (product.access_type === 'assigned') {
    const { data } = await supabase
      .from('customer_products')
      .select('id')
      .eq('customer_id', userId)
      .eq('product_id', product.id)
      .maybeSingle()
    if (data) return { allowed: true }
    return { allowed: false, reason: 'not_assigned' }
  }

  return { allowed: false, reason: 'unknown' }
}

// ─── COURSE LAYOUT ─────────────────────────────────────────────────────────

export const fetchCourseLayout = async (courseId: string): Promise<'journey' | 'module'> => {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `course_layout_${courseId}`)
    .maybeSingle()
  return ((data?.value as any)?.mode as 'journey' | 'module') || 'journey'
}

export const saveCourseLayout = async (courseId: string, mode: 'journey' | 'module'): Promise<void> => {
  await supabase.from('app_settings').upsert([{
    key: `course_layout_${courseId}`,
    value: { mode },
  }])
}
