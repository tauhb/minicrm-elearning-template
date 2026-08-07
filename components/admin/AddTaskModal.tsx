import React, { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Search, Phone, Mail, Users as UsersIcon, FileText, Bell, MessageCircle } from 'lucide-react'
import { supabase } from '../../services/supabase'
import {
  createTask,
  updateTask,
  fetchAssignableUsers,
  AssignableUser,
  CreateTaskInput,
} from '../../services/api'
import { CareHistory, CareHistoryType } from '../../types'
import { useDialog } from '../../contexts/DialogContext'

interface Props {
  onClose: () => void
  onSaved: (task: CareHistory) => void
  defaultLeadId?: string | null
  defaultCustomerId?: string | null
  defaultOrderId?: string | null
  /** Edit mode — if set, the modal loads that task's values and PATCHes on save. */
  editingTask?: CareHistory | null
}

const PRIORITIES: { key: 'low' | 'medium' | 'high'; label: string; color: string }[] = [
  { key: 'low',    label: 'Thấp',       color: '#64748b' },
  { key: 'medium', label: 'Bình thường', color: '#f59e0b' },
  { key: 'high',   label: 'Cao',        color: '#ef4444' },
]

const TYPE_OPTIONS: { key: CareHistoryType; label: string; icon: React.ReactNode }[] = [
  { key: 'follow_up', label: 'Nhắc hẹn', icon: <Bell size={12} /> },
  { key: 'call',      label: 'Gọi',      icon: <Phone size={12} /> },
  { key: 'email',     label: 'Email',    icon: <Mail size={12} /> },
  { key: 'meeting',   label: 'Gặp mặt',  icon: <UsersIcon size={12} /> },
  { key: 'note',      label: 'Ghi chú',  icon: <FileText size={12} /> },
  { key: 'zalo',      label: 'Zalo',     icon: <MessageCircle size={12} /> },
]

type LinkKind = 'none' | 'lead' | 'customer' | 'order'

interface LinkOption {
  id: string
  label: string
  sub?: string
}

const AddTaskModal: React.FC<Props> = ({
  onClose,
  onSaved,
  defaultLeadId = null,
  defaultCustomerId = null,
  defaultOrderId = null,
  editingTask = null,
}) => {
  const { alert: showAlert } = useDialog()

  // Determine initial link kind from defaults / editing task
  const initialLinkKind: LinkKind = editingTask?.lead_id
    ? 'lead'
    : editingTask?.customer_id
      ? 'customer'
      : editingTask?.order_id
        ? 'order'
        : defaultLeadId
          ? 'lead'
          : defaultCustomerId
            ? 'customer'
            : defaultOrderId
              ? 'order'
              : 'none'

  const initialLinkId =
    editingTask?.lead_id || editingTask?.customer_id || editingTask?.order_id ||
    defaultLeadId || defaultCustomerId || defaultOrderId || ''

  const [title, setTitle] = useState(editingTask?.title || '')
  const [description, setDescription] = useState(editingTask?.content || '')
  const [dueAt, setDueAt] = useState(editingTask?.due_at ? toLocalDatetimeInput(editingTask.due_at) : '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(
    (editingTask?.priority as any) || 'medium',
  )
  const [type, setType] = useState<CareHistoryType>((editingTask?.type as CareHistoryType) || 'follow_up')
  const [assignedTo, setAssignedTo] = useState<string>(editingTask?.assigned_to || '')

  const [linkKind, setLinkKind] = useState<LinkKind>(initialLinkKind)
  const [linkId, setLinkId] = useState<string>(initialLinkId)
  const [linkLabel, setLinkLabel] = useState<string>('')
  const [linkSearch, setLinkSearch] = useState('')
  const [linkOptions, setLinkOptions] = useState<LinkOption[]>([])
  const [linkSearching, setLinkSearching] = useState(false)

  const [users, setUsers] = useState<AssignableUser[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAssignableUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  // Load current link label (so pre-filled shows entity name, not raw id)
  useEffect(() => {
    if (!linkId || linkKind === 'none') { setLinkLabel(''); return }
    let cancelled = false
    ;(async () => {
      if (linkKind === 'lead') {
        const { data } = await supabase.from('leads').select('name, email').eq('id', linkId).maybeSingle()
        if (!cancelled && data) setLinkLabel(data.name || data.email || linkId)
      } else if (linkKind === 'customer') {
        const { data } = await supabase.from('customers').select('display_name, email').eq('id', linkId).maybeSingle()
        if (!cancelled && data) setLinkLabel(data.display_name || data.email || linkId)
      } else if (linkKind === 'order') {
        const { data } = await supabase.from('payments').select('id, amount, status').eq('id', linkId).maybeSingle()
        if (!cancelled && data) setLinkLabel(`Đơn ${String(data.id).slice(0, 8)} · ${data.amount?.toLocaleString('vi-VN') || 0}đ`)
      }
    })()
    return () => { cancelled = true }
  }, [linkId, linkKind])

  // Search for entities to link
  useEffect(() => {
    if (linkKind === 'none') { setLinkOptions([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setLinkSearching(true)
      try {
        if (linkKind === 'lead') {
          const q = supabase.from('leads')
            .select('id, name, email, phone')
            .order('created_at', { ascending: false })
            .limit(20)
          const res = linkSearch.trim()
            ? await q.or(`name.ilike.%${linkSearch}%,email.ilike.%${linkSearch}%,phone.ilike.%${linkSearch}%`)
            : await q
          if (!cancelled) setLinkOptions((res.data || []).map((l: any) => ({
            id: l.id, label: l.name || l.email || 'Không tên', sub: l.email || l.phone || '',
          })))
        } else if (linkKind === 'customer') {
          const q = supabase.from('customers')
            .select('id, display_name, email')
            .order('created_at', { ascending: false })
            .limit(20)
          const res = linkSearch.trim()
            ? await q.or(`display_name.ilike.%${linkSearch}%,email.ilike.%${linkSearch}%`)
            : await q
          if (!cancelled) setLinkOptions((res.data || []).map((c: any) => ({
            id: c.id, label: c.display_name || c.email, sub: c.email,
          })))
        } else if (linkKind === 'order') {
          const q = supabase.from('payments')
            .select('id, amount, status, customer_id, created_at')
            .order('created_at', { ascending: false })
            .limit(20)
          const res = linkSearch.trim()
            ? await q.ilike('id', `%${linkSearch}%`)
            : await q
          if (!cancelled) setLinkOptions((res.data || []).map((p: any) => ({
            id: p.id,
            label: `Đơn ${String(p.id).slice(0, 8)}… · ${(p.amount || 0).toLocaleString('vi-VN')}đ`,
            sub: `${p.status} · ${new Date(p.created_at).toLocaleDateString('vi-VN')}`,
          })))
        }
      } finally {
        if (!cancelled) setLinkSearching(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [linkKind, linkSearch])

  const canSave = title.trim().length > 0 && !saving

  const handleSubmit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const dueAtIso = dueAt ? new Date(dueAt).toISOString() : null
      const payload: CreateTaskInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        due_at: dueAtIso,
        priority,
        type,
        assigned_to: assignedTo || null,
        lead_id: linkKind === 'lead' ? linkId || null : null,
        customer_id: linkKind === 'customer' ? linkId || null : null,
        order_id: linkKind === 'order' ? linkId || null : null,
      }
      const saved = editingTask
        ? await updateTask(editingTask.id, payload)
        : await createTask(payload)
      onSaved(saved)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Lưu thất bại')
    } finally {
      setSaving(false)
    }
  }

  const linkKindLabel = useMemo(() => ({
    none: 'Không gắn',
    lead: 'KHTN (Lead)',
    customer: 'Khách hàng',
    order: 'Đơn hàng',
  }), [])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => !saving && onClose()} />
      <div className="relative z-10 w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">
            {editingTask ? 'Sửa task' : 'Task mới'}
          </h2>
          <button
            onClick={() => !saving && onClose()}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tiêu đề <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="VD: Gọi lại khách A tư vấn khoá X"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Mô tả</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Chi tiết cần làm..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
            />
          </div>

          {/* Due at + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Hạn</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={e => setDueAt(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ưu tiên</label>
              <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1">
                {PRIORITIES.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPriority(p.key)}
                    className="flex-1 py-1.5 text-xs font-medium rounded transition-all"
                    style={priority === p.key
                      ? { backgroundColor: p.color + '20', color: p.color, borderColor: p.color }
                      : { color: '#6b7280' }
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Category (type) */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Loại</label>
            <div className="flex gap-1.5 flex-wrap">
              {TYPE_OPTIONS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
                  style={type === t.key
                    ? { backgroundColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.12)', borderColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.4)', color: 'var(--color-mission-accent)' }
                    : { backgroundColor: 'transparent', borderColor: '#374151', color: '#9ca3af' }
                  }
                >
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Assigned to */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Giao cho</label>
            <select
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
            >
              <option value="">— Chưa giao —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.display_name || u.email} · {u.role}</option>
              ))}
            </select>
          </div>

          {/* Link entity */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Gắn với</label>
            <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1 mb-2">
              {(Object.keys(linkKindLabel) as LinkKind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setLinkKind(k); setLinkId(''); setLinkLabel(''); setLinkSearch('') }}
                  className="flex-1 py-1.5 text-xs font-medium rounded transition-all"
                  style={linkKind === k
                    ? { backgroundColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.12)', color: 'var(--color-mission-accent)' }
                    : { color: '#6b7280' }
                  }
                >
                  {linkKindLabel[k]}
                </button>
              ))}
            </div>

            {linkKind !== 'none' && (
              <>
                {linkId && linkLabel && (
                  <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700">
                    <span className="text-xs text-white flex-1 truncate">{linkLabel}</span>
                    <button
                      type="button"
                      onClick={() => { setLinkId(''); setLinkLabel('') }}
                      className="text-gray-500 hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {!linkId && (
                  <>
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input
                        type="text"
                        placeholder={`Tìm ${linkKindLabel[linkKind].toLowerCase()}...`}
                        value={linkSearch}
                        onChange={e => setLinkSearch(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                      />
                    </div>
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-800">
                      {linkSearching && <div className="px-3 py-2 text-xs text-gray-500">Đang tìm...</div>}
                      {!linkSearching && linkOptions.length === 0 && <div className="px-3 py-2 text-xs text-gray-600">Không có kết quả</div>}
                      {linkOptions.map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => { setLinkId(opt.id); setLinkLabel(opt.label); setLinkSearch('') }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-800 transition-colors border-b border-gray-800 last:border-0"
                        >
                          <div className="text-xs text-white truncate">{opt.label}</div>
                          {opt.sub && <div className="text-[10px] text-gray-500 truncate">{opt.sub}</div>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="flex-1 py-2 rounded-lg text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" />Đang lưu...</>
            ) : (
              editingTask ? 'Lưu thay đổi' : 'Tạo task'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Convert ISO string to `YYYY-MM-DDTHH:mm` for datetime-local input. */
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default AddTaskModal
