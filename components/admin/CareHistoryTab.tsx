import React, { useEffect, useState } from 'react'
import { Phone, MessageCircle, Mail, Users, FileText, Bell, Send, ChevronDown } from 'lucide-react'
import { fetchCareHistory, addCareHistory } from '../../services/api'
import { CareHistory, CareHistoryType, CareHistoryResult } from '../../types'
import { supabase } from '../../services/supabase'
import { formatDistanceToNow, format } from 'date-fns'
import { vi } from 'date-fns/locale'

interface Props {
  leadId?: string
  customerId?: string
}

const TYPE_CONFIG: Record<CareHistoryType, { label: string; icon: React.ReactNode; color: string }> = {
  call:      { label: 'Gọi điện',  icon: <Phone size={12} />,         color: '#22c55e' },
  zalo:      { label: 'Zalo',      icon: <MessageCircle size={12} />, color: '#3b82f6' },
  email:     { label: 'Email',     icon: <Mail size={12} />,          color: '#a855f7' },
  meeting:   { label: 'Gặp mặt',  icon: <Users size={12} />,         color: '#f59e0b' },
  note:      { label: 'Ghi chú',  icon: <FileText size={12} />,      color: '#6b7280' },
  follow_up: { label: 'Nhắc hẹn', icon: <Bell size={12} />,          color: '#ef4444' },
}

const RESULT_CONFIG: Record<string, { label: string; color: string }> = {
  success:        { label: 'Thành công',     color: 'text-emerald-400' },
  no_answer:      { label: 'Không bắt máy', color: 'text-gray-400' },
  interested:     { label: 'Quan tâm',      color: 'text-amber-400' },
  not_interested: { label: 'Từ chối',       color: 'text-red-400' },
  purchased:      { label: 'Đã mua',        color: 'text-indigo-400' },
}

const CareHistoryTab: React.FC<Props> = ({ leadId, customerId }) => {
  const [history, setHistory] = useState<CareHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<CareHistoryType>('call')
  const [content, setContent] = useState('')
  const [result, setResult] = useState<CareHistoryResult | ''>('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id || null))
  }, [])

  const load = async () => {
    setLoading(true)
    const data = await fetchCareHistory({ leadId, customerId })
    setHistory(data)
    setLoading(false)
  }
  useEffect(() => { load() }, [leadId, customerId])

  const handleSubmit = async () => {
    if (!content.trim() || !userId) return
    setSubmitting(true)
    await addCareHistory({
      lead_id: leadId,
      customer_id: customerId,
      type,
      content: content.trim(),
      result: result || undefined,
      next_follow_up_date: followUpDate || undefined,
      created_by: userId,
    })
    setContent('')
    setResult('')
    setFollowUpDate('')
    await load()
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      {/* Input form */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
        {/* Type selector */}
        <div className="flex gap-1.5 flex-wrap">
          {(Object.entries(TYPE_CONFIG) as [CareHistoryType, { label: string; icon: React.ReactNode; color: string }][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setType(key)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
              style={type === key
                ? { backgroundColor: cfg.color + '20', borderColor: cfg.color + '60', color: cfg.color }
                : { backgroundColor: 'transparent', borderColor: 'transparent', color: '#6b7280' }
              }
            >
              {cfg.icon}{cfg.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`Nội dung ${TYPE_CONFIG[type].label.toLowerCase()}...`}
          rows={2}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none"
        />

        {/* Result + Follow-up row */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <select
              value={result}
              onChange={e => setResult(e.target.value as CareHistoryResult | '')}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400 appearance-none focus:outline-none"
            >
              <option value="">Kết quả (tùy chọn)</option>
              {Object.entries(RESULT_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>
          <div className="flex-1">
            <input
              type="date"
              value={followUpDate}
              onChange={e => setFollowUpDate(e.target.value)}
              title="Ngày hẹn chăm sóc tiếp"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400 focus:outline-none"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className="px-3 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Send size={12} />{submitting ? '...' : 'Ghi'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : history.length === 0 ? (
        <p className="text-center text-gray-600 text-sm py-6">Chưa có lịch sử chăm sóc</p>
      ) : (
        <div className="space-y-2">
          {history.map(item => {
            const cfg = TYPE_CONFIG[item.type]
            const resultCfg = item.result ? RESULT_CONFIG[item.result] : null
            return (
              <div key={item.id} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: cfg.color + '20', color: cfg.color }}
                    >
                      {cfg.icon}{cfg.label}
                    </span>
                    {resultCfg && (
                      <span className={`text-xs ${resultCfg.color}`}>{resultCfg.label}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: vi })}
                  </span>
                </div>
                <p className="text-sm text-white/90">{item.content}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-gray-500">
                    {(item.creator as Record<string, unknown>)?.display_name as string || 'Hệ thống'}
                  </span>
                  {item.next_follow_up_date && (
                    <span className="text-[10px] text-amber-400 flex items-center gap-1">
                      <Bell size={9} />
                      Hẹn: {format(new Date(item.next_follow_up_date), 'dd/MM/yyyy')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default CareHistoryTab
