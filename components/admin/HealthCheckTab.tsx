import React, { useEffect, useState, useCallback } from 'react'
import { Activity, CheckCircle2, XCircle, Minus, RefreshCw, Zap, Info } from 'lucide-react'
import { supabase } from '../../services/supabase'

interface HealthItem {
  key: string
  label: string
  category: 'core' | 'ai' | 'email' | 'payment' | 'portal'
  present: boolean
  optional?: boolean
  hint?: string
  meta?: Record<string, any>
}

interface HealthResponse {
  ok: boolean
  timestamp: string
  items: HealthItem[]
}

const CATEGORY_LABEL: Record<string, string> = {
  core: 'Core (bắt buộc)',
  ai: 'AI',
  email: 'Email',
  payment: 'Payment',
  portal: 'Customer Portal',
}

const CATEGORY_ORDER: HealthItem['category'][] = ['core', 'ai', 'email', 'payment', 'portal']

const HealthCheckTab: React.FC = () => {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Chưa đăng nhập.')
      const res = await fetch('/api/health/env-check', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json as HealthResponse)
    } catch (e: any) {
      setError(e.message || 'Lỗi tải health check')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const grouped: Record<string, HealthItem[]> = {}
  if (data) {
    for (const item of data.items) {
      if (!grouped[item.category]) grouped[item.category] = []
      grouped[item.category].push(item)
    }
  }

  const totalRequired = data?.items.filter(i => !i.optional).length ?? 0
  const doneRequired  = data?.items.filter(i => !i.optional && i.present).length ?? 0

  return (
    <div className="space-y-6">

      {/* Summary bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity size={16} style={{ color: 'var(--color-mission-accent)' }} />
            <h2 className="text-sm font-semibold text-white">Trạng thái hệ thống</h2>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Đang tải…' : 'Tải lại'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {!error && data && (
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold ${
              data.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                     : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
            }`}>
              {data.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {data.ok ? 'Sẵn sàng' : 'Còn thiếu cấu hình'}
            </div>
            <span className="text-xs text-gray-500">
              Bắt buộc: <span className="font-mono text-white">{doneRequired}/{totalRequired}</span>
            </span>
            <span className="text-xs text-gray-600 ml-auto">
              Cập nhật: {new Date(data.timestamp).toLocaleTimeString('vi-VN')}
            </span>
          </div>
        )}
      </div>

      {/* Groups */}
      {CATEGORY_ORDER.map(cat => {
        const items = grouped[cat] || []
        if (items.length === 0) return null
        return (
          <div key={cat} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                {CATEGORY_LABEL[cat]}
              </h3>
              <span className="text-xs text-gray-600 ml-auto">
                {items.filter(i => i.present).length}/{items.length}
              </span>
            </div>
            <div className="divide-y divide-gray-800">
              {items.map(item => {
                // Standalone Customer Portal shows as N/A (dash), not green check.
                const isNA = item.key === 'CUSTOMER_PORTAL_URL' && item.meta?.standalone === true
                return (
                  <div key={item.key} className="flex items-start gap-3 px-6 py-3.5">
                    <div className="mt-0.5 shrink-0">
                      {isNA
                        ? <Minus size={14} className="text-gray-600" />
                        : item.present
                          ? <CheckCircle2 size={14} className="text-emerald-400" />
                          : <XCircle size={14} className={item.optional ? 'text-amber-400' : 'text-red-400'} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{item.label}</span>
                        <code className="text-[10px] font-mono text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                          {item.key}
                        </code>
                        {item.optional && !isNA && (
                          <span className="text-[10px] uppercase tracking-widest text-gray-600">optional</span>
                        )}
                        {isNA && (
                          <span className="text-[10px] uppercase tracking-widest text-gray-500">n/a</span>
                        )}
                      </div>
                      {item.hint && (
                        <p className="text-xs text-gray-500 mt-1 flex items-start gap-1.5">
                          <Info size={11} className="mt-0.5 shrink-0" />
                          <span>{item.hint}</span>
                        </p>
                      )}
                    </div>
                    {/* Test connection placeholder for supported items */}
                    {(item.key === 'SUPABASE_REACHABLE' || item.key === 'AI_PROVIDER' || item.key === 'EMAIL_PROVIDER') && (
                      <button
                        disabled
                        title="Sẽ hỗ trợ test kết nối trực tiếp trong phiên bản sau"
                        className="shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-800 text-gray-600 cursor-not-allowed opacity-60"
                      >
                        <Zap size={10} /> Test
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {!data && loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-xs text-gray-500">
          Đang kiểm tra biến môi trường & tích hợp…
        </div>
      )}
    </div>
  )
}

export default HealthCheckTab
