import React, { useEffect, useState } from 'react'
import { X, Save, Tag, CreditCard, Mail, UserX, UserCheck, Phone } from 'lucide-react'
import { Profile, Payment } from '../../types'
import { updateProfile, fetchPayments, resendCustomerMagicLink, setCustomerStatus } from '../../services/api'
import CareHistoryTab from './CareHistoryTab'
import EnrollmentsTab from './EnrollmentsTab'
import TasksTab from './TasksTab'
import ChatConversationList from './ChatConversationList'
import TagsEditor from './TagsEditor'

interface Props {
  student: Profile
  onClose: () => void
  onUpdate: (updated: Profile) => void
}

const StudentDetailDrawer: React.FC<Props> = ({ student, onClose, onUpdate }) => {
  const [notes, setNotes] = useState(student.notes || '')
  const [tags, setTags] = useState<string[]>(student.tags || [])
  const [payments, setPayments] = useState<Payment[]>([])
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'care' | 'tasks' | 'chat' | 'courses'>('info')
  // Wave 1 Track C
  const [phone, setPhone] = useState<string>((student as any).phone || '')
  const [status, setStatusVal] = useState<'active' | 'deactivated'>(((student as any).status as any) || 'active')
  const [resending, setResending] = useState(false)
  const [togglingStatus, setTogglingStatus] = useState(false)

  useEffect(() => {
    fetchPayments(student.id).then(setPayments)
  }, [student.id])

  const handleSave = async () => {
    setSaving(true)
    await updateProfile(student.id, { notes, tags, phone } as any)
    onUpdate({ ...student, notes, tags, phone } as any)
    setSaving(false)
  }

  const handleResend = async () => {
    if (!confirm(`Gửi lại link đăng nhập cho ${student.email}?`)) return
    setResending(true)
    const r = await resendCustomerMagicLink(student.id)
    setResending(false)
    alert(r.success ? 'Đã gửi link đăng nhập.' : `Lỗi: ${r.error || 'Không gửi được'}`)
  }

  const handleToggleStatus = async () => {
    const next = status === 'active' ? 'deactivated' : 'active'
    if (!confirm(next === 'deactivated'
      ? `Ngừng hoạt động ${student.display_name}? Tài khoản vẫn còn dữ liệu, chỉ ẩn khỏi danh sách mặc định.`
      : `Kích hoạt lại ${student.display_name}?`)) return
    setTogglingStatus(true)
    const r = await setCustomerStatus(student.id, next)
    setTogglingStatus(false)
    if (r.success) {
      setStatusVal(next)
      onUpdate({ ...student, ...(next === 'deactivated' ? { status: 'deactivated' } : { status: 'active' }) } as any)
    } else {
      alert(`Lỗi: ${r.error || 'Không đổi được trạng thái'}`)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full border flex items-center justify-center text-sm font-bold"
              style={{
                backgroundColor: 'rgba(var(--color-mission-accent-rgb, 182, 255, 0), 0.12)',
                borderColor: 'rgba(var(--color-mission-accent-rgb, 182, 255, 0), 0.3)',
                color: 'var(--color-mission-accent)',
              }}
            >
              {student.display_name[0]?.toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">{student.display_name}</p>
                {status === 'deactivated' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400 bg-red-500/10">Ngừng HĐ</span>
                )}
              </div>
              <p className="text-xs text-gray-500">{student.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleResend} disabled={resending || status === 'deactivated'}
              title="Gửi lại link đăng nhập"
              className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-40">
              <Mail size={16} />
            </button>
            <button onClick={handleToggleStatus} disabled={togglingStatus}
              title={status === 'active' ? 'Ngừng hoạt động' : 'Kích hoạt lại'}
              className={`p-1.5 rounded hover:bg-gray-800 disabled:opacity-40 ${status === 'active' ? 'text-gray-500 hover:text-red-400' : 'text-green-400 hover:text-green-300'}`}>
              {status === 'active' ? <UserX size={16} /> : <UserCheck size={16} />}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1.5"><X size={18} /></button>
          </div>
        </div>

        {/* Tab Nav */}
        <div className="flex border-b border-gray-800 px-5">
          {[
            { key: 'info', label: 'Thông tin' },
            { key: 'care', label: 'Lịch sử CS' },
            { key: 'tasks', label: 'Tasks' },
            { key: 'chat', label: 'Chat' },
            { key: 'courses', label: 'Khóa học' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'info' | 'care' | 'tasks' | 'chat' | 'courses')}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition-all ${activeTab === tab.key ? 'border-current' : 'border-transparent text-gray-500 hover:text-white'}`}
              style={activeTab === tab.key ? { color: 'var(--color-mission-accent)', borderColor: 'var(--color-mission-accent)' } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* INFO TAB */}
          {activeTab === 'info' && (
            <>
              {/* Phone (Wave 1 Track C — Save button below writes to DB) */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
                  <Phone size={11} /> Số điện thoại
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="0900 000 000"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white"
                />
              </div>
              {/* Info — cohort/start_date đã chuyển sang tab "Khóa học" (enrollment-based) */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Email', value: student.email },
                  { label: 'Thanh toán', value: student.payment_status },
                  { label: 'Tham gia', value: new Date(student.created_at).toLocaleDateString('vi-VN') },
                ].map(item => (
                  <div key={item.label} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <p className="text-sm font-medium text-white">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Tags */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Tag size={10} /> Nhãn
                </p>
                <TagsEditor value={tags} onChange={setTags} placeholder="Thêm nhãn... (Enter để xác nhận)" />
                <p className="text-[10px] text-gray-600 mt-1.5">Nhấn "Lưu thay đổi" ở dưới để lưu</p>
              </div>

              {/* Notes */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Ghi chú</p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Ghi chú về khách hàng này..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none"
                />
              </div>

              {/* Payments */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <CreditCard size={10} /> Lịch sử thanh toán
                </p>
                {payments.length === 0 ? (
                  <p className="text-xs text-gray-600 py-3">Chưa có thanh toán</p>
                ) : (
                  <div className="space-y-2">
                    {payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5">
                        <div>
                          <p className="text-sm text-white">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(p.amount)}</p>
                          <p className="text-xs text-gray-500">{p.gateway}{p.gateway_ref ? ` · ${p.gateway_ref}` : ''}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded border ${p.status === 'completed' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-gray-400 bg-gray-700 border-gray-600'}`}>
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* CARE HISTORY TAB */}
          {activeTab === 'care' && (
            <CareHistoryTab customerId={student.id} />
          )}

          {/* TASKS TAB */}
          {activeTab === 'tasks' && (
            <TasksTab customerId={student.id} />
          )}

          {/* CHAT TAB */}
          {activeTab === 'chat' && (
            <ChatConversationList customerId={student.id} emailFallback={student.email} />
          )}

          {/* COURSES TAB */}
          {activeTab === 'courses' && (
            <EnrollmentsTab customerId={student.id} />
          )}
        </div>

        {/* Footer — only on info tab */}
        {activeTab === 'info' && (
          <div className="p-4 border-t border-gray-800">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
            >
              <Save size={14} />
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default StudentDetailDrawer
