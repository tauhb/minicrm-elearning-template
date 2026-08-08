import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Edit2, Trash2, ExternalLink, ToggleLeft, ToggleRight, Package, Lock, Globe, BookOpen, Users, Eye, X, Search } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { fetchCourses, fetchCustomersForProduct, grantProductToCustomer, revokeProductFromCustomer } from '../../services/api'
import { Course, Product, ProductAccessType, CustomerProduct } from '../../types'
import { useDialog } from '../../contexts/DialogContext'

const TYPE_LABELS: Record<string, string> = {
  ebook: 'Ebook', template: 'Template', toolkit: 'Toolkit', video: 'Video Course', other: 'Other'
}

const ACCESS_OPTIONS: Array<{ value: ProductAccessType; label: string; icon: any; hint: string }> = [
  { value: 'public', label: 'Công khai', icon: Globe, hint: 'Ai cũng xem được' },
  { value: 'password', label: 'Mật khẩu', icon: Lock, hint: 'Cần nhập mật khẩu' },
  { value: 'course', label: 'Theo khóa học', icon: BookOpen, hint: 'Chỉ học viên của khóa' },
  { value: 'assigned', label: 'Gán riêng', icon: Users, hint: 'Chỉ người được gán' },
]

const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^\w\s-]/g, '').trim()
    .replace(/\s+/g, '-').slice(0, 60)

interface FormState {
  name: string
  slug: string
  type: string
  price: string
  cover_image_url: string
  description: string
  access_type: ProductAccessType
  password: string
  course_id: string
  status: 'active' | 'draft'
  delivery_url: string
}

const emptyForm: FormState = {
  name: '', slug: '', type: 'ebook', price: '', cover_image_url: '',
  description: '', access_type: 'public', password: '', course_id: '', status: 'active', delivery_url: ''
}

const DigitalProducts: React.FC = () => {
  const { confirm: showConfirm } = useDialog()
  const [products, setProducts] = useState<Product[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [assignedCounts, setAssignedCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAssignManager, setShowAssignManager] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: prodData }, courseData] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      fetchCourses(),
    ])
    const prods = (prodData || []) as Product[]
    setProducts(prods)
    setCourses(courseData)

    // Count assigned customers for "assigned" products
    const assignedProds = prods.filter(p => p.access_type === 'assigned')
    if (assignedProds.length > 0) {
      const counts: Record<string, number> = {}
      await Promise.all(assignedProds.map(async p => {
        const list = await fetchCustomersForProduct(p.id)
        counts[p.id] = list.length
      }))
      setAssignedCounts(counts)
    } else {
      setAssignedCounts({})
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Support ?edit=<id> — auto-open editor when navigated from AllProductsView
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || products.length === 0) return
    const target = products.find(p => p.id === editId)
    if (target) {
      setEditing(target)
      setShowForm(true)
      // Clear the param so a refresh doesn't re-open
      const next = new URLSearchParams(searchParams)
      next.delete('edit')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, products, setSearchParams])

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setSlugTouched(false)
    setShowForm(true)
  }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name: p.name, slug: p.slug || '', type: p.type, price: p.price?.toString() || '',
      cover_image_url: p.cover_image_url || '',
      description: p.description || '', access_type: p.access_type || 'public',
      password: p.password || '', course_id: p.course_id || '',
      status: p.status, delivery_url: p.delivery_url || ''
    })
    setSlugTouched(true)
    setShowForm(true)
  }

  // Auto-fill slug from name unless touched
  const onNameChange = (name: string) => {
    setForm(p => ({ ...p, name, slug: slugTouched ? p.slug : slugify(name) }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const payload: any = {
      name: form.name,
      slug: form.slug || slugify(form.name) || null,
      type: form.type,
      price: parseInt(form.price) || 0,
      cover_image_url: form.cover_image_url || null,
      description: form.description || null,
      access_type: form.access_type,
      password: form.access_type === 'password' ? (form.password || null) : null,
      course_id: form.access_type === 'course' ? (form.course_id || null) : null,
      status: form.status,
      delivery_url: form.delivery_url || null,
    }
    // Surface errors — Supabase silently drops writes on RLS/schema violations otherwise.
    const { error } = editing
      ? await supabase.from('products').update(payload).eq('id', editing.id)
      : await supabase.from('products').insert(payload)
    setSaving(false)
    if (error) {
      alert(`Lưu sản phẩm thất bại: ${error.message}`)
      return
    }
    await load()
    setShowForm(false)
  }

  const handleDelete = async (id: string) => {
    const ok = await showConfirm({
      title: 'Xoá sản phẩm',
      message: 'Bạn có chắc chắn muốn xoá sản phẩm này? Hành động này không thể hoàn tác.',
      variant: 'danger',
      confirmText: 'Xoá',
    })
    if (!ok) return
    await supabase.from('products').delete().eq('id', id)
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  const toggleStatus = async (p: Product) => {
    const newStatus = p.status === 'active' ? 'draft' : 'active'
    await supabase.from('products').update({ status: newStatus }).eq('id', p.id)
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
  }

  const publicUrl = (slug: string | null) => slug ? `${window.location.origin}/p/${slug}` : null

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-gray-500 text-sm">{products.length} digital products</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          <Plus size={16} />Add Product
        </button>
      </div>

      <div className="space-y-3">
        {loading ? [...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />) :
         products.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl p-12 text-center">
            <Package size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Chưa có sản phẩm số nào</p>
            <button onClick={openAdd} className="mt-4 text-sm text-gray-400 hover:text-white transition-colors">+ Thêm sản phẩm đầu tiên</button>
          </div>
        ) : products.map(p => {
          const AccessIcon = ACCESS_OPTIONS.find(a => a.value === p.access_type)?.icon || Globe
          const url = publicUrl(p.slug)
          return (
            <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="text-sm font-medium text-white truncate">{p.name}</p>
                  <span className="text-xs px-1.5 py-0.5 bg-gray-800 border border-gray-700 text-gray-400 rounded">{TYPE_LABELS[p.type] || p.type}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${p.status === 'active' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-gray-500 bg-gray-800 border-gray-700'}`}>{p.status}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-400 flex items-center gap-1">
                    <AccessIcon size={10} />
                    {ACCESS_OPTIONS.find(a => a.value === p.access_type)?.label || p.access_type}
                    {p.access_type === 'assigned' && assignedCounts[p.id] !== undefined && (
                      <span className="ml-1 text-gray-500">({assignedCounts[p.id]})</span>
                    )}
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate">{p.description || 'No description'}</p>
                <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-mission-accent)' }}>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(p.price || 0)}</span>
                  {url && p.status === 'active' && (
                    <a href={url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors">
                      <Eye size={10} />Xem trang public
                    </a>
                  )}
                  {p.delivery_url && (
                    <a href={p.delivery_url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors">
                      <ExternalLink size={10} />Delivery URL
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleStatus(p)} className="p-1.5 text-gray-500 hover:text-emerald-400 transition-colors">
                  {p.status === 'active' ? <ToggleRight size={18} className="text-emerald-400" /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => openEdit(p)} className="p-1.5 text-gray-500 hover:text-white transition-colors"><Edit2 size={14} /></button>
                <button onClick={() => handleDelete(p.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-lg font-semibold text-white">{editing ? 'Edit Product' : 'Add Digital Product'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="overflow-y-auto p-5 space-y-4 flex-1">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tên sản phẩm *</label>
                <input value={form.name} onChange={e => onNameChange(e.target.value)} required placeholder="Ebook 7 Bước Viết Content" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Slug (URL: /p/...)</label>
                <input value={form.slug} onChange={e => { setForm(p => ({ ...p, slug: e.target.value })); setSlugTouched(true) }}
                  placeholder="ebook-7-buoc"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none font-mono" />
                {form.slug && (
                  <p className="text-xs text-gray-600 mt-1">URL: <span className="text-gray-500">{window.location.origin}/p/{form.slug}</span></p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Loại</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none">
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Giá (VND)</label>
                  <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="990000" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Ảnh bìa URL</label>
                <input value={form.cover_image_url} onChange={e => setForm(p => ({ ...p, cover_image_url: e.target.value }))} placeholder="https://..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Mô tả ngắn</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Mô tả ngắn về tài nguyên..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none" />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Link tài nguyên *</label>
                <input value={form.delivery_url} onChange={e => setForm(p => ({ ...p, delivery_url: e.target.value }))}
                  placeholder="https://drive.google.com/... hoặc https://..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
                <p className="text-xs text-gray-600 mt-1">Link sẽ hiển thị dưới dạng nút CTA trên trang sản phẩm</p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-2">Quyền truy cập</label>
                <div className="grid grid-cols-2 gap-2">
                  {ACCESS_OPTIONS.map(opt => {
                    const Icon = opt.icon
                    const selected = form.access_type === opt.value
                    return (
                      <button type="button" key={opt.value}
                        onClick={() => setForm(p => ({ ...p, access_type: opt.value }))}
                        className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${selected ? 'border-gray-500 bg-gray-800' : 'border-gray-800 bg-gray-900 hover:bg-gray-800'}`}>
                        <Icon size={16} className={selected ? 'text-white mt-0.5' : 'text-gray-500 mt-0.5'} />
                        <div>
                          <p className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-300'}`}>{opt.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{opt.hint}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {form.access_type === 'password' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Mật khẩu truy cập</label>
                  <input type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="vd: 2024" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
                </div>
              )}

              {form.access_type === 'course' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Khóa học áp dụng</label>
                  <select value={form.course_id} onChange={e => setForm(p => ({ ...p, course_id: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none">
                    <option value="">-- Chọn khóa học --</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              )}

              {form.access_type === 'assigned' && editing && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Người được gán</label>
                  <button type="button" onClick={() => setShowAssignManager(true)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors">
                    <span className="flex items-center gap-2"><Users size={14} />Quản lý truy cập</span>
                    <span className="text-gray-500">{assignedCounts[editing.id] || 0} người</span>
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">Trạng thái</label>
                <button type="button" onClick={() => setForm(p => ({ ...p, status: p.status === 'active' ? 'draft' : 'active' }))}
                  className={`flex items-center gap-2 text-sm ${form.status === 'active' ? 'text-emerald-400' : 'text-gray-500'}`}>
                  {form.status === 'active' ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  {form.status === 'active' ? 'Active' : 'Draft'}
                </button>
              </div>
            </form>
            <div className="flex gap-3 p-5 border-t border-gray-800">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white transition-colors">Cancel</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
              >{saving ? 'Saving...' : (editing ? 'Update' : 'Add Product')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Manager Modal */}
      {showAssignManager && editing && (
        <AssignManager product={editing} onClose={() => { setShowAssignManager(false); load() }} />
      )}
    </div>
  )
}

// --- Assign Manager subcomponent ---
interface AssignManagerProps {
  product: Product
  onClose: () => void
}

const AssignManager: React.FC<AssignManagerProps> = ({ product, onClose }) => {
  const [assigned, setAssigned] = useState<CustomerProduct[]>([])
  const [allCustomers, setAllCustomers] = useState<Array<{ id: string; email: string; display_name: string }>>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [list, { data: custs }] = await Promise.all([
      fetchCustomersForProduct(product.id),
      supabase.from('customers').select('id, email, display_name').order('created_at', { ascending: false }).limit(200)
    ])
    setAssigned(list)
    setAllCustomers(custs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [product.id])

  const assignedIds = new Set(assigned.map(a => a.customer_id))

  const handleGrant = async (customerId: string) => {
    await grantProductToCustomer(customerId, product.id)
    await load()
  }
  const handleRevoke = async (customerId: string) => {
    await revokeProductFromCustomer(customerId, product.id)
    await load()
  }

  const filteredAvail = allCustomers.filter(c =>
    !assignedIds.has(c.id) &&
    (search === '' || c.display_name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <h3 className="text-lg font-semibold text-white">Quản lý truy cập</h3>
            <p className="text-xs text-gray-500">{product.name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <section>
            <h4 className="text-xs uppercase text-gray-500 mb-2">Đã gán ({assigned.length})</h4>
            {loading ? (
              <div className="text-gray-500 text-sm">Đang tải...</div>
            ) : assigned.length === 0 ? (
              <p className="text-xs text-gray-600">Chưa có ai được gán</p>
            ) : (
              <div className="space-y-1.5">
                {assigned.map(a => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{a.customer?.display_name || '(no name)'}</p>
                      <p className="text-xs text-gray-500 truncate">{a.customer?.email}</p>
                    </div>
                    <button onClick={() => handleRevoke(a.customer_id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className="text-xs uppercase text-gray-500 mb-2">Thêm khách hàng</h4>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc email..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {filteredAvail.slice(0, 50).map(c => (
                <div key={c.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{c.display_name || '(no name)'}</p>
                    <p className="text-xs text-gray-500 truncate">{c.email}</p>
                  </div>
                  <button onClick={() => handleGrant(c.id)}
                    className="px-3 py-1 text-xs font-semibold rounded-lg hover:opacity-90"
                    style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>
                    Gán
                  </button>
                </div>
              ))}
              {filteredAvail.length === 0 && (
                <p className="text-xs text-gray-600 py-2">Không tìm thấy khách hàng phù hợp</p>
              )}
            </div>
          </section>
        </div>

        <div className="p-5 border-t border-gray-800">
          <button onClick={onClose} className="w-full py-2 text-sm font-semibold rounded-lg hover:opacity-90"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>Xong</button>
        </div>
      </div>
    </div>
  )
}

export default DigitalProducts
