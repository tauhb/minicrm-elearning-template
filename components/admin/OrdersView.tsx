import React, { useEffect, useState } from 'react'
import { Search, Plus, DollarSign, CheckCircle, Clock } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { fetchCourses, fetchCohortsForCourse } from '../../services/api'
import { Course, Product } from '../../types'
import { format } from 'date-fns'
import { useDialog } from '../../contexts/DialogContext'

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  pending: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  refunded: 'text-red-400 bg-red-400/10 border-red-400/20',
  failed: 'text-gray-400 bg-gray-700 border-gray-600',
}
const STATUS_LABELS: Record<string, string> = {
  completed: 'Đã TT',
  pending: 'Chờ TT',
  refunded: 'Hoàn tiền',
  failed: 'Thất bại',
}
const VND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)

type OrderType = 'course' | 'digital'

const OrdersView: React.FC = () => {
  const { confirm: showConfirm } = useDialog()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
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
    const { data } = await supabase
      .from('payments')
      .select('*, student:customers(display_name, email), course:courses(title, slug), product:products(name, slug)')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    fetchCourses().then(setCourses)
    supabase.from('products').select('*').order('created_at', { ascending: false }).then(({ data }) => setProducts(data || []))
  }, [])

  // Auto-fill amount + load cohort hints khi đổi course
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

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      o.student?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.student?.email?.toLowerCase().includes(search.toLowerCase()) ||
      (o.gateway_ref || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || o.status === statusFilter
    const matchProduct = !productFilter
      || (productFilter.startsWith('c:') && o.course_id === productFilter.slice(2))
      || (productFilter.startsWith('p:') && o.product_id === productFilter.slice(2))
    return matchSearch && matchStatus && matchProduct
  })

  const totalRevenue = orders.filter(o => o.status === 'completed').reduce((s, o) => s + (o.amount || 0), 0)
  const paidCount = orders.filter(o => o.status === 'completed').length
  const pendingCount = orders.filter(o => o.status === 'pending').length

  const handleRefund = async (id: string) => {
    const ok = await showConfirm({
      title: 'Hoàn tiền',
      message: 'Đánh dấu đơn này là đã hoàn tiền?',
      variant: 'warning',
      confirmText: 'Hoàn tiền',
    })
    if (!ok) return
    await supabase.from('payments').update({ status: 'refunded' }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'refunded' } : o))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      // 1. Tìm customer theo email
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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Đơn hàng</h1>
          <p className="text-gray-500 text-sm mt-1">{filtered.length} đơn hàng</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          <Plus size={16} />Tạo đơn
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Tổng doanh thu', value: VND(totalRevenue), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20', accent: false },
          { label: 'Đã thanh toán', value: paidCount, icon: CheckCircle, color: '', bg: '', accent: true },
          { label: 'Chờ xử lý', value: pendingCount, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20', accent: false },
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

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm khách hàng, mã đơn..." className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none">
          <option value="">Tất cả trạng thái</option>
          <option value="completed">Đã TT</option>
          <option value="pending">Chờ TT</option>
          <option value="refunded">Hoàn tiền</option>
          <option value="failed">Thất bại</option>
        </select>
        <select value={productFilter} onChange={e => setProductFilter(e.target.value)} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none">
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
              {['Mã đơn', 'Khách hàng', 'Số tiền', 'Trạng thái', 'Cổng TT', 'Sản phẩm/Khóa', 'Ngày', ''].map(h => (
                <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-widest px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => (
              <tr key={i} className="border-b border-gray-800">
                {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-800 rounded animate-pulse" /></td>)}
              </tr>
            )) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-600 py-12">Không có đơn hàng</td></tr>
            ) : filtered.map(order => (
              <tr key={order.id} className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-gray-400">{order.gateway_ref ? order.gateway_ref.slice(0, 16) + '...' : '—'}</td>
                <td className="px-4 py-3">
                  <p className="text-sm text-white">{order.student?.display_name || '—'}</p>
                  <p className="text-xs text-gray-500">{order.student?.email || ''}</p>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-white">{VND(order.amount || 0)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[order.status] || ''}`}>{STATUS_LABELS[order.status] || order.status}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 capitalize">{order.gateway}</td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {order.course?.title || order.product?.name || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{format(new Date(order.created_at), 'dd/MM/yy')}</td>
                <td className="px-4 py-3">
                  {order.status === 'completed' && (
                    <button onClick={() => handleRefund(order.id)} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Hoàn tiền</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Order Modal */}
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
