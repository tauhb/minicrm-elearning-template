import React, { useEffect, useRef, useState } from 'react'
import { X, Send, ChevronDown, Loader2, Tag } from 'lucide-react'
import { Lead, PipelineStage, LeadActivity, Course, Product } from '../../types'
import { fetchLeadActivities, addLeadActivity, updateLead, fetchCourses, fetchCohortsForCourse } from '../../services/api'
import { supabase } from '../../services/supabase'
import { formatDistanceToNow, format } from 'date-fns'
import CareHistoryTab from './CareHistoryTab'
import { useDialog } from '../../contexts/DialogContext'

interface Props {
  lead: Lead
  stages: PipelineStage[]
  onClose: () => void
  onUpdate: (updated: Lead) => void
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: '📝',
  call: '📞',
  email: '📧',
  stage_change: '🔄',
  converted: '🎉',
}

interface ConvertForm {
  email: string
  name: string
  type: 'course' | 'digital'
  course_id: string
  product_id: string
  cohort: string
  start_date: string
  amount: string
  notes: string
}

const LeadDetail: React.FC<Props> = ({ lead, stages, onClose, onUpdate }) => {
  const { alert: showAlert } = useDialog()
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState<LeadActivity['type']>('note')
  const [submitting, setSubmitting] = useState(false)
  const [currentStageId, setCurrentStageId] = useState(lead.pipeline_stage_id || '')
  const [activeTab, setActiveTab] = useState<'info' | 'care' | 'activity'>('info')

  // Tags
  const [tags, setTags] = useState<string[]>(lead.tags || [])
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  // Convert modal state
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [convertForm, setConvertForm] = useState<ConvertForm>({
    email: lead.email,
    name: lead.name,
    type: 'course',
    course_id: '',
    product_id: '',
    cohort: '',
    start_date: new Date().toISOString().split('T')[0],
    amount: '',
    notes: '',
  })
  const [courses, setCourses] = useState<Course[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cohortHints, setCohortHints] = useState<string[]>([])

  useEffect(() => {
    fetchLeadActivities(lead.id).then(setActivities)
  }, [lead.id])

  useEffect(() => {
    fetchCourses().then(setCourses)
    supabase.from('products').select('*').order('created_at', { ascending: false }).then(({ data }) => setProducts(data || []))
  }, [])

  // Auto-fill amount + load cohort hints khi đổi course
  useEffect(() => {
    if (convertForm.type === 'course' && convertForm.course_id) {
      const course = courses.find(c => c.id === convertForm.course_id)
      if (course && !convertForm.amount) {
        setConvertForm(f => ({ ...f, amount: String(course.price || 0) }))
      }
      fetchCohortsForCourse(convertForm.course_id).then(setCohortHints)
    } else {
      setCohortHints([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertForm.type, convertForm.course_id, courses])

  useEffect(() => {
    if (convertForm.type === 'digital' && convertForm.product_id) {
      const product = products.find(p => p.id === convertForm.product_id)
      if (product && !convertForm.amount) {
        setConvertForm(f => ({ ...f, amount: String(product.price || 0) }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertForm.type, convertForm.product_id, products])

  const commitTag = async (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/[,;]/g, '')
    if (!tag || tags.includes(tag)) { setTagInput(''); return }
    const newTags = [...tags, tag]
    setTags(newTags)
    setTagInput('')
    await updateLead(lead.id, { tags: newTags })
    onUpdate({ ...lead, tags: newTags })
  }

  const removeTag = async (tag: string) => {
    const newTags = tags.filter(t => t !== tag)
    setTags(newTags)
    await updateLead(lead.id, { tags: newTags })
    onUpdate({ ...lead, tags: newTags })
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  const handleAddNote = async () => {
    if (!note.trim()) return
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    await addLeadActivity(lead.id, noteType, note, user?.id || '')
    const updated = await fetchLeadActivities(lead.id)
    setActivities(updated)
    setNote('')
    setSubmitting(false)
  }

  const handleStageChange = async (stageId: string) => {
    setCurrentStageId(stageId)
    const stage = stages.find(s => s.id === stageId)
    await updateLead(lead.id, { pipeline_stage_id: stageId })
    onUpdate({ ...lead, pipeline_stage_id: stageId, pipeline_stage: stage })
    const { data: { user } } = await supabase.auth.getUser()
    await addLeadActivity(lead.id, 'stage_change', `Moved to ${stage?.name}`, user?.id || '')
    const updated = await fetchLeadActivities(lead.id)
    setActivities(updated)
  }

  const handleConvert = async () => {
    setConverting(true)
    setConvertError(null)
    try {
      const { email, name, type, course_id, product_id, cohort, start_date, amount, notes: convertNotes } = convertForm

      // Gọi server API — toàn bộ flow (auth.admin.createUser + insert customer + payment + lead update + magic link)
      // chạy server-side với service_role. Không bao giờ gọi auth.admin từ browser nữa.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.')

      const res = await fetch('/api/admin-create-customer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email,
          display_name: name,
          role: 'student',
          send_magic_link: true,
          lead_id: lead.id,
          amount: Number(amount) || 0,
          order_note: convertNotes,
          enroll_course_id: type === 'course' ? (course_id || null) : null,
          enroll_cohort: type === 'course' ? (cohort || null) : null,
          enroll_start_date: type === 'course' ? (start_date || null) : null,
          grant_product_id: type === 'digital' ? (product_id || null) : null,
        }),
      })
      const result = await res.json()
      if (!res.ok) {
        if (result.error?.toLowerCase().includes('already')) {
          setConvertError('Email đã tồn tại trong hệ thống.')
        } else {
          setConvertError(result.error || 'Chuyển đổi thất bại')
        }
        setConverting(false)
        return
      }

      const now = new Date().toISOString()
      setShowConvertModal(false)
      onUpdate({ ...lead, converted_at: now, converted_to: result.userId })
      showAlert({
        title: 'Chuyển đổi thành công',
        message: `Đã tạo tài khoản khách hàng cho ${email}.`,
        variant: 'success',
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Đã xảy ra lỗi. Vui lòng thử lại.'
      setConvertError(message)
    } finally {
      setConverting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <p className="text-sm font-semibold text-white">{lead.name}</p>
            <p className="text-xs text-gray-500">{lead.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>

        {/* Tab Nav */}
        <div className="flex border-b border-gray-800 px-5">
          {[
            { key: 'info',     label: 'Thông tin' },
            { key: 'care',     label: 'Lịch sử CS' },
            { key: 'activity', label: 'Hoạt động' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'info' | 'care' | 'activity')}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition-all ${
                activeTab === tab.key
                  ? 'border-current'
                  : 'border-transparent text-gray-500 hover:text-white'
              }`}
              style={activeTab === tab.key ? { color: 'var(--color-mission-accent)', borderColor: 'var(--color-mission-accent)' } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* INFO TAB */}
          {activeTab === 'info' && (
            <>
              {/* Stage Selector */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Pipeline Stage</label>
                <div className="relative">
                  <select
                    value={currentStageId}
                    onChange={e => handleStageChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white appearance-none focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Phone', value: lead.phone || '—' },
                  { label: 'Source', value: lead.source || '—' },
                  { label: 'Score', value: lead.score.toString() },
                  { label: 'Added', value: formatDistanceToNow(new Date(lead.created_at), { addSuffix: true }) },
                ].map(item => (
                  <div key={item.label} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <p className="text-sm text-white">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Tag size={12} className="text-gray-500" />
                  <label className="text-xs text-gray-500">Tags</label>
                </div>
                <div
                  className="flex flex-wrap gap-1.5 min-h-[2.25rem] bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 cursor-text"
                  onClick={() => tagInputRef.current?.focus()}
                >
                  {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-600 bg-gray-700 text-gray-300">
                      {tag}
                      <button
                        onClick={e => { e.stopPropagation(); removeTag(tag) }}
                        className="text-gray-500 hover:text-white transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    ref={tagInputRef}
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => tagInput.trim() && commitTag(tagInput)}
                    placeholder={tags.length === 0 ? 'Thêm tag... (Enter để xác nhận)' : ''}
                    className="flex-1 min-w-[120px] bg-transparent text-xs text-white placeholder-gray-600 outline-none"
                  />
                </div>
              </div>

              {/* UTM Section */}
              {(lead.utm_source || lead.utm_campaign || lead.utm_medium || lead.utm_term || lead.utm_content) && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">UTM Tracking</p>
                  <div className="space-y-1">
                    {[
                      { label: 'Source',   value: lead.utm_source },
                      { label: 'Campaign', value: lead.utm_campaign },
                      { label: 'Medium',   value: lead.utm_medium },
                      { label: 'Term',     value: lead.utm_term },
                      { label: 'Content',  value: lead.utm_content },
                    ].filter(f => f.value).map(f => (
                      <div key={f.label} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-16 shrink-0">{f.label}</span>
                        <span className="text-xs text-gray-300 font-mono truncate">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {lead.notes && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Notes</p>
                  <p className="text-sm text-white/80 whitespace-pre-wrap">{lead.notes}</p>
                </div>
              )}

              {/* Convert to Customer */}
              {lead.converted_at ? (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-900/30 border border-green-700/50">
                  <span className="text-green-400 text-sm font-medium">✓ Đã chuyển đổi</span>
                  <span className="text-green-600 text-xs">{format(new Date(lead.converted_at), 'dd/MM/yyyy HH:mm')}</span>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setConvertForm({
                      email: lead.email,
                      name: lead.name,
                      type: 'course',
                      course_id: '',
                      product_id: '',
                      cohort: '',
                      start_date: new Date().toISOString().split('T')[0],
                      amount: '',
                      notes: '',
                    })
                    setConvertError(null)
                    setShowConvertModal(true)
                  }}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >
                  Chuyển đổi thành Khách hàng
                </button>
              )}
            </>
          )}

          {/* CARE HISTORY TAB */}
          {activeTab === 'care' && (
            <CareHistoryTab leadId={lead.id} />
          )}

          {/* ACTIVITY TAB */}
          {activeTab === 'activity' && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Activity</p>
              {activities.length === 0 ? (
                <p className="text-xs text-gray-600 py-3">No activity yet</p>
              ) : (
                <div className="space-y-2">
                  {activities.map(a => (
                    <div key={a.id} className="flex gap-3 py-2 border-b border-gray-800 last:border-0">
                      <span className="text-base shrink-0 mt-0.5">{ACTIVITY_ICONS[a.type] || '•'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{a.content}</p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {a.creator?.display_name || 'System'} · {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Convert Modal Footer — only on info tab */}
        {showConvertModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={() => !converting && setShowConvertModal(false)} />
            <div className="relative z-10 bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-white">Chuyển đổi KHTN thành Khách hàng</h2>
                <button
                  onClick={() => !converting && setShowConvertModal(false)}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="px-5 py-4 space-y-3">
                {convertError && (
                  <div className="bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2 text-xs text-red-300">
                    {convertError}
                  </div>
                )}

                {/* Email */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    value={convertForm.email}
                    onChange={e => setConvertForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tên</label>
                  <input
                    type="text"
                    value={convertForm.name}
                    onChange={e => setConvertForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                  />
                </div>

                {/* Loại sản phẩm */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Loại sản phẩm</label>
                  <div className="flex gap-3 text-sm text-gray-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={convertForm.type === 'course'}
                        onChange={() => setConvertForm(f => ({ ...f, type: 'course' }))}
                      /> Khóa học
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={convertForm.type === 'digital'}
                        onChange={() => setConvertForm(f => ({ ...f, type: 'digital' }))}
                      /> Sản phẩm số
                    </label>
                  </div>
                </div>

                {convertForm.type === 'course' ? (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Khóa học *</label>
                      <select
                        value={convertForm.course_id}
                        onChange={e => setConvertForm(f => ({ ...f, course_id: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                      >
                        <option value="">— Chọn khóa học —</option>
                        {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Cohort</label>
                      <input
                        type="text"
                        list="lead-cohort-hints"
                        placeholder="K1, K2..."
                        value={convertForm.cohort}
                        onChange={e => setConvertForm(f => ({ ...f, cohort: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                      />
                      <datalist id="lead-cohort-hints">
                        {cohortHints.map(c => <option key={c} value={c} />)}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Ngày BĐ</label>
                      <input
                        type="date"
                        value={convertForm.start_date}
                        onChange={e => setConvertForm(f => ({ ...f, start_date: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Sản phẩm *</label>
                    <select
                      value={convertForm.product_id}
                      onChange={e => setConvertForm(f => ({ ...f, product_id: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                    >
                      <option value="">— Chọn sản phẩm —</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Amount */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Số tiền (VND)</label>
                  <input
                    type="number"
                    placeholder="VD: 1990000"
                    value={convertForm.amount}
                    onChange={e => setConvertForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Ghi chú (tùy chọn)</label>
                  <textarea
                    rows={2}
                    value={convertForm.notes}
                    onChange={e => setConvertForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex gap-2 px-5 py-4 border-t border-gray-800">
                <button
                  onClick={() => setShowConvertModal(false)}
                  disabled={converting}
                  className="flex-1 py-2 rounded-lg text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  onClick={handleConvert}
                  disabled={
                    converting ||
                    !convertForm.email ||
                    !convertForm.name ||
                    !convertForm.amount ||
                    (convertForm.type === 'course' && !convertForm.course_id) ||
                    (convertForm.type === 'digital' && !convertForm.product_id)
                  }
                  className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >
                  {converting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Đang chuyển đổi...
                    </>
                  ) : (
                    'Chuyển đổi →'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Note Footer — only on activity tab */}
        {activeTab === 'activity' && (
          <div className="p-4 border-t border-gray-800 space-y-2">
            <div className="flex gap-2">
              {(['note', 'call', 'email'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setNoteType(t)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${noteType === t ? '' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                  style={noteType === t ? { backgroundColor: 'var(--color-mission-accent)', color: '#000', fontWeight: 600 } : undefined}
                >
                  {ACTIVITY_ICONS[t]} {t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none"
              />
              <button
                onClick={handleAddNote}
                disabled={!note.trim() || submitting}
                className="px-3 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default LeadDetail
