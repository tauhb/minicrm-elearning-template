import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, CheckCircle, Clock, DollarSign, RefreshCw, ChevronDown, ChevronUp, Plus, Search, X, ShoppingBag, TrendingUp, Eye, Funnel as FunnelIcon } from 'lucide-react'
import { supabase } from '../../services/supabase'
import FunnelsView from './FunnelsView'

interface Affiliate {
  id: string
  display_name: string
  referral_code: string
  status: 'pending' | 'approved' | 'suspended'
  commission_rate: number
  payout_method: string
  payout_details: Record<string, any>
  created_at: string
  total_earned: number
  total_paid: number
  customer: { email: string }
  clicks: { count: number }[]
  conversions: { count: number }[]
}

interface PendingPayout {
  affiliate: Affiliate
  commissions: any[]
  total: number
}

const fmt = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n)

interface AffiliateOrder {
  id: string
  sale_amount: number
  converted_at: string
  product_name: string
  customer_name: string
  customer_email: string
  affiliate_name: string
  affiliate_code: string
}

const fmtVND = (n: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default function AffiliatesView() {
  const navigate = useNavigate()
  const [affiliates, setAffiliates]   = useState<Affiliate[]>([])
  const [payouts, setPayouts]         = useState<PendingPayout[]>([])
  const [orders, setOrders]           = useState<AffiliateOrder[]>([])
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalOrders, setTotalOrders]   = useState(0)
  const [tab, setTab]                 = useState<'affiliates' | 'orders' | 'funnels' | 'payouts'>('affiliates')
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [showInvite, setShowInvite]   = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [inviteCommission, setInviteCommission] = useState('30')
  const [inviting, setInviting]       = useState(false)

  const accent = { color: 'var(--color-mission-accent)' }
  const accentBg = { backgroundColor: 'var(--color-mission-accent)', color: '#000' }

  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return

    const [affRes, payRes] = await Promise.all([
      fetch('/api/admin/affiliates', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/affiliates/payouts', { headers: { Authorization: `Bearer ${token}` } }),
    ])

    const affData = await affRes.json()
    const payData = await payRes.json()
    setAffiliates(affData.affiliates || [])
    setOrders(affData.orders || [])
    setTotalRevenue(affData.stats?.total_revenue || 0)
    setTotalOrders(affData.stats?.total_orders || 0)
    setPayouts(payData.available_by_affiliate || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Search leads + customers for invite
  useEffect(() => {
    if (!customerSearch.trim()) { setCustomerResults([]); return }
    const t = setTimeout(async () => {
      const q = `%${customerSearch}%`
      // Search leads (ưu tiên — ai cũng có thể là affiliate)
      const { data: leads } = await supabase
        .from('leads')
        .select('id, name, email, refcode')
        .ilike('email', q)
        .limit(4)
      // Search customers cũng tìm
      const { data: customers } = await supabase
        .from('customers')
        .select('id, display_name, email, role')
        .ilike('email', q)
        .limit(3)

      const results = [
        ...(leads || []).map((l: any) => ({ ...l, display_name: l.name, _type: 'lead' })),
        ...(customers || []).map((c: any) => ({ ...c, _type: 'customer' })),
      ]
      // Dedupe theo email
      const seen = new Set<string>()
      setCustomerResults(results.filter(r => { if (seen.has(r.email)) return false; seen.add(r.email); return true }))
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch])

  const inviteAsAffiliate = async () => {
    if (!selectedCustomer) return
    setInviting(true)
    const { data: { session } } = await supabase.auth.getSession()

    // Lead hoặc Customer?
    const body = selectedCustomer._type === 'lead'
      ? { lead_id: selectedCustomer.id, commission_rate: parseFloat(inviteCommission) }
      : { customer_id: selectedCustomer.id, commission_rate: parseFloat(inviteCommission) }

    const res = await fetch('/api/admin/affiliates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (res.ok) {
      setShowInvite(false)
      setSelectedCustomer(null)
      setCustomerSearch('')
      load()
    } else {
      alert(json.error || 'Lỗi')
    }
    setInviting(false)
  }

  const updateStatus = async (id: string, status: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/admin/affiliates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ id, status }),
    })
    load()
  }

  const createPayout = async (affiliateId: string, commissionIds: string[]) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/affiliates/payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ affiliate_id: affiliateId, commission_ids: commissionIds }),
    })
    if (res.ok) load()
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      approved:  'bg-green-900/40 text-green-400 border border-green-700',
      pending:   'bg-yellow-900/40 text-yellow-400 border border-yellow-700',
      suspended: 'bg-red-900/40 text-red-400 border border-red-700',
    }
    const labels: Record<string, string> = { approved: 'Đã duyệt', pending: 'Chờ duyệt', suspended: 'Tạm dừng' }
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || ''}`}>{labels[status] || status}</span>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Affiliate Program</h1>
          <p className="text-sm text-gray-400 mt-0.5">Quản lý đối tác giới thiệu và hoa hồng</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
            style={accentBg}
          >
            <Plus size={14} /> Mời làm Affiliate
          </button>
          <button onClick={load} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Mời khách hàng làm Affiliate</h2>
              <button onClick={() => { setShowInvite(false); setSelectedCustomer(null); setCustomerSearch('') }} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            {!selectedCustomer ? (
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">Tìm khách hàng theo email</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
                    placeholder="email@example.com"
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                {customerResults.length > 0 && (
                  <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                    {customerResults.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomerResults([]) }}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-0"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-white">{c.display_name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            c._type === 'lead'
                              ? 'bg-purple-900/40 text-purple-300 border border-purple-700'
                              : 'bg-blue-900/40 text-blue-300 border border-blue-700'
                          }`}>
                            {c._type === 'lead' ? 'Lead' : 'Khách hàng'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">{c.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-white">{selectedCustomer.display_name}</p>
                    <p className="text-xs text-gray-400">{selectedCustomer.email}</p>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="text-gray-400 hover:text-white"><X size={14} /></button>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Tỷ lệ hoa hồng (%)</label>
                  <input
                    type="number" min="1" max="100"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    value={inviteCommission}
                    onChange={e => setInviteCommission(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">Mặc định 30% — thay đổi được sau khi tạo</p>
                </div>
                <button
                  onClick={inviteAsAffiliate}
                  disabled={inviting}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={accentBg}
                >
                  {inviting ? 'Đang tạo...' : `Tạo affiliate cho ${selectedCustomer.display_name}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats bar — 5 cards (doanh thu highlight) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Tổng doanh thu — highlight */}
        <div className="bg-gray-900 border-2 rounded-xl p-4 col-span-2 md:col-span-1"
          style={{ borderColor: 'var(--color-mission-accent)' }}>
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
            <TrendingUp size={14} /> Doanh thu từ Affiliate
          </div>
          <div className="text-xl md:text-2xl font-bold" style={accent}>{fmtVND(totalRevenue)}</div>
          <div className="text-[10px] text-gray-500 mt-1">{totalOrders} đơn hàng</div>
        </div>

        {[
          { label: 'Tổng affiliate', value: affiliates.length, icon: Users },
          { label: 'Đang active',   value: affiliates.filter(a => a.status === 'approved').length, icon: CheckCircle },
          { label: 'Chờ duyệt',     value: affiliates.filter(a => a.status === 'pending').length, icon: Clock },
          { label: 'Cần thanh toán', value: payouts.length, icon: DollarSign },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
              <Icon size={14} /> {label}
            </div>
            <div className="text-2xl font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-0 overflow-x-auto">
        {[
          { key: 'affiliates', label: `Affiliates (${affiliates.length})`,         icon: Users },
          { key: 'orders',     label: `Đơn hàng Affiliate (${totalOrders})`,        icon: ShoppingBag },
          { key: 'funnels',    label: 'Funnels',                                    icon: FunnelIcon },
          { key: 'payouts',    label: `Cần thanh toán (${payouts.length})`,         icon: DollarSign },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-[var(--color-mission-accent)] text-[var(--color-mission-accent)]'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-500 text-sm text-center py-8">Đang tải...</div>}

      {/* Affiliates tab */}
      {!loading && tab === 'affiliates' && (
        <div className="space-y-3">
          {affiliates.length === 0 && (
            <div className="text-center py-12 text-gray-500">Chưa có affiliate nào</div>
          )}
          {affiliates.map(a => (
            <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/50 transition-colors"
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-white">
                    {a.display_name[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{a.display_name}</div>
                    <div className="text-xs text-gray-400">{a.customer?.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Code</div>
                    <div className="font-mono font-bold" style={accent}>{a.referral_code}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Hoa hồng</div>
                    <div className="text-white font-medium">{a.commission_rate}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Clicks</div>
                    <div className="text-white">{a.clicks?.[0]?.count ?? 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Đã kiếm</div>
                    <div className="text-white">{fmt(a.total_earned || 0)}</div>
                  </div>
                  {statusBadge(a.status)}
                  {expanded === a.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </div>

              {expanded === a.id && (
                <div className="border-t border-gray-800 p-4 bg-gray-900/50">
                  <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Phương thức thanh toán</div>
                      <div className="text-white">{a.payout_method}</div>
                      {a.payout_details && (
                        <div className="text-xs text-gray-400 mt-1">
                          {a.payout_details.accountNumber && `TK: ${a.payout_details.accountNumber}`}
                          {a.payout_details.momoNumber && `MoMo: ${a.payout_details.momoNumber}`}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Link giới thiệu</div>
                      <div className="font-mono text-xs text-gray-300 break-all">
                        {window.location.origin}/?ref={a.referral_code}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 items-center">
                    {/* Xem dashboard — luôn có */}
                    <button
                      onClick={() => navigate(`/affiliate?preview=${a.id}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-900/30 text-amber-300 border border-amber-700/50 hover:bg-amber-900/50 transition-colors"
                      title="Xem dashboard theo góc nhìn của affiliate này"
                    >
                      <Eye size={12} /> Xem dashboard
                    </button>

                    {a.status === 'pending' && (
                      <button
                        onClick={() => updateStatus(a.id, 'approved')}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg"
                        style={accentBg}
                      >
                        Phê duyệt
                      </button>
                    )}
                    {a.status === 'approved' && (
                      <button
                        onClick={() => updateStatus(a.id, 'suspended')}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-900/30 text-red-400 border border-red-800"
                      >
                        Tạm dừng
                      </button>
                    )}
                    {a.status === 'suspended' && (
                      <button
                        onClick={() => updateStatus(a.id, 'approved')}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-900/30 text-green-400 border border-green-800"
                      >
                        Kích hoạt lại
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Orders tab — Đơn hàng Affiliate */}
      {!loading && tab === 'orders' && (
        <div>
          {orders.length === 0 ? (
            <div className="text-center py-12 text-gray-500">Chưa có đơn hàng nào từ affiliate</div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Khách hàng', 'Sản phẩm', 'Giá trị', 'Affiliate', 'Ngày'].map(h => (
                      <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <p className="text-sm text-white">{o.customer_name}</p>
                        <p className="text-xs text-gray-500">{o.customer_email}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{o.product_name}</td>
                      <td className="px-4 py-3 text-sm font-bold" style={accent}>
                        {fmtVND(o.sale_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-white">{o.affiliate_name}</p>
                        <p className="text-[10px] font-mono px-1.5 py-0.5 rounded inline-block mt-0.5"
                           style={{ color: 'var(--color-mission-accent)', background: 'rgba(182,255,0,0.08)' }}>
                          {o.affiliate_code}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(o.converted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Funnels tab — registry để affiliate share */}
      {!loading && tab === 'funnels' && (
        <FunnelsView embedded />
      )}

      {/* Payouts tab */}
      {!loading && tab === 'payouts' && (
        <div className="space-y-4">
          {payouts.length === 0 && (
            <div className="text-center py-12 text-gray-500">Không có hoa hồng nào cần thanh toán</div>
          )}
          {payouts.map((p: PendingPayout) => (
            <div key={(p.affiliate as any).id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-white">{(p.affiliate as any).display_name}</div>
                  <div className="text-xs text-gray-400">{(p.affiliate as any).customer?.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">{p.commissions.length} hoa hồng sẵn sàng</div>
                  <div className="text-lg font-bold" style={accent}>{fmt(p.total)}</div>
                </div>
              </div>

              <div className="text-xs text-gray-400 mb-3">
                Phương thức: <span className="text-white">{(p.affiliate as any).payout_method}</span>
                {(p.affiliate as any).payout_details?.accountNumber && (
                  <> · TK <span className="text-white">{(p.affiliate as any).payout_details.accountNumber}</span></>
                )}
              </div>

              <button
                onClick={() => createPayout((p.affiliate as any).id, p.commissions.map((c: any) => c.id))}
                className="w-full py-2 text-sm font-medium rounded-lg"
                style={accentBg}
              >
                Tạo lệnh thanh toán {fmt(p.total)}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
