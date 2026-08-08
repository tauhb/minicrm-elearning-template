import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, Circle, Settings2, Users, Package,
  Sparkles, List, MessageCircle, X, ChevronRight, Rocket,
} from 'lucide-react'
import { supabase } from '../../services/supabase'

const DISMISS_KEY = 'onboarding_dismissed'

interface EnvCheckResponse {
  ok: boolean
  items: Array<{
    key: string
    label: string
    category: string
    present: boolean
    optional?: boolean
    hint?: string
  }>
}

interface ChecklistItem {
  id: string
  icon: React.ElementType
  label: string
  hint: string
  done: boolean
  onClick: () => void
}

interface Props {
  onCountChange?: (done: number, total: number) => void
}

const OnboardingChecklist: React.FC<Props> = ({ onCountChange }) => {
  const navigate = useNavigate()
  const [envOk, setEnvOk] = useState<boolean | null>(null)
  const [envMissing, setEnvMissing] = useState<number>(0)
  const [productsCount, setProductsCount] = useState(0)
  const [leadsCount, setLeadsCount] = useState(0)
  const [teamCount, setTeamCount] = useState(0)
  const [funnelsCount, setFunnelsCount] = useState(0)
  const [inboxesCount, setInboxesCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<boolean>(() =>
    typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === 'true'
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      // Products = courses + products (both tables count as "có sản phẩm để bán").
      const [envRes, productsRes, coursesRes, leadsRes, teamRes, funnelsRes, inboxesRes] = await Promise.all([
        token
          ? fetch('/api/health/env-check', { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.ok ? r.json() as Promise<EnvCheckResponse> : null)
              .catch(() => null)
          : Promise.resolve(null),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('courses').select('id', { count: 'exact', head: true }),
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true }).neq('role', 'student'),
        supabase.from('funnel_flows').select('id', { count: 'exact', head: true }),
        supabase.from('chat_inboxes').select('id', { count: 'exact', head: true }),
      ])

      if (envRes) {
        setEnvOk(envRes.ok)
        setEnvMissing(envRes.items.filter(i => !i.optional && !i.present).length)
      } else {
        setEnvOk(null)
        setEnvMissing(0)
      }
      setProductsCount((productsRes.count ?? 0) + (coursesRes.count ?? 0))
      setLeadsCount(leadsRes.count ?? 0)
      setTeamCount(teamRes.count ?? 0)
      setFunnelsCount(funnelsRes.count ?? 0)
      setInboxesCount(inboxesRes.count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!dismissed) load()
  }, [dismissed, load])

  const openSettingsHealth = () => {
    // SettingsView reads location.hash to switch to health tab
    window.location.hash = 'health'
    navigate('/admin/settings')
    // Ensure hash triggers a re-check inside SettingsView even if already there
    setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 20)
  }

  const items: ChecklistItem[] = [
    {
      id: 'env',
      icon: Settings2,
      label: 'Cấu hình biến môi trường',
      hint: envOk === null
        ? 'Đang kiểm tra…'
        : envOk
          ? 'Tất cả biến bắt buộc đã có.'
          : `${envMissing} biến bắt buộc còn thiếu — mở Cài đặt → Health check.`,
      done: envOk === true,
      onClick: openSettingsHealth,
    },
    {
      id: 'team',
      icon: Users,
      label: 'Mời thành viên team đầu tiên',
      hint: teamCount > 0 ? `${teamCount} thành viên team.` : 'Thêm sales/admin/staff để cùng vận hành CRM.',
      done: teamCount > 0,
      onClick: () => navigate('/admin/settings'),
    },
    {
      id: 'product',
      icon: Package,
      label: 'Tạo sản phẩm đầu tiên',
      hint: productsCount > 0 ? `${productsCount} sản phẩm.` : 'Tạo sản phẩm đầu tiên (khoá học / ebook / template / membership...) để có thứ bán.',
      done: productsCount > 0,
      onClick: () => navigate('/admin/products'),
    },
    {
      id: 'funnel',
      icon: Sparkles,
      label: 'Tạo funnel đầu tiên (AI)',
      hint: funnelsCount > 0 ? `${funnelsCount} funnel.` : 'Dùng AI Funnels để dựng landing page trong vài phút.',
      done: funnelsCount > 0,
      onClick: () => navigate('/admin/ai-funnels'),
    },
    {
      id: 'lead',
      icon: List,
      label: 'Nhập lead đầu tiên',
      hint: leadsCount > 0 ? `${leadsCount} leads.` : 'Nhập tay 1 lead thử hoặc import CSV để test pipeline.',
      done: leadsCount > 0,
      onClick: () => navigate('/admin/leads'),
    },
    {
      id: 'chat',
      icon: MessageCircle,
      label: 'Cài chat widget',
      hint: inboxesCount > 0 ? `${inboxesCount} inbox.` : 'Nhúng chat vào website để bắt hội thoại real-time.',
      done: inboxesCount > 0,
      onClick: () => navigate('/admin/chat'),
    },
  ]

  const doneCount = items.filter(i => i.done).length
  const total = items.length

  useEffect(() => {
    onCountChange?.(doneCount, total)
  }, [doneCount, total, onCountChange])

  // Auto-dismiss when all done
  useEffect(() => {
    if (!loading && envOk !== null && doneCount === total && !dismissed) {
      localStorage.setItem(DISMISS_KEY, 'true')
      setDismissed(true)
    }
  }, [loading, envOk, doneCount, total, dismissed])

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  if (dismissed) return null

  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  return (
    <div
      className="rounded-xl border p-6 mb-6"
      style={{
        borderColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.3)',
        background: 'linear-gradient(135deg, rgba(var(--color-mission-accent-rgb,182,255,0),0.05) 0%, var(--theme-surface) 100%)',
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.15)' }}
          >
            <Rocket size={18} style={{ color: 'var(--color-mission-accent)' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text)' }}>
              Bắt đầu với CRM
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
              Hoàn thành các bước sau để kích hoạt toàn bộ tính năng
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>Tiến độ</p>
            <p className="text-sm font-bold" style={{ color: 'var(--color-mission-accent)' }}>
              {doneCount}/{total}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            title="Ẩn checklist"
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--theme-text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full mb-5" style={{ background: 'var(--theme-surface-2)' }}>
        <div
          className="h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: 'var(--color-mission-accent)' }}
        />
      </div>

      {/* Checklist grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={item.onClick}
              className="flex items-start gap-3 p-3 rounded-lg border text-left transition-all group"
              style={{
                borderColor: item.done ? 'rgba(52,211,153,0.25)' : 'var(--theme-border)',
                background: item.done ? 'rgba(52,211,153,0.05)' : 'var(--theme-surface)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = item.done ? 'rgba(52,211,153,0.08)' : 'var(--theme-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = item.done ? 'rgba(52,211,153,0.05)' : 'var(--theme-surface)')}
            >
              <div className="mt-0.5 shrink-0">
                {item.done
                  ? <CheckCircle2 size={16} style={{ color: '#34d399' }} />
                  : <Circle size={16} style={{ color: '#fbbf24' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon size={12} style={{ color: item.done ? '#34d399' : 'var(--theme-text-muted)' }} />
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text)' }}>
                    {item.label}
                  </p>
                </div>
                <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--theme-text-muted)' }}>
                  {item.hint}
                </p>
              </div>
              <ChevronRight
                size={14}
                className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0 mt-1"
                style={{ color: 'var(--theme-text-muted)' }}
              />
            </button>
          )
        })}
      </div>

      {loading && (
        <p className="text-xs mt-3 text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Đang kiểm tra tiến độ…
        </p>
      )}
    </div>
  )
}

export default OnboardingChecklist
