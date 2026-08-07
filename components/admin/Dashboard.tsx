import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Users, Bell, DollarSign, Activity,
  Phone, FileText, Mail, AlertCircle,
  BarChart2, GitBranch, TrendingUp, TrendingDown, Minus,
  Square, ArrowRight,
  Sparkles, List, Upload, Rocket,
} from 'lucide-react'
import { fetchDashboardStats, fetchRecentActivity, completeTask } from '../../services/api'
import { DashboardStats } from '../../types'
import { formatDistanceToNow, format } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../services/supabase'
import OnboardingChecklist from './OnboardingChecklist'

// ─── Types ───────────────────────────────────────────────────────────────────

type TimeRange = '7d' | '30d' | '3m' | 'year'

interface FollowUp {
  id: string
  kind?: 'care_log' | 'task'
  title?: string | null
  status?: 'open' | 'done' | 'cancelled'
  priority?: 'low' | 'medium' | 'high'
  due_at?: string | null                // task-only (TIMESTAMPTZ)
  next_follow_up_date?: string | null   // care_log-only (DATE)
  type: string
  content: string
  lead?: { name: string; email: string; phone: string } | null
  customer?: { display_name: string; email: string } | null
}

interface PipelineStage {
  id: string
  name: string
  order_index: number
  is_won?: boolean
  is_lost?: boolean
}

interface SourceStat {
  label: string
  key: string
  count: number
  pct: number
}

interface Delta {
  current: number
  prev: number
  label: string
  higherIsBetter?: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: '7d',   label: '7 ngày'  },
  { value: '30d',  label: '30 ngày' },
  { value: '3m',   label: '3 tháng' },
  { value: 'year', label: 'Năm nay' },
]

const SOURCE_LABELS: Record<string, string> = {
  landing_page: 'Trang đích',
  facebook_ad:  'Quảng cáo FB',
  referral:     'Giới thiệu',
  organic:      'Tự nhiên',
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  call:  <Phone size={13} />,
  email: <Mail size={13} />,
  note:  <FileText size={13} />,
}

// ─── Date Bounds ─────────────────────────────────────────────────────────────

function getDateBounds(range: TimeRange) {
  const now = new Date()

  let periodStart: Date, prevStart: Date, prevEnd: Date, compLabel: string

  switch (range) {
    case '7d':
      periodStart = new Date(now.getTime() - 7  * 86400000)
      prevStart   = new Date(now.getTime() - 14 * 86400000)
      prevEnd     = periodStart
      compLabel   = '7 ngày trước'
      break
    case '30d':
      periodStart = new Date(now.getTime() - 30 * 86400000)
      prevStart   = new Date(now.getTime() - 60 * 86400000)
      prevEnd     = periodStart
      compLabel   = '30 ngày trước'
      break
    case '3m':
      periodStart = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
      prevStart   = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
      prevEnd     = periodStart
      compLabel   = '3 tháng trước'
      break
    case 'year':
      periodStart = new Date(now.getFullYear(), 0, 1)
      prevStart   = new Date(now.getFullYear() - 1, 0, 1)
      prevEnd     = new Date(now.getFullYear(), 0, 1)
      compLabel   = 'năm trước'
      break
  }

  return {
    current:     periodStart.toISOString(),
    prevStart:   prevStart.toISOString(),
    prevEnd:     prevEnd.toISOString(),
    compLabel,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtVNDShort = (n: number) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}tỷ`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}tr`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}k`
  return n.toString()
}

// ─── DeltaBadge ──────────────────────────────────────────────────────────────

const DeltaBadge: React.FC<{ delta: Delta }> = ({ delta }) => {
  const diff = delta.current - delta.prev
  const pct  = delta.prev > 0 ? Math.round(Math.abs(diff / delta.prev) * 100) : null

  if (diff === 0 || delta.prev === 0) {
    return (
      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
        <Minus size={11} />
        Không đổi so với {delta.label}
      </span>
    )
  }

  const positive = delta.higherIsBetter !== false ? diff > 0 : diff < 0
  const color    = positive ? '#34d399' : '#f87171'
  const Icon     = diff > 0 ? TrendingUp : TrendingDown
  const sign     = diff > 0 ? '+' : ''

  return (
    <span className="flex items-center gap-1 text-xs" style={{ color }}>
      <Icon size={11} />
      {sign}{diff}{pct !== null ? ` (${pct}%)` : ''} vs {delta.label}
    </span>
  )
}

// ─── KpiCard ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title:    string
  value:    string | number
  icon:     React.ElementType
  delta?:   Delta
  sub?:     React.ReactNode
  accent?:  boolean
  warn?:    boolean
  loading?: boolean
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon: Icon, delta, sub, accent, warn, loading }) => {
  const borderColor = accent ? 'rgba(var(--color-mission-accent-rgb,182,255,0),0.25)'
    : warn ? 'rgba(248,113,113,0.25)' : 'var(--theme-border)'
  const bg = accent ? 'rgba(var(--color-mission-accent-rgb,182,255,0),0.06)'
    : warn ? 'rgba(248,113,113,0.06)' : 'var(--theme-surface)'
  const valueColor = accent ? 'var(--color-mission-accent)' : warn ? '#f87171' : 'var(--theme-text)'
  const iconColor  = accent ? 'var(--color-mission-accent)' : warn ? '#f87171' : 'var(--theme-text-muted)'

  return (
    <div className="rounded-xl p-5 border flex flex-col gap-3" style={{ background: bg, borderColor }}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>{title}</span>
        <Icon size={14} style={{ color: iconColor }} />
      </div>
      {loading
        ? <div className="h-8 rounded animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />
        : <p className="text-2xl font-bold leading-none" style={{ color: valueColor }}>{value}</p>
      }
      <div className="min-h-[1.25rem]">
        {sub
          ? <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{sub}</span>
          : delta && !loading && <DeltaBadge delta={delta} />
        }
      </div>
    </div>
  )
}

// ─── TimeRangePicker ─────────────────────────────────────────────────────────

const TimeRangePicker: React.FC<{ value: TimeRange; onChange: (v: TimeRange) => void }> = ({ value, onChange }) => (
  <div className="flex items-center gap-1 p-1 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
    {TIME_OPTIONS.map(opt => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
        style={value === opt.value ? {
          background:   'var(--color-mission-accent)',
          color:        '#000',
        } : {
          background:   'transparent',
          color:        'var(--theme-text-muted)',
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
)

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const bounds = useMemo(() => getDateBounds(timeRange), [timeRange])

  const today = new Date().toISOString().split('T')[0]

  const [stats, setStats]       = useState<DashboardStats | null>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [coreLoading, setCoreLoading] = useState(true)

  const [followUps, setFollowUps]           = useState<FollowUp[]>([])
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([])
  const [stageCounts, setStageCounts]       = useState<Record<string, number>>({})
  const [sourcesStats, setSourcesStats]     = useState<SourceStat[]>([])
  const [widgetsLoading, setWidgetsLoading] = useState(true)

  // Period metrics
  const [newStudents, setNewStudents]           = useState(0)
  const [prevStudents, setPrevStudents]         = useState(0)
  const [totalLeads, setTotalLeads]             = useState(0)
  const [newLeads, setNewLeads]                 = useState(0)
  const [prevLeads, setPrevLeads]               = useState(0)
  const [periodRevenue, setPeriodRevenue]       = useState(0)
  const [prevRevenue, setPrevRevenue]           = useState(0)

  // Onboarding empty-state counts (Track D)
  const [teamCount, setTeamCount]     = useState<number | null>(null)
  const [funnelCount, setFunnelCount] = useState<number | null>(null)

  // ── Core stats (time-range-aware) ──
  useEffect(() => {
    setCoreLoading(true)
    Promise.all([fetchDashboardStats(), fetchRecentActivity()])
      .then(([s, a]) => { setStats(s); setActivity(a) })
      .finally(() => setCoreLoading(false))
  }, [])

  // ── Onboarding counts (Track D) ──
  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('id', { count: 'exact', head: true }).neq('role', 'student'),
      supabase.from('funnel_flows').select('id', { count: 'exact', head: true }),
    ]).then(([t, f]) => {
      setTeamCount(t.count ?? 0)
      setFunnelCount(f.count ?? 0)
    }).catch(() => { setTeamCount(0); setFunnelCount(0) })
  }, [])

  // ── Widgets (re-fetch when timeRange changes) ──
  useEffect(() => {
    const load = async () => {
      setWidgetsLoading(true)

      // Tasks lookahead: 7 days out, plus overdue + no-due-date
      const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString()

      const [
        openTasksRes, legacyFollowUpRes, stagesRes, pipelineLeadsRes,
        leadsSourceRes, totalLeadsRes,
        newStudRes, prevStudRes,
        newLeadsRes, prevLeadsRes,
        periodRevRes, prevRevRes,
      ] = await Promise.all([
        // NEW: open tasks (kind='task') due within 7 days OR without a due date
        supabase
          .from('care_history')
          .select('*, lead:leads(name,email,phone), customer:customers!care_history_customer_id_fkey(display_name,email)')
          .eq('kind', 'task')
          .eq('status', 'open')
          .or(`due_at.lte.${weekAhead},due_at.is.null`)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(10),

        // LEGACY: care_log rows with next_follow_up_date <= today (backward compat)
        supabase
          .from('care_history')
          .select('*, lead:leads(name,email,phone), customer:customers!care_history_customer_id_fkey(display_name,email)')
          .eq('kind', 'care_log')
          .lte('next_follow_up_date', today)
          .not('next_follow_up_date', 'is', null)
          .order('next_follow_up_date', { ascending: true })
          .limit(10),

        // Pipeline (always real-time)
        supabase.from('pipeline_stages').select('*').order('order_index'),
        supabase.from('leads').select('pipeline_stage_id'),

        // Source breakdown filtered by period
        supabase.from('leads').select('source,utm_source').gte('created_at', bounds.current),

        // Total leads (all time)
        supabase.from('leads').select('id', { count: 'exact', head: true }),

        // New students in current period
        supabase.from('customers').select('id', { count: 'exact', head: true })
          .eq('role', 'student').gte('created_at', bounds.current),

        // New students in previous period
        supabase.from('customers').select('id', { count: 'exact', head: true })
          .eq('role', 'student').gte('created_at', bounds.prevStart).lt('created_at', bounds.prevEnd),

        // New leads in current period
        supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', bounds.current),

        // New leads in previous period
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .gte('created_at', bounds.prevStart).lt('created_at', bounds.prevEnd),

        // Revenue in current period
        supabase.from('payments').select('amount')
          .eq('status', 'completed').gte('created_at', bounds.current),

        // Revenue in previous period
        supabase.from('payments').select('amount')
          .eq('status', 'completed').gte('created_at', bounds.prevStart).lt('created_at', bounds.prevEnd),
      ])

      // Merge tasks + legacy care_log follow-ups. Tasks come first (they own the future).
      const tasksData = (openTasksRes.data as FollowUp[]) ?? []
      const legacyData = (legacyFollowUpRes.data as FollowUp[]) ?? []
      setFollowUps([...tasksData, ...legacyData].slice(0, 15))

      const stagesData = (stagesRes.data as PipelineStage[]) ?? []
      setPipelineStages(stagesData)
      const counts: Record<string, number> = {}
      stagesData.forEach(s => { counts[s.id] = 0 })
      ;((pipelineLeadsRes.data ?? []) as { pipeline_stage_id: string | null }[]).forEach(l => {
        if (l.pipeline_stage_id) counts[l.pipeline_stage_id] = (counts[l.pipeline_stage_id] ?? 0) + 1
      })
      setStageCounts(counts)

      const leadsData = (leadsSourceRes.data ?? []) as { source: string | null; utm_source: string | null }[]
      const srcMap: Record<string, number> = {}
      leadsData.forEach(l => {
        const key = l.utm_source || l.source || 'unknown'
        srcMap[key] = (srcMap[key] ?? 0) + 1
      })
      const total = leadsData.length || 1
      setSourcesStats(
        Object.entries(srcMap)
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => ({
            key,
            label: SOURCE_LABELS[key] || key.replace(/_/g, ' '),
            count,
            pct: Math.round((count / total) * 100),
          }))
      )

      setTotalLeads(totalLeadsRes.count ?? 0)
      setNewStudents(newStudRes.count ?? 0)
      setPrevStudents(prevStudRes.count ?? 0)
      setNewLeads(newLeadsRes.count ?? 0)
      setPrevLeads(prevLeadsRes.count ?? 0)
      setPeriodRevenue(((periodRevRes.data ?? []) as { amount: number }[]).reduce((s, p) => s + (p.amount || 0), 0))
      setPrevRevenue(((prevRevRes.data ?? []) as { amount: number }[]).reduce((s, p) => s + (p.amount || 0), 0))

      setWidgetsLoading(false)
    }
    load()
  }, [timeRange])

  // Overdue = tasks past due_at OR legacy care_log with next_follow_up_date < today
  const nowIso = new Date().toISOString()
  const overdueCount = followUps.filter(f => {
    if (f.kind === 'task') return f.status === 'open' && f.due_at && f.due_at < nowIso
    return !!(f.next_follow_up_date && f.next_follow_up_date < today)
  }).length
  const pipelineTotal = Object.values(stageCounts).reduce((a, b) => a + b, 0)
  const maxStageCount = Math.max(...Object.values(stageCounts), 1)
  const loading       = coreLoading || widgetsLoading

  const dateLabel   = format(new Date(), "EEEE, dd/MM/yyyy", { locale: vi })
  const dateCapital = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)

  return (
    <div className="p-8 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--theme-text-muted)' }}>
            {dateCapital}
          </p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--theme-text)' }}>Tổng quan</h1>
        </div>
        <TimeRangePicker value={timeRange} onChange={setTimeRange} />
      </div>

      {/* ── Onboarding checklist (Track D) — self-hides when done or dismissed ── */}
      <OnboardingChecklist />

      {/* ── Welcome empty-state — only when truly empty (no leads/team/funnels) ── */}
      {teamCount === 0 && funnelCount === 0 && totalLeads === 0 && (
        <div className="mb-8 p-8 rounded-lg border" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-mission-accent)', color: '#000' }}>
              <Rocket className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--theme-text)' }}>Chào mừng anh/chị đến với CRM 🎉</h2>
              <p className="text-sm mb-4" style={{ color: 'var(--theme-text-muted)' }}>
                Chưa có dữ liệu — bắt đầu bằng cách tạo lead đầu tiên, tạo funnel AI, hoặc import CSV có sẵn.
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => navigate('/admin/leads')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded font-semibold" style={{ background: 'var(--color-mission-accent)', color: '#000' }}>
                  <List className="w-3.5 h-3.5" /> Nhập lead đầu tiên
                </button>
                <button onClick={() => navigate('/admin/ai-funnels')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border" style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}>
                  <Sparkles className="w-3.5 h-3.5" /> Tạo funnel với AI
                </button>
                <button onClick={() => navigate('/admin/leads#import')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border" style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}>
                  <Upload className="w-3.5 h-3.5" /> Import CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI row — 5 cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <KpiCard
          title="Học viên mới"
          value={loading ? '—' : newStudents}
          icon={Users}
          accent
          loading={loading}
          delta={{ current: newStudents, prev: prevStudents, label: bounds.compLabel }}
        />
        <KpiCard
          title="Leads mới"
          value={loading ? '—' : newLeads}
          icon={GitBranch}
          loading={loading}
          delta={{ current: newLeads, prev: prevLeads, label: bounds.compLabel }}
        />
        <KpiCard
          title="Nhắc hẹn"
          value={widgetsLoading ? '—' : followUps.length}
          icon={Bell}
          warn={overdueCount > 0}
          loading={widgetsLoading}
          sub={overdueCount > 0 ? `${overdueCount} quá hạn cần xử lý` : 'Tất cả đúng hạn'}
        />
        <KpiCard
          title="Trong phễu"
          value={widgetsLoading ? '—' : pipelineTotal}
          icon={BarChart2}
          loading={widgetsLoading}
          sub={`/ ${totalLeads} tổng leads`}
        />
        <KpiCard
          title="Doanh thu"
          value={loading ? '—' : fmtVNDShort(periodRevenue)}
          icon={DollarSign}
          loading={loading}
          delta={{ current: periodRevenue, prev: prevRevenue, label: bounds.compLabel }}
        />
      </div>

      {/* ── Cần làm hôm nay (always real-time, no time filter) ── */}
      {(widgetsLoading || followUps.length > 0) && (
        <div className="rounded-xl border mb-8 overflow-hidden" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
          <div className="flex items-center px-6 py-4 border-b gap-2.5" style={{ borderColor: 'var(--theme-border)' }}>
            {overdueCount > 0
              ? <AlertCircle size={15} className="text-red-400" />
              : <Bell size={15} style={{ color: 'var(--color-mission-accent)' }} />
            }
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text)' }}>
              Cần làm hôm nay
            </h2>
            {!widgetsLoading && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium"
                style={{
                  color:       overdueCount > 0 ? '#f87171' : 'var(--color-mission-accent)',
                  borderColor: overdueCount > 0 ? 'rgba(248,113,113,0.3)' : 'rgba(var(--color-mission-accent-rgb,182,255,0),0.3)',
                  background:  overdueCount > 0 ? 'rgba(248,113,113,0.08)' : 'rgba(var(--color-mission-accent-rgb,182,255,0),0.08)',
                }}
              >
                {followUps.length}
              </span>
            )}
            <span className="ml-auto text-xs" style={{ color: 'var(--theme-text-muted)' }}>Thời gian thực</span>
          </div>

          {widgetsLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />
              ))}
            </div>
          ) : (
            <>
              <div className="divide-y" style={{ borderColor: 'var(--theme-border)' }}>
                {followUps.map(item => {
                  const isTask = item.kind === 'task'
                  const isOverdue = isTask
                    ? !!(item.due_at && item.due_at < nowIso)
                    : !!(item.next_follow_up_date && item.next_follow_up_date < today)
                  const name  = item.lead?.name || item.customer?.display_name || item.lead?.email || item.customer?.email || 'Không xác định'
                  const phone = item.lead?.phone || ''
                  const primary = isTask
                    ? (item.title || item.content || '(Không có tiêu đề)')
                    : name
                  const secondary = isTask ? name : item.content

                  const dueLabel = isTask
                    ? (item.due_at ? format(new Date(item.due_at), 'dd/MM · HH:mm', { locale: vi }) : 'Không hạn')
                    : (isOverdue ? `Quá hạn ${item.next_follow_up_date}` : 'Hôm nay')

                  const handleComplete = async () => {
                    if (!isTask) return
                    try {
                      await completeTask(item.id)
                      setFollowUps(prev => prev.filter(f => f.id !== item.id))
                    } catch (e) { console.error(e) }
                  }

                  return (
                    <div key={item.id}
                      className="flex items-center gap-4 px-6 py-3.5 group transition-colors"
                      style={{ background: 'var(--theme-surface)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'var(--theme-surface)')}
                    >
                      {isTask ? (
                        <button
                          onClick={handleComplete}
                          className="shrink-0 transition-colors"
                          title="Đánh dấu hoàn thành"
                        >
                          <Square size={16} className="text-gray-500 hover:text-white" />
                        </button>
                      ) : (
                        <div className="w-8 h-8 rounded-lg border flex items-center justify-center shrink-0"
                          style={{ background: 'var(--theme-surface-2)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
                          {TYPE_ICON[item.type] ?? <FileText size={13} />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text)' }}>{primary}</p>
                        {secondary && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>{secondary}</p>}
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded border font-medium shrink-0"
                        style={{
                          color:       isOverdue ? '#f87171' : '#fbbf24',
                          borderColor: isOverdue ? 'rgba(248,113,113,0.3)' : 'rgba(251,191,36,0.3)',
                          background:  isOverdue ? 'rgba(248,113,113,0.08)' : 'rgba(251,191,36,0.08)',
                        }}>
                        {isOverdue && isTask ? `Quá hạn · ${dueLabel}` : dueLabel}
                      </span>
                      <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {phone && (
                          <a href={`tel:${phone}`}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border"
                            style={{ background: 'var(--theme-surface-3)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
                            <Phone size={11} />Gọi
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="px-6 py-3 border-t flex items-center justify-end" style={{ borderColor: 'var(--theme-border)' }}>
                <Link
                  to="/admin/tasks"
                  className="flex items-center gap-1 text-xs font-medium transition-colors"
                  style={{ color: 'var(--color-mission-accent)' }}
                >
                  Xem tất cả tasks<ArrowRight size={11} />
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Pipeline + Sources ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

        {/* Pipeline (real-time) */}
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <GitBranch size={14} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text)' }}>Phễu Leads</h2>
            </div>
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{pipelineTotal} leads · thời gian thực</span>
          </div>

          {widgetsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-8 rounded animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />)}
            </div>
          ) : pipelineStages.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--theme-text-muted)' }}>Chưa có giai đoạn phễu</p>
          ) : (
            <div className="space-y-3">
              {pipelineStages.map(stage => {
                const count = stageCounts[stage.id] ?? 0
                const pct   = Math.round((count / maxStageCount) * 100)
                const color = stage.is_won ? '#34d399' : stage.is_lost ? '#f87171' : 'var(--color-mission-accent)'
                const bgBar = stage.is_won  ? 'rgba(52,211,153,0.12)'
                  : stage.is_lost ? 'rgba(248,113,113,0.12)'
                  : 'rgba(var(--color-mission-accent-rgb,182,255,0),0.12)'
                return (
                  <div key={stage.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color }}>{stage.name}</span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--theme-text-muted)' }}>{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: bgBar }}>
                      <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Source breakdown (filtered by period) */}
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <BarChart2 size={14} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text)' }}>Nguồn Lead</h2>
            </div>
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              {TIME_OPTIONS.find(o => o.value === timeRange)?.label}
            </span>
          </div>

          {widgetsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-8 rounded animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />)}
            </div>
          ) : sourcesStats.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--theme-text-muted)' }}>Chưa có dữ liệu nguồn</p>
          ) : (
            <div className="space-y-3">
              {sourcesStats.map((src, i) => (
                <div key={src.key} className="flex items-center gap-3">
                  <span className="text-xs w-4 shrink-0 tabular-nums" style={{ color: 'var(--theme-text-muted)' }}>{i + 1}</span>
                  <span className="text-xs w-28 shrink-0 truncate" style={{ color: 'var(--theme-text)' }}>{src.label}</span>
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--theme-surface-2)' }}>
                    <div className="h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${src.pct}%`, background: 'var(--color-mission-accent)', opacity: 1 - i * 0.18 }} />
                  </div>
                  <span className="text-xs font-semibold w-6 text-right shrink-0 tabular-nums" style={{ color: 'var(--theme-text)' }}>{src.count}</span>
                  <span className="text-xs w-9 text-right shrink-0 tabular-nums" style={{ color: 'var(--theme-text-muted)' }}>{src.pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Hoạt động gần đây ── */}
      <div className="rounded-xl border p-6" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
        <div className="flex items-center gap-2 mb-5">
          <Activity size={14} style={{ color: 'var(--color-mission-accent)' }} />
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text)' }}>Hoạt động gần đây</h2>
        </div>
        {coreLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 rounded animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />)}
          </div>
        ) : activity.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: 'var(--theme-text-muted)' }}>Chưa có hoạt động</p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--theme-border)' }}>
            {activity.map((item, i) => {
              const name    = item.user?.display_name || 'Ẩn danh'
              const initial = name[0].toUpperCase()
              return (
                <div key={i} className="flex items-center gap-3 py-3">
                  <div className="w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{
                      background:  'rgba(var(--color-mission-accent-rgb,182,255,0),0.1)',
                      borderColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.25)',
                      color:       'var(--color-mission-accent)',
                    }}
                  >
                    {initial}
                  </div>
                  <p className="flex-1 text-sm" style={{ color: 'var(--theme-text)' }}>
                    <span className="font-medium">{name}</span>
                    <span style={{ color: 'var(--theme-text-muted)' }}> hoàn thành bài học</span>
                  </p>
                  <span className="text-xs shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                    {item.completed_at ? formatDistanceToNow(new Date(item.completed_at), { addSuffix: true, locale: vi }) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}

export default Dashboard
