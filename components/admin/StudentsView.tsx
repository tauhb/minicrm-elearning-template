import React, { useEffect, useState, useRef } from 'react'
import { Search, UserPlus, ChevronRight, X, Copy, Check, RefreshCw, Mail, KeyRound, Phone, MessageCircle, AtSign, Calendar } from 'lucide-react'
import { fetchStudents, fetchCourses, fetchCohortsForCourse, fetchLeads, fetchProducts } from '../../services/api'
import { Profile, Course, Lead, Product } from '../../types'
import { supabase } from '../../services/supabase'
import StudentDetailDrawer from './StudentDetailDrawer'


type EnrollmentBadge = { courseTitle: string; cohort: string | null }
type LastCare = { type: string; created_at: string }

// Relative time helper
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'Hôm nay'
  if (d === 1) return 'Hôm qua'
  if (d < 7) return `${d} ngày trước`
  if (d < 30) return `${Math.floor(d / 7)} tuần trước`
  if (d < 365) return `${Math.floor(d / 30)} tháng trước`
  return `${Math.floor(d / 365)} năm trước`
}

// Days since last care (for urgency color)
function daysSince(iso: string | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

const CARE_ICONS: Record<string, React.ReactNode> = {
  call:     <Phone size={11} />,
  zalo:     <MessageCircle size={11} />,
  email:    <AtSign size={11} />,
  meeting:  <Calendar size={11} />,
  note:     <Mail size={11} />,
  follow_up:<RefreshCw size={11} />,
}

const StudentsView: React.FC = () => {
  const [students, setStudents] = useState<Profile[]>([])
  const [enrollmentsMap, setEnrollmentsMap] = useState<Record<string, EnrollmentBadge[]>>({})
  const [careMap, setCareMap] = useState<Record<string, LastCare>>({})
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<Profile | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({
    email: '',
    display_name: '',
    enroll: false,
    course_id: '',
    cohort: '',
    start_date: new Date().toISOString().split('T')[0],
    grantProducts: false,
    selectedProductIds: [] as string[],
    convertLead: false,
    leadId: '',
  })
  const [cohortHints, setCohortHints] = useState<string[]>([])
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')

  // Email mode: magic_link | password
  const [emailMode, setEmailMode] = useState<'magic_link' | 'password'>('magic_link')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Credentials popup after success
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)
  const [credCopied, setCredCopied] = useState(false)

  // Lead search
  const [leadSearch, setLeadSearch] = useState('')
  const [leadResults, setLeadResults] = useState<Lead[]>([])
  const [leadSearching, setLeadSearching] = useState(false)
  const leadSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Products list
  const [products, setProducts] = useState<Product[]>([])

  const load = async () => {
    setLoading(true)
    const data = await fetchStudents({
      search: search || undefined,
      course_id: courseFilter || undefined,
      product_id: productFilter || undefined,
    })
    setStudents(data)

    // Build enrollment map + care map
    const ids = data.map(s => s.id)
    if (ids.length > 0) {
      const [enrollmentsRes, careRes] = await Promise.all([
        supabase
          .from('customer_courses')
          .select('customer_id, cohort, course:courses(title)')
          .in('customer_id', ids),
        supabase
          .from('care_history')
          .select('customer_id, type, created_at')
          .in('customer_id', ids)
          .order('created_at', { ascending: false }),
      ])

      // Enrollment map
      const enrollMap: Record<string, EnrollmentBadge[]> = {}
      ;(enrollmentsRes.data || []).forEach((row: any) => {
        if (!enrollMap[row.customer_id]) enrollMap[row.customer_id] = []
        enrollMap[row.customer_id].push({ courseTitle: row.course?.title || 'Khóa học', cohort: row.cohort })
      })
      setEnrollmentsMap(enrollMap)

      // Care map — chỉ giữ bản ghi mới nhất mỗi customer
      const cMap: Record<string, LastCare> = {}
      ;(careRes.data || []).forEach((row: any) => {
        if (!cMap[row.customer_id]) cMap[row.customer_id] = { type: row.type, created_at: row.created_at }
      })
      setCareMap(cMap)
    } else {
      setEnrollmentsMap({})
      setCareMap({})
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [search, courseFilter, productFilter])

  useEffect(() => {
    fetchCourses().then(setCourses)
    fetchProducts().then(setProducts)
  }, [])

  // Khi chọn course trong Add modal → load cohort hints
  useEffect(() => {
    if (addForm.enroll && addForm.course_id) {
      fetchCohortsForCourse(addForm.course_id).then(setCohortHints)
    } else {
      setCohortHints([])
    }
  }, [addForm.enroll, addForm.course_id])

  // Load products khi mở modal
  useEffect(() => {
    if (showAddModal) fetchProducts().then(setProducts)
  }, [showAddModal])

  // Lead search debounce
  useEffect(() => {
    if (!leadSearch || leadSearch.length < 2) { setLeadResults([]); return }
    if (leadSearchTimer.current) clearTimeout(leadSearchTimer.current)
    leadSearchTimer.current = setTimeout(async () => {
      setLeadSearching(true)
      const results = await fetchLeads(leadSearch)
      // Chỉ show KHTN chưa convert
      setLeadResults(results.filter(l => !l.converted_at).slice(0, 8))
      setLeadSearching(false)
    }, 350)
  }, [leadSearch])

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const special = '!@#$'
    let pwd = Array.from({ length: 9 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    pwd += special[Math.floor(Math.random() * special.length)]
    setPassword(pwd)
    setShowPassword(true)
  }

  const copyCredentials = () => {
    if (!createdCredentials) return
    navigator.clipboard.writeText(`Email: ${createdCredentials.email}\nMật khẩu: ${createdCredentials.password}`)
    setCredCopied(true)
    setTimeout(() => setCredCopied(false), 2000)
  }

  const handleAddStudent = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (emailMode === 'password' && !password) {
      setAddError('Vui lòng nhập hoặc tạo mật khẩu')
      return
    }
    setAddLoading(true)
    setAddError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.')

      const res = await fetch('/api/admin-create-customer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: addForm.email,
          display_name: addForm.display_name,
          role: 'student',
          email_mode: emailMode,
          password: emailMode === 'password' ? password : undefined,
          send_magic_link: emailMode === 'magic_link',
          enroll_course_id: addForm.enroll ? addForm.course_id : null,
          enroll_cohort: addForm.enroll ? (addForm.cohort || null) : null,
          enroll_start_date: addForm.enroll ? (addForm.start_date || null) : null,
          grant_product_ids: addForm.grantProducts ? addForm.selectedProductIds : [],
          convert_lead_id: addForm.leadId || null,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Tạo khách hàng thất bại')

      const savedEmail = addForm.email
      const savedPassword = password

      setShowAddModal(false)
      setAddForm({
        email: '', display_name: '', enroll: false, course_id: '',
        cohort: '', start_date: new Date().toISOString().split('T')[0],
        grantProducts: false, selectedProductIds: [], convertLead: false, leadId: '',
      })
      setLeadSearch('')
      setLeadResults([])
      setEmailMode('magic_link')
      setPassword('')

      // Nếu password mode → hiện credentials popup
      if (emailMode === 'password') {
        setCreatedCredentials({ email: savedEmail, password: savedPassword })
      }
      load()
    } catch (err: any) {
      console.error('Add student error:', err)
      setAddError(err?.message || 'Lỗi không xác định')
    } finally {
      setAddLoading(false)
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Khách hàng</h1>
          <p className="text-gray-500 text-sm mt-1">{students.length} học viên</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          <UserPlus size={16} />
          Thêm khách hàng
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm khách hàng..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:outline-none"
          />
        </div>
        <select
          value={courseFilter}
          onChange={e => { setCourseFilter(e.target.value); setProductFilter('') }}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none"
        >
          <option value="">Tất cả khóa học</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select
          value={productFilter}
          onChange={e => { setProductFilter(e.target.value); setCourseFilter('') }}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none"
        >
          <option value="">Tất cả sản phẩm</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Khách hàng</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Khoá học</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Ngày tham gia</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Chăm sóc gần nhất</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Tags</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-gray-800">
                  {[...Array(6)].map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-4 bg-gray-800 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : students.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-600 py-12">Không tìm thấy khách hàng</td>
              </tr>
            ) : students.map(student => {
              const enrollments = enrollmentsMap[student.id] || []
              const lastCare = careMap[student.id]
              const days = daysSince(lastCare?.created_at)
              // Màu urgency: đỏ = chưa có hoặc >14 ngày, vàng = 7-14 ngày, xanh = <7 ngày
              const careColor = days === null
                ? 'text-red-400 bg-red-400/10 border-red-400/20'
                : days > 14
                  ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                  : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'

              return (
                <tr
                  key={student.id}
                  onClick={() => setSelectedStudent(student)}
                  className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors"
                >
                  {/* Khách hàng */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          backgroundColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.12)',
                          borderColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.3)',
                          color: 'var(--color-mission-accent)',
                        }}
                      >
                        {student.display_name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{student.display_name}</p>
                        <p className="text-xs text-gray-500">{student.email}</p>
                      </div>
                    </div>
                  </td>

                  {/* Khoá học */}
                  <td className="px-5 py-4">
                    {enrollments.length === 0 ? (
                      <span className="text-gray-600 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {enrollments.slice(0, 2).map((e, idx) => (
                          <span key={idx} className="text-xs px-2 py-0.5 rounded border"
                            style={{
                              backgroundColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.08)',
                              borderColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.2)',
                              color: 'var(--color-mission-accent)',
                            }}>
                            {e.courseTitle}{e.cohort ? ` · ${e.cohort}` : ''}
                          </span>
                        ))}
                        {enrollments.length > 2 && <span className="text-xs text-gray-500">+{enrollments.length - 2}</span>}
                      </div>
                    )}
                  </td>

                  {/* Ngày tham gia */}
                  <td className="px-5 py-4">
                    <p className="text-xs text-gray-400">{timeAgo(student.created_at)}</p>
                  </td>

                  {/* Chăm sóc gần nhất */}
                  <td className="px-5 py-4">
                    {lastCare ? (
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${careColor}`}>
                        {CARE_ICONS[lastCare.type] || <Mail size={11} />}
                        {timeAgo(lastCare.created_at)}
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${careColor}`}>
                        Chưa có
                      </span>
                    )}
                  </td>

                  {/* Tags */}
                  <td className="px-5 py-4">
                    <div className="flex gap-1 flex-wrap">
                      {(student.tags || []).slice(0, 2).map(tag => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-800 border border-gray-700 text-gray-400 rounded">
                          {tag}
                        </span>
                      ))}
                      {(student.tags || []).length === 0 && <span className="text-gray-700 text-xs">—</span>}
                    </div>
                  </td>

                  <td className="px-5 py-4">
                    <ChevronRight size={14} className="text-gray-600" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Student Detail Drawer */}
      {selectedStudent && (
        <StudentDetailDrawer
          student={selectedStudent}
          onClose={() => setSelectedStudent(null)}
          onUpdate={(updated) => {
            setStudents(prev => prev.map(s => s.id === updated.id ? updated : s))
            setSelectedStudent(updated)
          }}
        />
      )}

      {/* Credentials popup */}
      {createdCredentials && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Check size={16} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Tạo khách hàng thành công</p>
                <p className="text-xs text-gray-500">Email có thông tin đăng nhập đã được gửi</p>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4 space-y-3 mb-4">
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-1">Email</p>
                <p className="text-sm text-white font-mono">{createdCredentials.email}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-1">Mật khẩu</p>
                <p className="text-sm text-white font-mono">{createdCredentials.password}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={copyCredentials}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm border border-gray-700 rounded-lg text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
              >
                {credCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                {credCopied ? 'Đã copy!' : 'Copy thông tin'}
              </button>
              <button
                onClick={() => setCreatedCredentials(null)}
                className="flex-1 py-2 text-sm font-semibold rounded-lg"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <h3 className="text-lg font-semibold text-white">Thêm khách hàng</h3>
              <button onClick={() => { setShowAddModal(false); setAddError(''); setLeadSearch(''); setLeadResults([]) }} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddStudent} className="overflow-y-auto flex-1 px-6 py-4 space-y-5">

              {/* Lead search */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tìm trong danh sách KHTN</label>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={leadSearch}
                    onChange={e => setLeadSearch(e.target.value)}
                    placeholder="Nhập email, tên hoặc số điện thoại..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  />
                  {leadSearching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">...</span>}
                </div>
                {leadResults.length > 0 && (
                  <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                    {leadResults.map(lead => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setAddForm(p => ({
                            ...p,
                            email: lead.email,
                            display_name: lead.name,
                            leadId: lead.id,
                            convertLead: true,
                          }))
                          setLeadSearch('')
                          setLeadResults([])
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-0"
                      >
                        <p className="text-sm text-white">{lead.name}</p>
                        <p className="text-xs text-gray-500">{lead.email}{lead.phone ? ` · ${lead.phone}` : ''}{lead.source ? ` · ${lead.source}` : ''}</p>
                      </button>
                    ))}
                  </div>
                )}
                {addForm.leadId && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-800/30 rounded px-2.5 py-1.5">
                    <span>KHTN đã chọn — sẽ được đánh dấu đã chuyển đổi sau khi tạo</span>
                    <button type="button" onClick={() => setAddForm(p => ({ ...p, leadId: '', convertLead: false }))} className="ml-auto text-emerald-600 hover:text-emerald-400"><X size={12} /></button>
                  </div>
                )}
              </div>

              <hr className="border-gray-800" />

              {/* Basic info */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Email *</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="student@email.com"
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tên hiển thị</label>
                <input
                  type="text"
                  value={addForm.display_name}
                  onChange={e => setAddForm(prev => ({ ...prev, display_name: e.target.value }))}
                  placeholder="Nguyen Van A"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>

              {/* Email mode toggle */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Phương thức đăng nhập</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEmailMode('magic_link')}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      emailMode === 'magic_link'
                        ? 'border-transparent text-black font-semibold'
                        : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                    }`}
                    style={emailMode === 'magic_link' ? { backgroundColor: 'var(--color-mission-accent)' } : undefined}
                  >
                    <Mail size={14} />
                    Magic Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailMode('password')}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      emailMode === 'password'
                        ? 'border-transparent text-black font-semibold'
                        : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                    }`}
                    style={emailMode === 'password' ? { backgroundColor: 'var(--color-mission-accent)' } : undefined}
                  >
                    <KeyRound size={14} />
                    Đặt mật khẩu
                  </button>
                </div>
                {emailMode === 'magic_link' && (
                  <p className="text-[11px] text-gray-600 mt-1.5">Supabase gửi email link đăng nhập tự động đến khách hàng</p>
                )}
                {emailMode === 'password' && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-2">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Nhập mật khẩu..."
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="px-2.5 text-xs text-gray-500 hover:text-white border border-gray-700 rounded-lg"
                      >
                        {showPassword ? 'Ẩn' : 'Hiện'}
                      </button>
                      <button
                        type="button"
                        onClick={generatePassword}
                        title="Tạo mật khẩu ngẫu nhiên"
                        className="px-2.5 border border-gray-700 rounded-lg text-gray-400 hover:text-white"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-600">App gửi email có tên thương hiệu kèm thông tin đăng nhập qua Resend</p>
                  </div>
                )}
              </div>

              <hr className="border-gray-800" />

              {/* Course enrollment */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mb-3">
                  <input type="checkbox" checked={addForm.enroll} onChange={e => setAddForm(prev => ({ ...prev, enroll: e.target.checked }))} />
                  Đăng ký vào khóa học
                </label>
                {addForm.enroll && (
                  <div className="space-y-3 pl-5">
                    <div>
                      <select
                        value={addForm.course_id}
                        onChange={e => setAddForm(prev => ({ ...prev, course_id: e.target.value }))}
                        required={addForm.enroll}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                      >
                        <option value="">— Chọn khóa học —</option>
                        {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <input
                          type="text"
                          list="cohort-hints"
                          value={addForm.cohort}
                          onChange={e => setAddForm(prev => ({ ...prev, cohort: e.target.value }))}
                          placeholder="Cohort (K1, K2...)"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                        />
                        <datalist id="cohort-hints">
                          {cohortHints.map(c => <option key={c} value={c} />)}
                        </datalist>
                      </div>
                      <div>
                        <input
                          type="date"
                          value={addForm.start_date}
                          onChange={e => setAddForm(prev => ({ ...prev, start_date: e.target.value }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Product assignment */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mb-3">
                  <input type="checkbox" checked={addForm.grantProducts} onChange={e => setAddForm(prev => ({ ...prev, grantProducts: e.target.checked }))} />
                  Gán sản phẩm số
                </label>
                {addForm.grantProducts && (
                  <div className="pl-5 space-y-2">
                    {products.length === 0 ? (
                      <p className="text-xs text-gray-600">Chưa có sản phẩm nào. Tạo sản phẩm trong mục Sản phẩm trước.</p>
                    ) : (
                      <>
                        <select
                          onChange={e => {
                            const id = e.target.value
                            if (id && !addForm.selectedProductIds.includes(id)) {
                              setAddForm(p => ({ ...p, selectedProductIds: [...p.selectedProductIds, id] }))
                            }
                            e.target.value = ''
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                          defaultValue=""
                        >
                          <option value="">+ Thêm sản phẩm...</option>
                          {products
                            .filter(p => !addForm.selectedProductIds.includes(p.id))
                            .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {addForm.selectedProductIds.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {addForm.selectedProductIds.map(pid => {
                              const prod = products.find(p => p.id === pid)
                              return prod ? (
                                <span key={pid} className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-800 border border-gray-700 text-gray-300 rounded">
                                  {prod.name}
                                  <button type="button" onClick={() => setAddForm(p => ({ ...p, selectedProductIds: p.selectedProductIds.filter(id => id !== pid) }))}><X size={11} /></button>
                                </span>
                              ) : null
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {addError && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded px-3 py-2">{addError}</p>
              )}
            </form>

            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-800 shrink-0">
              <button
                type="button"
                onClick={() => { setShowAddModal(false); setAddError(''); setLeadSearch(''); setLeadResults([]) }}
                className="flex-1 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
              >
                Hủy
              </button>
              <button
                form=""
                type="button"
                onClick={handleAddStudent}
                disabled={addLoading}
                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
              >
                {addLoading ? 'Đang tạo...' : 'Tạo khách hàng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StudentsView
