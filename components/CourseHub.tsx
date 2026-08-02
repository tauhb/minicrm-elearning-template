import React, { useEffect, useState } from 'react'
import { BookOpen, Package, ChevronRight, Clock, Lock, ExternalLink, Loader2 } from 'lucide-react'
import { fetchEnrollmentsByCustomer, fetchProductsAssignedTo } from '../services/api'
import { CustomerCourse, CustomerProduct } from '../types'
import { useConfig } from '../contexts/ConfigContext'

interface Props {
  customerId: string
  onSelectCourse: (enrollment: CustomerCourse) => void
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Đang học',
  completed: 'Hoàn thành',
  paused: 'Tạm dừng',
}
const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  completed: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  paused: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
}

const TYPE_LABELS: Record<string, string> = {
  ebook: 'Ebook', template: 'Template', toolkit: 'Toolkit',
  video: 'Video', other: 'Tài liệu',
}

const CourseHub: React.FC<Props> = ({ customerId, onSelectCourse }) => {
  const { settings } = useConfig()
  const [enrollments, setEnrollments] = useState<CustomerCourse[]>([])
  const [products, setProducts] = useState<CustomerProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchEnrollmentsByCustomer(customerId),
      fetchProductsAssignedTo(customerId),
    ]).then(([enrs, prods]) => {
      setEnrollments(enrs)
      setProducts(prods)
      setLoading(false)
    })
  }, [customerId])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin t-text-muted" size={28} />
      </div>
    )
  }

  const appName = settings?.title || 'Portal'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Greeting */}
        <div className="mb-10">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] t-text-muted mb-2">
            {appName}
          </p>
          <h1 className="text-2xl font-bold t-text">Khoá học của bạn</h1>
        </div>

        {/* === COURSES === */}
        {enrollments.length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={14} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-mission-accent)' }}>
                Khoá học ({enrollments.length})
              </h2>
            </div>

            <div className="space-y-3">
              {enrollments.map(enr => {
                const course = enr.course
                const isActive = enr.status === 'active'
                return (
                  <button
                    key={enr.id}
                    onClick={() => isActive && onSelectCourse(enr)}
                    disabled={!isActive}
                    className={`w-full text-left rounded-sm border t-border transition-all group ${
                      isActive
                        ? 't-surface hover:t-surface-2 cursor-pointer'
                        : 't-surface opacity-60 cursor-not-allowed'
                    }`}
                    style={{
                      backgroundColor: isActive ? 'var(--theme-surface)' : 'var(--theme-surface)',
                      borderColor: 'var(--theme-border)',
                    }}
                    onMouseEnter={isActive ? e => (e.currentTarget.style.backgroundColor = 'var(--theme-surface-2)') : undefined}
                    onMouseLeave={isActive ? e => (e.currentTarget.style.backgroundColor = 'var(--theme-surface)') : undefined}
                  >
                    <div className="flex items-start gap-4 p-4">
                      {/* Thumbnail */}
                      <div
                        className="shrink-0 w-16 h-16 rounded-sm flex items-center justify-center text-2xl font-black font-mono overflow-hidden"
                        style={{
                          background: course?.cover_image_url
                            ? undefined
                            : 'rgba(var(--color-mission-accent-rgb,182,255,0),0.1)',
                          color: 'var(--color-mission-accent)',
                          border: '1px solid rgba(var(--color-mission-accent-rgb,182,255,0),0.2)',
                        }}
                      >
                        {course?.cover_image_url
                          ? <img src={course.cover_image_url} alt="" className="w-full h-full object-cover" />
                          : (course?.title?.[0] || '?')
                        }
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold t-text group-hover:opacity-80 transition-opacity line-clamp-1">
                            {course?.title || 'Khoá học'}
                          </h3>
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[enr.status] || ''}`}>
                            {STATUS_LABELS[enr.status] || enr.status}
                          </span>
                        </div>
                        <p className="text-xs t-text-muted mt-0.5 line-clamp-1">
                          {course?.description || ''}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] t-text-subtle">
                          {enr.cohort && <span className="font-mono">{enr.cohort}</span>}
                          {enr.start_date && (
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              Bắt đầu {new Date(enr.start_date).toLocaleDateString('vi-VN')}
                            </span>
                          )}
                          {course?.duration_days && (
                            <span>{course.duration_days} ngày</span>
                          )}
                        </div>
                      </div>

                      {isActive && (
                        <ChevronRight size={16} className="shrink-0 t-text-subtle group-hover:t-text-muted transition-colors mt-1" />
                      )}
                      {!isActive && <Lock size={14} className="shrink-0 t-text-subtle mt-1" />}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* === DIGITAL PRODUCTS === */}
        {products.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Package size={14} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-mission-accent)' }}>
                Sản phẩm số ({products.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map(cp => {
                const p = cp.product
                if (!p) return null
                const href = p.slug ? `/p/${p.slug}` : null
                return (
                  <a
                    key={cp.id}
                    href={href || '#'}
                    target={href ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="block rounded-sm border p-4 transition-all group"
                    style={{
                      backgroundColor: 'var(--theme-surface)',
                      borderColor: 'var(--theme-border)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--theme-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--theme-surface)')}
                  >
                    {p.cover_image_url ? (
                      <img src={p.cover_image_url} alt={p.name} className="w-full h-28 object-cover rounded-sm mb-3" />
                    ) : (
                      <div
                        className="w-full h-24 rounded-sm mb-3 flex items-center justify-center"
                        style={{ backgroundColor: 'var(--theme-surface-2)', borderColor: 'var(--theme-border)', border: '1px solid' }}
                      >
                        <Package size={28} style={{ color: 'var(--color-mission-accent)', opacity: 0.5 }} />
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--color-mission-accent)' }}>
                          {TYPE_LABELS[p.type] || p.type}
                        </p>
                        <h3 className="text-sm font-semibold t-text line-clamp-2 group-hover:opacity-80 transition-opacity">
                          {p.name}
                        </h3>
                        {p.description && (
                          <p className="text-xs t-text-muted mt-1 line-clamp-2">{p.description}</p>
                        )}
                      </div>
                      {href && <ExternalLink size={13} className="shrink-0 t-text-subtle group-hover:t-text-muted mt-0.5 transition-colors" />}
                    </div>
                  </a>
                )
              })}
            </div>
          </section>
        )}

        {/* Empty state */}
        {enrollments.length === 0 && products.length === 0 && (
          <div
            className="text-center py-20 rounded-sm border"
            style={{ borderColor: 'var(--theme-border)', borderStyle: 'dashed' }}
          >
            <BookOpen size={32} className="mx-auto mb-3 t-text-subtle" />
            <p className="t-text-muted text-sm">Bạn chưa được đăng ký khoá học nào</p>
            <p className="t-text-subtle text-xs mt-1">Liên hệ admin để được cấp quyền truy cập</p>
          </div>
        )}

      </div>
    </div>
  )
}

export default CourseHub
