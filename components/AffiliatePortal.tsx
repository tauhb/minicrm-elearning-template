import React, { useEffect, useState } from 'react'
import { Link2, TrendingUp, DollarSign, Clock, Copy, CheckCircle, Users, ShoppingBag, AlertCircle, LogOut, Eye, ArrowLeft } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../services/supabase'

interface FunnelShare {
  id: string
  slug: string
  name: string
  description: string | null
  type: string
  url: string
  share_url: string
}

interface AffiliateData {
  affiliate: {
    id: string
    status: string
    referral_code: string
    referral_url: string
    commission_rate: number
    payout_method: string
    display_name?: string
  }
  stats: {
    total_clicks: number
    total_leads: number
    total_conversions: number
    conversion_rate: string
    commissions: { pending: number; available: number; paid: number }
  }
  referred_leads: {
    id: string
    name: string
    email: string
    created_at: string
    is_converted: boolean
    score: number
  }[]
  orders: {
    id: string
    sale_amount: number
    status: string
    converted_at: string
    product_name: string
  }[]
  payouts: any[]
  funnels: FunnelShare[]
}

const FUNNEL_TYPE_LABELS: Record<string, string> = {
  sales: 'Sales', leads: 'Leads', webinar: 'Webinar', booking: 'Booking', challenge: 'Challenge', other: 'Khác',
}
const FUNNEL_TYPE_COLORS: Record<string, string> = {
  sales:     'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  leads:     'bg-blue-900/40 text-blue-300 border-blue-700/50',
  webinar:   'bg-purple-900/40 text-purple-300 border-purple-700/50',
  booking:   'bg-amber-900/40 text-amber-300 border-amber-700/50',
  challenge: 'bg-pink-900/40 text-pink-300 border-pink-700/50',
  other:     'bg-gray-800 text-gray-400 border-gray-700',
}

const fmt = (n: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default function AffiliatePortal() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('preview') // admin xem dashboard của affiliate khác

  const [data, setData]                 = useState<AffiliateData | null>(null)
  const [loading, setLoading]           = useState(true)
  const [notAffiliate, setNotAffiliate] = useState(false)
  const [copiedId, setCopiedId]         = useState<string | null>(null) // funnel id or 'master'
  const [tab, setTab]                   = useState<'leads' | 'orders' | 'payouts'>('leads')
  const [isPreview, setIsPreview]       = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      // Admin preview mode: dùng admin endpoint với affiliate_id
      const endpoint = previewId
        ? `/api/admin/affiliates?affiliate_id=${previewId}`
        : `/api/affiliates/dashboard`

      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.status === 404) { setNotAffiliate(true); setLoading(false); return }
      if (!res.ok) { setLoading(false); return }
      const json = await res.json()
      setData(json)
      setIsPreview(!!json._preview)
      setLoading(false)
    }
    load()
  }, [previewId])

  const copyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-black text-gray-400 text-sm">Đang tải...</div>
  }

  if (notAffiliate) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center p-8">
          <AlertCircle size={40} className="text-gray-600 mx-auto mb-4" />
          <p className="text-white font-medium mb-2">Tài khoản chưa phải Affiliate</p>
          <p className="text-gray-500 text-sm">Liên hệ admin để được kích hoạt</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { affiliate, stats } = data

  return (
    <div className="h-screen overflow-y-auto bg-gray-950 text-white">
      {/* Admin preview banner */}
      {isPreview && (
        <div className="bg-amber-900/40 border-b border-amber-700/60 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-200 text-sm">
            <Eye size={15} />
            <span>
              <strong>Chế độ xem trước (Admin)</strong> — Bạn đang xem dashboard của{' '}
              <strong>{(affiliate as any).display_name || affiliate.referral_code}</strong>
            </span>
          </div>
          <button
            onClick={() => navigate('/admin/affiliates')}
            className="flex items-center gap-1.5 text-xs text-amber-200 hover:text-white px-3 py-1.5 rounded-md border border-amber-600/40 hover:bg-amber-800/40 transition-colors"
          >
            <ArrowLeft size={13} /> Về Admin
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold" style={{ color: 'var(--color-mission-accent, #B6FF00)' }}>
            Affiliate Dashboard
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Theo dõi leads và hoa hồng của bạn</p>
        </div>
        {!isPreview && (
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <LogOut size={14} /> Đăng xuất
          </button>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Status banner */}
        {affiliate.status === 'pending' && (
          <div className="flex items-center gap-3 p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-xl">
            <AlertCircle size={16} className="text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-300">Tài khoản đang chờ admin phê duyệt</p>
          </div>
        )}

        {/* Refcode badge + commission info */}
        {affiliate.status === 'approved' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-base"
                  style={{ background: 'rgba(182,255,0,0.12)', color: 'var(--color-mission-accent, #B6FF00)', border: '1px solid rgba(182,255,0,0.3)' }}
                >
                  {affiliate.referral_code.substring(0, 2)}
                </div>
                <div>
                  <div className="text-xs text-gray-500">Mã affiliate của bạn</div>
                  <div className="text-base font-mono font-bold" style={{ color: 'var(--color-mission-accent, #B6FF00)' }}>
                    {affiliate.referral_code}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Hoa hồng</div>
                <div className="text-base font-bold text-white">{affiliate.commission_rate}%</div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-800">
              Cookie 30 ngày · Last-click attribution · Hoa hồng giữ 30 ngày trước khi có thể rút
            </p>
          </div>
        )}

        {/* Share Links per Funnel */}
        {affiliate.status === 'approved' && data.funnels && data.funnels.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Link2 size={15} /> Link Giới Thiệu Theo Funnel
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Share đúng link tương ứng với sản phẩm/funnel bạn muốn quảng bá
            </p>

            <div className="space-y-3">
              {data.funnels.map(f => (
                <div key={f.id} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold text-white truncate">{f.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${FUNNEL_TYPE_COLORS[f.type] || FUNNEL_TYPE_COLORS.other}`}>
                          {FUNNEL_TYPE_LABELS[f.type] || f.type}
                        </span>
                      </div>
                      {f.description && (
                        <p className="text-[11px] text-gray-500 line-clamp-2">{f.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-[11px] text-gray-300 font-mono truncate">
                      {f.share_url}
                    </div>
                    <button
                      onClick={() => copyLink(f.share_url, f.id)}
                      className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                      style={copiedId === f.id
                        ? { background: 'var(--color-mission-accent, #B6FF00)', color: '#000' }
                        : { background: '#374151', color: '#9ca3af' }}
                    >
                      {copiedId === f.id ? <><CheckCircle size={12} /> Đã copy</> : <><Copy size={12} /> Copy</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fallback: chưa có funnel nào */}
        {affiliate.status === 'approved' && (!data.funnels || data.funnels.length === 0) && (
          <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-2xl p-5 text-center">
            <Link2 size={20} className="text-yellow-400 mx-auto mb-2" />
            <p className="text-sm text-yellow-200">Admin chưa cấu hình funnel nào.</p>
            <p className="text-xs text-yellow-300/70 mt-1">Khi có funnel, link giới thiệu sẽ tự xuất hiện ở đây.</p>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Lượt click',    value: stats.total_clicks,      icon: TrendingUp },
            { label: 'Leads',         value: stats.total_leads,        icon: Users },
            { label: 'Đơn hàng',      value: stats.total_conversions,  icon: ShoppingBag },
            { label: 'Tỷ lệ chuyển', value: `${stats.conversion_rate}%`, icon: CheckCircle },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-2"><Icon size={13} />{label}</div>
              <div className="text-xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>

        {/* Commission summary */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <DollarSign size={15} /> Hoa Hồng
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Đang giữ (30 ngày)', value: stats.commissions.pending,   color: 'text-yellow-400' },
              { label: 'Sẵn sàng rút',       value: stats.commissions.available, color: 'text-[var(--color-mission-accent,#B6FF00)]' },
              { label: 'Đã thanh toán',       value: stats.commissions.paid,      color: 'text-gray-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className={`text-lg font-bold ${color}`}>{fmt(value)}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
          {stats.commissions.available > 0 && (
            <p className="text-xs text-gray-500 mt-3 text-center">
              Liên hệ admin để yêu cầu rút hoa hồng
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800">
          {[
            { key: 'leads',   label: `Leads (${data.referred_leads.length})`,  icon: Users },
            { key: 'orders',  label: `Đơn hàng (${data.orders.length})`,       icon: ShoppingBag },
            { key: 'payouts', label: `Thanh toán (${data.payouts.length})`,    icon: DollarSign },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-[var(--color-mission-accent,#B6FF00)] text-[var(--color-mission-accent,#B6FF00)]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {/* Leads tab */}
        {tab === 'leads' && (
          <div>
            {data.referred_leads.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">
                Chưa có leads nào. Chia sẻ link giới thiệu để bắt đầu!
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Tên', 'Email', 'Ngày vào', 'Trạng thái'].map(h => (
                        <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.referred_leads.map(lead => (
                      <tr key={lead.id} className="border-b border-gray-800 last:border-0">
                        <td className="px-4 py-3 text-sm text-white">{lead.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{lead.email}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(lead.created_at)}</td>
                        <td className="px-4 py-3">
                          {lead.is_converted ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-green-900/40 text-green-400 border border-green-700">
                              Đã mua hàng
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                              Chưa mua
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Orders tab */}
        {tab === 'orders' && (
          <div>
            {data.orders.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">
                Chưa có đơn hàng nào từ leads của bạn
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Sản phẩm', 'Giá trị', 'Ngày mua', 'Trạng thái'].map(h => (
                        <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map(order => (
                      <tr key={order.id} className="border-b border-gray-800 last:border-0">
                        <td className="px-4 py-3 text-sm text-white">{order.product_name}</td>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--color-mission-accent,#B6FF00)' }}>
                          {fmt(order.sale_amount)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(order.converted_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded border ${
                            order.status === 'confirmed'
                              ? 'bg-green-900/40 text-green-400 border-green-700'
                              : 'bg-gray-800 text-gray-400 border-gray-700'
                          }`}>
                            {order.status === 'confirmed' ? 'Xác nhận' : order.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Payouts tab */}
        {tab === 'payouts' && (
          <div>
            {data.payouts.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">
                Chưa có lịch sử thanh toán
              </div>
            ) : (
              <div className="space-y-3">
                {data.payouts.map((p: any) => (
                  <div key={p.id || p.created_at} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">{fmt(p.total_amount)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{fmtDate(p.created_at)}</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      p.status === 'completed' ? 'bg-green-900/40 text-green-400 border-green-700'
                      : p.status === 'pending'  ? 'bg-yellow-900/40 text-yellow-400 border-yellow-700'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {p.status === 'completed' ? 'Đã thanh toán' : p.status === 'pending' ? 'Đang xử lý' : p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
