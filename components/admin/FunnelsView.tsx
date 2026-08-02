import React, { useEffect, useState } from 'react'
import { Plus, RefreshCw, ExternalLink, Edit2, Trash2, X, Filter, GripVertical } from 'lucide-react'
import { supabase } from '../../services/supabase'

interface Funnel {
  id: string
  slug: string
  name: string
  description: string | null
  url: string
  type: 'sales' | 'leads' | 'webinar' | 'booking' | 'challenge' | 'other'
  course_id: string | null
  product_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  sales: 'Sales',
  leads: 'Leads',
  webinar: 'Webinar',
  booking: 'Booking',
  challenge: 'Challenge',
  other: 'Khác',
}

const TYPE_COLORS: Record<string, string> = {
  sales:     'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  leads:     'bg-blue-900/40 text-blue-300 border-blue-700/50',
  webinar:   'bg-purple-900/40 text-purple-300 border-purple-700/50',
  booking:   'bg-amber-900/40 text-amber-300 border-amber-700/50',
  challenge: 'bg-pink-900/40 text-pink-300 border-pink-700/50',
  other:     'bg-gray-800 text-gray-400 border-gray-700',
}

interface FunnelsViewProps {
  /** Khi nhúng vào trang khác (Affiliate) → bỏ padding ngoài, chỉ giữ nội dung */
  embedded?: boolean
}

export default function FunnelsView({ embedded = false }: FunnelsViewProps = {}) {
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Funnel | null>(null)
  const [filterType, setFilterType] = useState<string>('')

  const [form, setForm] = useState({
    slug: '', name: '', description: '', url: '',
    type: 'sales' as Funnel['type'],
    sort_order: 0, is_active: true,
  })
  const [saving, setSaving] = useState(false)

  const accent = { color: 'var(--color-mission-accent)' }
  const accentBg = { backgroundColor: 'var(--color-mission-accent)', color: '#000' }

  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/funnels', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    const json = await res.json()
    setFunnels(json.funnels || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ slug: '', name: '', description: '', url: '', type: 'sales', sort_order: 0, is_active: true })
    setShowForm(true)
  }

  const openEdit = (f: Funnel) => {
    setEditing(f)
    setForm({
      slug: f.slug, name: f.name, description: f.description || '', url: f.url,
      type: f.type, sort_order: f.sort_order, is_active: f.is_active,
    })
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.url || !form.slug) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const body = editing ? { id: editing.id, ...form } : form
    const res = await fetch('/api/admin/funnels', {
      method:  editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body:    JSON.stringify(body),
    })
    if (res.ok) {
      setShowForm(false)
      setEditing(null)
      load()
    } else {
      const err = await res.json()
      alert(err.error || 'Lỗi')
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Xóa funnel này? Affiliate sẽ không còn thấy link.')) return
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`/api/admin/funnels?id=${id}`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    load()
  }

  const toggleActive = async (f: Funnel) => {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/admin/funnels', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body:    JSON.stringify({ id: f.id, is_active: !f.is_active }),
    })
    load()
  }

  const filtered = filterType ? funnels.filter(f => f.type === filterType) : funnels

  return (
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-6'}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Funnels Registry</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Danh sách các funnel đang chạy — Affiliate sẽ thấy share links tương ứng
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium" style={accentBg}>
              <Plus size={14} /> Thêm Funnel
            </button>
            <button onClick={load} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Funnels đăng ký ở đây sẽ tự xuất hiện trong dashboard của affiliate cùng share link
          </p>
          <div className="flex gap-2">
            <button onClick={openCreate} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium" style={accentBg}>
              <Plus size={12} /> Thêm Funnel
            </button>
            <button onClick={load} className="p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Filter by type */}
      <div className="flex gap-2 items-center text-xs">
        <Filter size={12} className="text-gray-500" />
        <button
          onClick={() => setFilterType('')}
          className={`px-2 py-1 rounded-md border transition-colors ${
            !filterType ? 'border-gray-400 text-white bg-gray-800' : 'border-gray-700 text-gray-500'
          }`}
        >
          Tất cả ({funnels.length})
        </button>
        {Object.entries(TYPE_LABELS).map(([key, label]) => {
          const count = funnels.filter(f => f.type === key).length
          if (count === 0) return null
          return (
            <button
              key={key}
              onClick={() => setFilterType(filterType === key ? '' : key)}
              className={`px-2 py-1 rounded-md border transition-colors ${
                filterType === key ? 'border-gray-400 text-white bg-gray-800' : 'border-gray-700 text-gray-500'
              }`}
            >
              {label} ({count})
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-gray-500 text-sm text-center py-8">Đang tải...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm mb-3">
            {funnels.length === 0
              ? 'Chưa có funnel nào. Thêm funnel đầu tiên để affiliate share được.'
              : 'Không có funnel nào trong filter này.'}
          </p>
          {funnels.length === 0 && (
            <button onClick={openCreate} className="text-sm px-3 py-1.5 rounded-lg" style={accentBg}>
              + Thêm Funnel
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(f => (
            <div
              key={f.id}
              className={`bg-gray-900 border rounded-xl p-4 transition-colors ${
                f.is_active ? 'border-gray-800' : 'border-gray-800 opacity-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <GripVertical size={14} className="text-gray-700 mt-1 shrink-0" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-sm font-semibold text-white truncate">{f.name}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_COLORS[f.type]}`}>
                      {TYPE_LABELS[f.type]}
                    </span>
                    <span className="text-[10px] font-mono text-gray-500">{f.slug}</span>
                    {!f.is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-700">
                        Tạm ẩn
                      </span>
                    )}
                  </div>

                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1 truncate"
                  >
                    {f.url} <ExternalLink size={11} />
                  </a>

                  {f.description && (
                    <p className="text-xs text-gray-500 mt-1.5">{f.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(f)}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors text-[10px]"
                    title={f.is_active ? 'Tạm ẩn' : 'Kích hoạt lại'}
                  >
                    {f.is_active ? 'Ẩn' : 'Bật'}
                  </button>
                  <button
                    onClick={() => openEdit(f)}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                    title="Sửa"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/40 rounded transition-colors"
                    title="Xóa"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">{editing ? 'Sửa Funnel' : 'Thêm Funnel mới'}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">Tên hiển thị *</label>
                <input
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="VD: Khóa học TikTok Ads Pro"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Slug (unique) *</label>
                  <input
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    placeholder="khoa-tiktok"
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Loại funnel</label>
                  <select
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as Funnel['type'] }))}
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">URL funnel *</label>
                <input
                  required
                  type="url"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="https://funnel-tiktok.vercel.app"
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Affiliate sẽ share: <code className="text-gray-400">{form.url || '[url]'}/?ref=CODE</code>
                </p>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">Mô tả ngắn (cho affiliate biết quảng bá gì)</label>
                <textarea
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="VD: Khóa học 30 ngày dạy chạy TikTok Ads từ 0 — giá 1.997k, hoa hồng 30%"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Thứ tự hiển thị</label>
                  <input
                    type="number"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="rounded"
                    />
                    Active (affiliate thấy được)
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={accentBg}
              >
                {saving ? 'Đang lưu...' : (editing ? 'Cập nhật' : 'Tạo Funnel')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
