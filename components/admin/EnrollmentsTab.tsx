import React, { useEffect, useState } from 'react'
import { Plus, X, BookOpen, ChevronDown } from 'lucide-react'
import { fetchCourses, fetchEnrollmentsByCustomer, enrollCustomer, unenrollCustomer } from '../../services/api'
import { Course, CustomerCourse } from '../../types'
import { format } from 'date-fns'
import { useDialog } from '../../contexts/DialogContext'

const EnrollmentsTab: React.FC<{ customerId: string }> = ({ customerId }) => {
  const { confirm: showConfirm } = useDialog()
  const [enrollments, setEnrollments] = useState<CustomerCourse[]>([])
  const [allCourses, setAllCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newEnroll, setNewEnroll] = useState({ course_id: '', cohort: '', start_date: new Date().toISOString().split('T')[0] })
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    const [e, c] = await Promise.all([
      fetchEnrollmentsByCustomer(customerId),
      fetchCourses()
    ])
    setEnrollments(e)
    setAllCourses(c.filter(x => x.status === 'active'))
    setLoading(false)
  }
  useEffect(() => { load() }, [customerId])

  const enrolledCourseIds = new Set(enrollments.map(e => e.course_id))
  const availableCourses = allCourses.filter(c => !enrolledCourseIds.has(c.id))

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEnroll.course_id) return
    setSubmitting(true)
    await enrollCustomer({
      customer_id: customerId,
      course_id: newEnroll.course_id,
      cohort: newEnroll.cohort || undefined,
      start_date: newEnroll.start_date || undefined,
    })
    await load()
    setShowAdd(false)
    setNewEnroll({ course_id: '', cohort: '', start_date: new Date().toISOString().split('T')[0] })
    setSubmitting(false)
  }

  const handleUnenroll = async (courseId: string, courseTitle: string) => {
    const ok = await showConfirm({
      title: 'Huỷ đăng ký',
      message: `Huỷ đăng ký khoá "${courseTitle}" cho học viên này?`,
      variant: 'warning',
      confirmText: 'Huỷ đăng ký',
    })
    if (!ok) return
    await unenrollCustomer(customerId, courseId)
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{enrollments.length} khóa học đã đăng ký</span>
        {availableCourses.length > 0 && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg hover:opacity-90"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>
            <Plus size={12} />Thêm
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />)}</div>
      ) : enrollments.length === 0 ? (
        <div className="bg-gray-800 border border-gray-700 border-dashed rounded-xl p-6 text-center">
          <BookOpen size={24} className="text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">Chưa đăng ký khóa học nào</p>
        </div>
      ) : (
        enrollments.map(e => {
          const STATUS_LABELS = { active: 'Đang học', completed: 'Đã hoàn thành', paused: 'Tạm dừng' } as Record<string, string>
          const STATUS_COLORS = { active: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', completed: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20', paused: 'text-amber-400 bg-amber-400/10 border-amber-400/20' } as Record<string, string>
          return (
            <div key={e.id} className="bg-gray-800 border border-gray-700 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{e.course?.title || 'Khóa học không tồn tại'}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                    {e.cohort && <span>Khóa {e.cohort}</span>}
                    {e.start_date && <span>Bắt đầu: {format(new Date(e.start_date), 'dd/MM/yyyy')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                  <button onClick={() => handleUnenroll(e.course_id, e.course?.title || '')}
                    className="p-1 text-gray-500 hover:text-red-400" title="Hủy enroll">
                    <X size={12} />
                  </button>
                </div>
              </div>
            </div>
          )
        })
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">Thêm khóa học</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={handleEnroll} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Khóa học *</label>
                <div className="relative">
                  <select value={newEnroll.course_id} onChange={ev => setNewEnroll(p => ({ ...p, course_id: ev.target.value }))}
                    required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white appearance-none focus:outline-none">
                    <option value="">-- Chọn khóa --</option>
                    {availableCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Cohort</label>
                  <input value={newEnroll.cohort} onChange={ev => setNewEnroll(p => ({ ...p, cohort: ev.target.value }))} placeholder="K1"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Ngày bắt đầu</label>
                  <input type="date" value={newEnroll.start_date} onChange={ev => setNewEnroll(p => ({ ...p, start_date: ev.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white">Hủy</button>
                <button type="submit" disabled={submitting || !newEnroll.course_id} className="flex-1 py-2 text-sm font-semibold rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}>{submitting ? 'Đang thêm...' : 'Đăng ký'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default EnrollmentsTab
