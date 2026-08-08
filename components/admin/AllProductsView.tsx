// components/admin/AllProductsView.tsx
// Unified "Sản phẩm" list — courses + products tables UNION into one grid.
// Add modal has type radio → routes create to the right table:
//   type='course' → courses table (rich editor with modules/lessons)
//   otherwise    → products table (name/price/description/delivery)
//
// Backend stays split (2 tables) — no data migration, no FK churn on
// funnel_steps.assigned_product_id / customer_courses / payments. UI only.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Package, BookOpen, FileText, Layout as LayoutIcon, Users as UsersIcon, HeadphonesIcon, Box, Loader2, ExternalLink } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { createCourse } from '../../services/api'
import EmptyState from './EmptyState'

// ── Product type registry ────────────────────────────────────────────────────
// `route` decides which underlying table the create modal writes to.
// `course` → `courses` (rich editor with modules/lessons).
// Everything else → `products` (single row with type as the sub-kind).
type ProductType = 'course' | 'mini-course' | 'ebook' | 'template' | 'membership' | 'coaching' | 'service' | 'bundle' | 'saas' | 'other'

const TYPE_META: Record<ProductType, { label: string; icon: React.ElementType; route: 'course' | 'product' }> = {
  'course':       { label: 'Khoá học',        icon: BookOpen,       route: 'course' },
  'mini-course':  { label: 'Mini course',     icon: BookOpen,       route: 'product' },
  'ebook':        { label: 'Ebook / PDF',     icon: FileText,       route: 'product' },
  'template':     { label: 'Template pack',   icon: LayoutIcon,     route: 'product' },
  'membership':   { label: 'Membership',      icon: UsersIcon,      route: 'product' },
  'coaching':     { label: 'Coaching 1-1',    icon: HeadphonesIcon, route: 'product' },
  'service':      { label: 'Dịch vụ',         icon: HeadphonesIcon, route: 'product' },
  'bundle':       { label: 'Bundle / Combo',  icon: Box,            route: 'product' },
  'saas':         { label: 'SaaS / Access',   icon: Box,            route: 'product' },
  'other':        { label: 'Khác',            icon: Package,        route: 'product' },
}

interface UnifiedProduct {
  id: string
  name: string
  price: number
  type: string                     // 'course' for courses table; original .type for products
  source: 'course' | 'product'     // which table it lives in
  status: string
  created_at: string
  editor_path: string              // navigate() target for editing
}

const VND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
const STATUS_LABEL: Record<string, string> = { active: 'Đang bán', draft: 'Bản nháp', archived: 'Lưu trữ' }
const STATUS_CLASS: Record<string, string> = {
  active:   'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  draft:    'text-amber-400 bg-amber-400/10 border-amber-400/20',
  archived: 'text-gray-500 bg-gray-700 border-gray-600',
}

export default function AllProductsView() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<UnifiedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: courses }, { data: prods }] = await Promise.all([
      supabase.from('courses').select('id, title, price, status, created_at').order('created_at', { ascending: false }),
      supabase.from('products').select('id, name, price, type, status, created_at').order('created_at', { ascending: false }),
    ])
    const unified: UnifiedProduct[] = [
      ...((courses || []) as any[]).map(c => ({
        id: c.id, name: c.title, price: c.price || 0, type: 'course', source: 'course' as const,
        status: c.status, created_at: c.created_at,
        editor_path: `/admin/products/courses/${c.id}?tab=settings`,
      })),
      ...((prods || []) as any[]).map(p => ({
        id: p.id, name: p.name, price: p.price || 0, type: p.type || 'other', source: 'product' as const,
        status: p.status, created_at: p.created_at,
        editor_path: `/admin/products/digital?edit=${p.id}`,
      })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at))
    setRows(unified); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => rows.filter(r => {
    const q = search.trim().toLowerCase()
    if (q && !r.name.toLowerCase().includes(q)) return false
    if (typeFilter && r.type !== typeFilter) return false
    return true
  }), [rows, search, typeFilter])

  return (
    <div className="p-8">
      {/* Header + create */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Sản phẩm</h1>
          <p className="text-sm text-gray-500 mt-0.5">{rows.length} sản phẩm · khoá học + số + dịch vụ</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          style={{ background: 'var(--color-mission-accent)', color: '#000' }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={14} /> Thêm sản phẩm
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm theo tên..."
            className="w-full pl-8 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white">
          <option value="">Tất cả loại</option>
          {(Object.keys(TYPE_META) as ProductType[]).map(t => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Chưa có sản phẩm nào"
            description="Tạo sản phẩm đầu tiên (khoá học, ebook, template, membership...) để có thứ bán qua funnel."
            cta={{ label: 'Thêm sản phẩm', icon: Plus, onClick: () => setShowAdd(true) }}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="Không tìm thấy sản phẩm"
            description="Thử bỏ bộ lọc hoặc đổi từ khoá tìm kiếm."
            cta={{ label: 'Xoá bộ lọc', onClick: () => { setSearch(''); setTypeFilter('') } }}
          />
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(r => {
            const meta = TYPE_META[r.type as ProductType] || TYPE_META.other
            const Icon = meta.icon
            return (
              <button key={`${r.source}-${r.id}`} onClick={() => navigate(r.editor_path)}
                className="text-left bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition group">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 flex items-center justify-center rounded bg-gray-800 text-gray-400 group-hover:text-white">
                    <Icon size={14} />
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_CLASS[r.status] || STATUS_CLASS.draft}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </div>
                <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{meta.label}</span>
                  <span className="text-xs text-gray-400">{r.price > 0 ? VND(r.price) : 'Free'}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-[11px] text-gray-500 group-hover:text-white transition">
                  Chỉnh sửa <ExternalLink size={10} />
                </div>
              </button>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddProductModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}

// ── Add modal — routes to courses or products based on chosen type ───────────
function AddProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate()
  const [type, setType] = useState<ProductType>('course')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('0')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = TYPE_META[type]

  const save = async () => {
    if (!name.trim()) { setError('Tên sản phẩm bắt buộc'); return }
    setSaving(true); setError(null)
    try {
      if (meta.route === 'course') {
        // Route to courses table (uses createCourse which throws on error now)
        const created = await createCourse({
          title: name.trim(),
          description: description.trim() || undefined,
          price: parseInt(price) || 0,
          status: 'draft',
        })
        setSaving(false)
        if (created) {
          onCreated()
          navigate(`/admin/products/courses/${created.id}?tab=settings`)
        } else {
          onCreated()
        }
      } else {
        // Route to products table
        const slug = (name.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 50) || 'product') + '-' + Date.now().toString(36)
        const { data, error: insErr } = await supabase.from('products').insert({
          name: name.trim(),
          slug,
          type,
          price: parseInt(price) || 0,
          description: description.trim() || null,
          status: 'draft',
        }).select('id').single()
        setSaving(false)
        if (insErr) { setError(`Tạo thất bại: ${insErr.message}`); return }
        onCreated()
        if (data?.id) navigate(`/admin/products/digital?edit=${data.id}`)
      }
    } catch (e: any) {
      setSaving(false); setError(e.message || 'Không tạo được')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Thêm sản phẩm</h2>
            <p className="text-xs text-gray-500 mt-0.5">Chọn loại → điền thông tin cơ bản → tạo. Chi tiết edit ở bước sau.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Loại sản phẩm</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {(Object.keys(TYPE_META) as ProductType[]).map(t => {
              const m = TYPE_META[t]
              const Icon = m.icon
              const active = type === t
              return (
                <button key={t} onClick={() => setType(t)}
                  className="text-left px-3 py-2.5 rounded-lg border transition"
                  style={active
                    ? { borderColor: 'var(--color-mission-accent)', background: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.08)' }
                    : { borderColor: 'rgb(31,41,55)', background: 'transparent' }}>
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={active ? '' : 'text-gray-500'} style={active ? { color: 'var(--color-mission-accent)' } : {}} />
                    <span className={`text-sm font-medium ${active ? 'text-white' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5">{m.route === 'course' ? 'Full course editor' : 'Simple product'}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Tên *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Khoá 30-day AI Marketing"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Giá (VND)</label>
            <input type="number" value={price} onChange={e => setPrice(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white font-mono" />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Mô tả (tuỳ chọn)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white resize-none"
            placeholder="Mô tả ngắn để hiển thị ở funnel / cart" />
        </div>

        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white px-3">Huỷ</button>
          <button onClick={save} disabled={saving || !name.trim()}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
            {saving && <Loader2 size={13} className="animate-spin" />}
            <Plus size={13} /> Tạo {meta.route === 'course' ? '+ mở editor' : 'sản phẩm'}
          </button>
        </div>
      </div>
    </div>
  )
}
