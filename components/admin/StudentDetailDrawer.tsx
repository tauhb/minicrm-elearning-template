import React, { useEffect, useState } from 'react'
import { X, Save, Tag, CreditCard } from 'lucide-react'
import { Profile, Payment } from '../../types'
import { updateProfile, fetchPayments } from '../../services/api'
import CareHistoryTab from './CareHistoryTab'
import EnrollmentsTab from './EnrollmentsTab'
import TasksTab from './TasksTab'

interface Props {
  student: Profile
  onClose: () => void
  onUpdate: (updated: Profile) => void
}

const StudentDetailDrawer: React.FC<Props> = ({ student, onClose, onUpdate }) => {
  const [notes, setNotes] = useState(student.notes || '')
  const [tags, setTags] = useState<string[]>(student.tags || [])
  const [newTag, setNewTag] = useState('')
  const [payments, setPayments] = useState<Payment[]>([])
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'care' | 'tasks' | 'courses'>('info')

  useEffect(() => {
    fetchPayments(student.id).then(setPayments)
  }, [student.id])

  const handleSave = async () => {
    setSaving(true)
    await updateProfile(student.id, { notes, tags })
    onUpdate({ ...student, notes, tags })
    setSaving(false)
  }

  const addTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag])
      setNewTag('')
    }
  }

  const removeTag = (tag: string) => setTags(tags.filter(t => t !== tag))

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
              <p className="text-sm font-semibold text-white">{student.display_name}</p>
              <p className="text-xs text-gray-500">{student.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>

        {/* Tab Nav */}
        <div className="flex border-b border-gray-800 px-5">
          {[
            { key: 'info', label: 'Thông tin' },
            { key: 'care', label: 'Lịch sử CS' },
            { key: 'tasks', label: 'Tasks' },
            { key: 'courses', label: 'Khóa học' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'info' | 'care' | 'tasks' | 'courses')}
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
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="text-gray-500 hover:text-red-400"><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag()}
                    placeholder="Thêm nhãn..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none"
                  />
                  <button onClick={addTag} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-white rounded transition-colors">Thêm</button>
                </div>
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
