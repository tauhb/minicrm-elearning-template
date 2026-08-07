import React, { useEffect, useMemo, useState } from 'react'
import { Search, Plus, DollarSign, CheckCircle, Clock, RefreshCw, Eye } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { fetchCourses, fetchCohortsForCourse } from '../../services/api'
import { Course, Product } from '../../types'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useDialog } from '../../contexts/DialogContext'
import OrderDetailModal, { UnifiedOrder } from './OrderDetailModal'
import EmptyState from './EmptyState'

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  paid:      'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  pending:   'text-amber-400 bg-amber-400/10 border-amber-400/20',
  refunded:  'text-red-400 bg-red-400/10 border-red-400/20',
  failed:    'text-gray-400 bg-gray-700 border-gray-600',
  expired:   'text-gray-400 bg-gray-700 border-gray-600',
  cancelled: 'text-gray-400 bg-gray-700 border-gray-600',
}
const STATUS_LABELS: Record<string, string> = {
  completed: 'Đã TT',
  paid:      'Đã TT',
  pending:   'Chờ TT',
  refunded:  'Hoàn tiền',
  failed:    'Thất bại',
  expired:   'Hết hạn',
  cancelled: 'Đã huỷ',
}
const SOURCE_LABEL: Record<UnifiedOrder['source'], string> = {
  funnel_order: 'Đang chờ QR',
  payment:      'Đã ghi nhận',
}

const VND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0)

type OrderType = 'course' | 'digital'
type TabKey = 'all' | 'pending' | 'paid' | 'refunded'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',      label: 'Tất cả' },
  { key: 'pending',  label: 'Chờ thanh toán' },
  { key: 'paid',     label: 'Đã thanh toán' },
  { key: 'refunded', label: 'Hoàn tiền' },
]

const OrdersView: React.FC = () => {
  const { confirm: showConfirm } = useDialog()

  // Data
  const [payments, setPayments] = useState<any[]>([])
  const [pendingFunnelOrders, setPendingFunnelOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [tab, setTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState('')

  // Detail modal
  const [detail, setDetail] = useState<UnifiedOrder | null>(null)

  // Create-order modal (existing manual flow, unchanged)
  const [showCreate, setShowCreate] = useState(false)
  const [courses, setCourses] = useState<Course[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orderType, setOrderType] = useState<OrderType>('course')
  const [form, setForm] = useState({
    email: '',
    amount: '',
    course_id: '',
    product_id: '',
    cohort: '',
    start_date: new Date().toISOString().split('T')[0],
    note: '',
  })
  const [cohortHints, setCohortHints] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const load = async () => {
    setLoading(true)
    // Fetch payments (CRM ledger — completed / refunded / pending / failed)
    const paymentsQ = supabase
      .from('payments')
      .select('*, student:customers(display_name, email, phone), course:courses(title, slug), product:products(name, slug)')
      .order('created_at', { ascending: false })

    // Fetch pending funnel orders (still awaiting QR pay + not expired)
    const pendingQ = supabase
      .from('funnel_orders')
      .select('id, funnel_id, step_id, submission_id, reference_code, amount, currency, status, customer_snapshot, qr_url, expires_at, paid_at, created_at, order_kind, funnel:funnel_flows(name, slug), step:funnel_steps(name, slug, page_type)')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    const [{ data: p }, { data: fo }] = await Promise.all([paymentsQ, pendingQ])
    setPayments(p || [])
    setPendingFunnelOrders(fo || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    fetchCourses().then(setCourses)
    supabase.from('products').select('*').order('created_at', { ascending: false }).then(({ data }) => setProducts(data || []))
  }, [])

  useEffect(() => {
    if (orderType === 'course' && form.course_id) {
      const course = courses.find(c => c.id === form.course_id)
      if (course && !form.amount) setForm(p => ({ ...p, amount: String(course.price || 0) }))
      fetchCohortsForCourse(form.course_id).then(setCohortHints)
    } else {
      setCohortHints([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, form.course_id, courses])

  useEffect(() => {
    if (orderType === 'digital' && form.product_id) {
      const product = products.find(p => p.id === form.product_id)
      if (product && !form.amount) setForm(p => ({ ...p, amount: String(product.price || 0) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, form.product_id, products])

  // ── Unified rows ───────────────────────────────────────────────────────────
  const unified: UnifiedOrder[] = useMemo(() => {
    const paymentRows: UnifiedOrder[] = payments.map(p => ({
      source: 'payment',
      id: p.id,
      reference: p.gateway_ref || `PAY-${String(p.id).slice(0, 8)}`,
      amount: p.amount || 0,
      currency: p.currency || 'VND',
      status: p.status || 'pending',
      gateway: p.gateway,
      created_at: p.created_at,
      paid_at: p.status === 'completed' ? p.created_at : null,
      expires_at: null,
      customer_name: p.student?.display_name || null,
      customer_email: p.student?.email || null,
      customer_phone: p.student?.phone || null,
      funnel_id: null,
      step_id: null,
      submission_id: null,
      order_id: p.order_id || null,
      qr_url: null,
      note: p.order_note || null,
      raw: p,
    }))

    const funnelRows: UnifiedOrder[] = pendingFunnelOrders.map(o => ({
      source: 'funnel_order',
      id: o.id,
      reference: o.reference_code,
      amount: o.amount,
      currency: o.currency || 'VND',
      status: o.status,          // 'pending'
      gateway: 'sepay',
      created_at: o.created_at,
      paid_at: o.paid_at,
      expires_at: o.expires_at,
      customer_name: o.customer_snapshot?.name || o.customer_snapshot?.full_name || null,
      customer_email: o.customer_snapshot?.email || null,
      customer_phone: o.customer_snapshot?.phone || null,
      funnel_id: o.funnel_id,
      step_id: o.step_id,
      submission_id: o.submission_id,
      order_id: null,
      qr_url: o.qr_url,
      note: o.funnel?.name ? `Từ funnel: ${o.funnel.name}` : null,
      raw: o,
    }))

    // Deduplicate: if a funnel_order has already been mirrored into payments
    // (payments.order_id points at it), suppress the funnel row so we don't show both.
    const referencedByPayment = new Set(paymentRows.map(r => r.order_id).filter(Boolean) as string[])
    const dedupedFunnelRows = funnelRows.filter(r => !referencedByPayment.has(r.id))

    return [...dedupedFunnelRows, ...paymentRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }, [payments, pendingFunnelOrders])

  // Tab filtering
  const pendingCount = unified.filter(o => o.source === 'funnel_order' && o.status === 'pending').length
  const paidCount = unified.filter(o => o.status === 'completed' || o.status === 'paid').length
  const refundedCount = unified.filter(o => o.status === 'refunded').length
  const totalRevenue = payments
    .filter(p => p.status === 'completed')
    .reduce((s, p) => s + (p.amount || 0), 0)

  const byTab = useMemo(() => {
    switch (tab) {
      case 'pending':  return unified.filter(o => o.source === 'funnel_order' && o.status === 'pending')
      case 'paid':     return unified.filter(o => o.status === 'completed' || o.status === 'paid')
      case 'refunded': return unified.filter(o => o.status === 'refunded')
      case 'all':
      default:         return unified
    }
  }, [unified, tab])

  const filtered = byTab.filter(o => {
    const q = search.toLowerCase()
    const matchSearch = !q
      || o.customer_name?.toLowerCase().includes(q)
      || o.customer_email?.toLowerCase().includes(q)
      || o.reference.toLowerCase().includes(q)
    const matchProduct = !productFilter
      || (productFilter.startsWith('c:') && o.raw?.course_id === productFilter.slice(2))
      || (productFilter.startsWith('p:') && o.raw?.product_id === productFilter.slice(2))
    return matchSearch && matchProduct
  })

  // ── Create-order handler (existing manual flow, unchanged) ─────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const { data: profile } = await supabase.from('customers').select('id').eq('email', form.email.toLowerCase()).maybeSingle()
      if (!profile) {
        setCreateError('Khách hàng không tồn tại. Vui lòng tạo Khách hàng trước.')
        setCreating(false)
        return
      }

      const paymentData: any = {
        student_id: profile.id,
        amount: parseInt(form.amount) || 0,
        currency: 'VND',
        status: 'completed',
        gateway: 'manual',
        gateway_ref: `MANUAL-${Date.now()}`,
        order_note: form.note || null,
      }

      if (orderType === 'course') {
        if (!form.course_id) {
          setCreateError('Vui lòng chọn khóa học')
          setCreating(false)
          return
        }
        paymentData.course_id = form.course_id
        const { data: enrollment } = await supabase.from('customer_courses').upsert({
          customer_id: profile.id,
          course_id: form.course_id,
          cohort: form.cohort || null,
          start_date: form.start_date || null,
          status: 'active',
        }, { onConflict: 'customer_id,course_id' }).select().single()
        paymentData.enrollment_id = enrollment?.id || null
      } else {
        if (!form.product_id) {
          setCreateError('Vui lòng chọn sản phẩm')
          setCreating(false)
          return
        }
        paymentData.product_id = form.product_id
        await supabase.from('customer_products').upsert({
          customer_id: profile.id,
          product_id: form.product_id,
        }, { onConflict: 'customer_id,product_id' })
      }

      await supabase.from('payments').insert(paymentData)
      setShowCreate(false)
      setForm({
        email: '', amount: '', course_id: '', product_id: '',
        cohort: '', start_date: new Date().toISOString().split('T')[0], note: '',
      })
      load()
    } catch (err: any) {
      setCreateError(err?.message || 'Lỗi khi tạo đơn')
    } finally {
      setCreating(false)
    }
  }

  const timeLeft = (expiresAt?: string | null) => {
    if (!expiresAt) return '—'
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (ms <= 0) return 'Hết hạn'
    return `còn ${formatDistanceToNowStrict(new Date(expiresAt), { locale: vi })}`
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Đơn hàng</h1>
          <p className="text-gray-500 text-sm mt-1">{filtered.length} đơn hàng</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-300 border border-gray-700 rounded-lg hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Làm mới
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Plus size={16} />Thêm đơn
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Tổng doanh thu', value: VND(totalRevenue), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20', accent: false },
          { label: 'Đã thanh toán', value: paidCount, icon: CheckCircle, color: '', bg: '', accent: true },
          { label: 'Chờ thanh toán', value: pendingCount, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20', accent: false },
        ].map(s => (
          s.accent ? (
            <div
              key={s.label}
              className="bg-gray-900 border rounded-xl p-4 flex items-center justify-between"
              style={{
                borderColor: 'rgba(var(--color-mission-accent-rgb, 182, 255, 0), 0.2)',
                background: 'rgba(var(--color-mission-accent-rgb, 182, 255, 0), 0.06)',
              }}
            >
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{s.label}</p>
                <p className="text-xl font-bold" style={{ color: 'var(--color-mission-accent)' }}>{s.value}</p>
              </div>
              <s.icon size={20} style={{ color: 'var(--color-mission-accent)' }} />
            </div>
          ) : (
            <div key={s.label} className={`bg-gray-900 border ${s.bg} rounded-xl p-4 flex items-center justify-between`}>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
              <s.icon size={20} className={s.color} />
            </div>
          )
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800 mb-5">
        {TABS.map(t => {
          const active = tab === t.key
          const badge = t.key === 'pending' ? pendingCount
            : t.key === 'paid' ? paidCount
            : t.key === 'refunded' ? refundedCount
            : null
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                active
                  ? 'text-white border-emerald-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              {t.label}
              {badge != null && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${
                  active ? 'bg-emerald-400/20 text-emerald-300' : 'bg-gray-800 text-gray-400'
                }`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm khách hàng, mã đơn..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
          />
        </div>
        <select
          value={productFilter}
          onChange={e => setProductFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none"
        >
          <option value="">Tất cả sản phẩm</option>
          {courses.length > 0 && (
            <optgroup label="── Khóa học">
              {courses.map(c => <option key={c.id} value={`c:${c.id}`}>{c.title}</option>)}
            </optgroup>
          )}
          {products.length > 0 && (
            <optgroup label="── Sản phẩm số">
              {products.map(p => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              {tab === 'pending' ? (
                ['Reference', 'Số tiền', 'Funnel / bước', 'Khách hàng', 'Tạo lúc', 'Hết hạn', ''].map(h => (
                  <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-widest px-4 py-3">{h}</th>
                ))
              ) : (
                ['Mã đơn', 'Khách hàng', 'Số tiền', 'Trạng thái', 'Cổng TT', 'Nguồn / sản phẩm', 'Ngày', ''].map(h => (
                  <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-widest px-4 py-3">{h}</th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => (
              <tr key={i} className="border-b border-gray-800">
                {[...Array(8)].map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-800 rounded animate-pulse" /></td>
                ))}
              </tr>
            )) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6">
                  <EmptyState
                    title={tab === 'pending' ? 'Không có đơn đang chờ QR' : 'Chưa có đơn hàng'}
                    description={tab === 'pending'
                      ? 'Khi khách quét QR và thanh toán, đơn sẽ tự động chuyển sang tab "Đã thanh toán".'
                      : 'Đơn hàng sẽ hiện tại đây khi có khách mua qua funnel hoặc bạn tạo thủ công.'}
                  />
                </td>
              </tr>
            ) : filtered.map(order => (
              tab === 'pending' ? (
                // Pending-tab layout
                <tr
                  key={`${order.source}-${order.id}`}
                  onClick={() => setDetail(order)}
                  className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-emerald-400">{order.reference}</p>
                    <p className="text-[10px] text-gray-600 mt-0.5">{SOURCE_LABEL[order.source]}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{VND(order.amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {order.raw?.funnel?.name
                      ? <><p className="text-gray-200">{order.raw.funnel.name}</p>
                          <p className="text-gray-500">{order.raw.step?.name || '—'}</p></>
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-white">{order.customer_name || '—'}</p>
                    <p className="text-xs text-gray-500">{order.customer_email || ''}</p>
                    {order.customer_phone && <p className="text-xs text-gray-500">{order.customer_phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{format(new Date(order.created_at), 'dd/MM HH:mm')}</td>
                  <td className="px-4 py-3 text-xs text-amber-400">{timeLeft(order.expires_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); setDetail(order) }}
                      className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      <Eye size={12} /> Xem QR
                    </button>
                  </td>
                </tr>
              ) : (
                // Default (all / paid / refunded)
                <tr
                  key={`${order.source}-${order.id}`}
                  onClick={() => setDetail(order)}
                  className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {order.reference.length > 18 ? order.reference.slice(0, 16) + '…' : order.reference}
                    <p className="text-[10px] text-gray-600 mt-0.5">{SOURCE_LABEL[order.source]}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-white">{order.customer_name || '—'}</p>
                    <p className="text-xs text-gray-500">{order.customer_email || ''}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{VND(order.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[order.status] || ''}`}>
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 capitalize">{order.gateway || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {order.raw?.course?.title
                      || order.raw?.product?.name
                      || order.raw?.funnel?.name
                      || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{format(new Date(order.created_at), 'dd/MM/yy')}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); setDetail(order) }}
                      className="text-xs text-gray-500 hover:text-white transition-colors"
                    >
                      Xem
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {detail && (
        <OrderDetailModal
          order={detail}
          onClose={() => setDetail(null)}
          onChanged={() => load()}
        />
      )}

      {/* Create Order Modal (existing manual flow) */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-4">Tạo đơn thủ công</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Email khách *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="student@email.com"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Loại đơn</label>
                <div className="flex gap-3 text-sm text-gray-300">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={orderType === 'course'} onChange={() => setOrderType('course')} /> Khóa học
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={orderType === 'digital'} onChange={() => setOrderType('digital')} /> Sản phẩm số
                  </label>
                </div>
              </div>

              {orderType === 'course' ? (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Khóa học *</label>
                    <select
                      value={form.course_id}
                      onChange={e => setForm(p => ({ ...p, course_id: e.target.value }))}
                      required
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="">— Chọn khóa học —</option>
                      {courses.map(c => <option key={c.id} value={c.id}>{c.title}{c.price ? ` (${VND(c.price)})` : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Cohort</label>
                    <input
                      type="text"
                      list="order-cohort-hints"
                      value={form.cohort}
                      onChange={e => setForm(p => ({ ...p, cohort: e.target.value }))}
                      placeholder="K1, K2..."
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                    />
                    <datalist id="order-cohort-hints">
                      {cohortHints.map(c => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Ngày bắt đầu</label>
                    <input
                      type="date"
                      value={form.start_date}
                      onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Sản phẩm *</label>
                  <select
                    value={form.product_id}
                    onChange={e => setForm(p => ({ ...p, product_id: e.target.value }))}
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="">— Chọn sản phẩm —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.price ? ` (${VND(p.price)})` : ''}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Số tiền (VND) *</label>
                <input
                  type="number"
                  required
                  value={form.amount}
                  onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="1990000"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Ghi chú</label>
                <input
                  type="text"
                  value={form.note}
                  onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                  placeholder="Ghi chú đơn hàng"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>

              {createError && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded px-3 py-2">{createError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreate(false); setCreateError('') }} className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white transition-colors">Hủy</button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >{creating ? 'Đang tạo...' : 'Tạo'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default OrdersView
