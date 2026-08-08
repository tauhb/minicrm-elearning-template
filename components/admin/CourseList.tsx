import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, BookOpen, Users, Layers, X } from 'lucide-react'
import { fetchCoursesWithStats, createCourse } from '../../services/api'
import { Course } from '../../types'

interface CourseWithStats extends Course {
  zone_count: number
  quest_count: number
  enrolled_count: number
}

const CourseList: React.FC = () => {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<CourseWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newCourse, setNewCourse] = useState({ title: '' })
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    const data = await fetchCoursesWithStats()
    setCourses(data as CourseWithStats[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setCreating(true)
    try {
      const created = await createCourse({ ...newCourse, duration_days: 35, price: 0 })
      setCreating(false); setShowAdd(false); setNewCourse({ title: '' })
      if (created) navigate(`/admin/products/courses/${created.id}?tab=settings`)
      else load()
    } catch (e: any) {
      setCreating(false)
      alert(e.message || 'Tạo khoá học thất bại')
    }
  }

  const STATUS_LABELS: Record<string, string> = { active: 'Đang chạy', draft: 'Bản nháp', archived: 'Đã lưu trữ' }
  const STATUS_COLORS: Record<string, string> = {
    active: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    draft: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
    archived: 'text-gray-500 bg-gray-700 border-gray-600',
  }
  const VND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <p className="text-gray-500 text-sm">{courses.length} khóa học</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>
          <Plus size={16} />Tạo khóa học mới
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : courses.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl p-12 text-center">
          <BookOpen size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Chưa có khóa học nào</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map(c => (
            <div key={c.id} onClick={() => navigate(`/admin/products/courses/${c.id}`)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 cursor-pointer hover:border-gray-700 transition-all group">
              {c.cover_image_url && (
                <img src={c.cover_image_url} alt={c.title} className="w-full h-32 object-cover rounded-lg mb-3" />
              )}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-white group-hover:opacity-80 transition-opacity flex-1 line-clamp-2">{c.title}</h3>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 mb-3 min-h-[2rem]">{c.description || '—'}</p>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-gray-400">
                  <span className="flex items-center gap-1"><Layers size={11} />{c.zone_count} zones</span>
                  <span className="flex items-center gap-1"><BookOpen size={11} />{c.quest_count} bài</span>
                  <span className="flex items-center gap-1"><Users size={11} />{c.enrolled_count}</span>
                </div>
                <span className="font-semibold" style={{ color: 'var(--color-mission-accent)' }}>{c.price > 0 ? VND(c.price) : 'Free'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Tạo khóa học mới</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tên khóa học *</label>
                <input
                  value={newCourse.title}
                  onChange={e => setNewCourse(p => ({ ...p, title: e.target.value }))}
                  required
                  autoFocus
                  placeholder="VD: MiniCRM 33 ngày"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                />
                <p className="text-[11px] text-gray-600 mt-1.5">Điền tên rồi bấm Tạo — các thông tin khác (giá, thumbnail...) cấu hình trong tab CẤU HÌNH</p>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowAdd(false); setNewCourse({ title: '' }) }} className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white">Hủy</button>
                <button type="submit" disabled={creating} className="flex-1 py-2 text-sm font-semibold rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>{creating ? 'Đang tạo...' : 'Tạo & Mở'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
export default CourseList
