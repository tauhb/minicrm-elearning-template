import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckSquare, Square, Plus, Search, User as UserIcon, AlertTriangle,
  Phone, Mail, MessageCircle, Users as UsersIcon, FileText, Bell,
  Trash2, RotateCcw, XCircle, Link2, CheckCircle2, Filter,
} from 'lucide-react'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  fetchTasks,
  completeTask,
  reopenTask,
  cancelTask,
  deleteTask,
  fetchAssignableUsers,
  AssignableUser,
} from '../../services/api'
import { CareHistory } from '../../types'
import AddTaskModal from './AddTaskModal'
import { supabase } from '../../services/supabase'
import { useDialog } from '../../contexts/DialogContext'

type StatusFilter = 'open' | 'overdue' | 'done' | 'all'

const TYPE_ICON: Record<string, React.ReactNode> = {
  call:      <Phone size={12} />,
  zalo:      <MessageCircle size={12} />,
  email:     <Mail size={12} />,
  meeting:   <UsersIcon size={12} />,
  note:      <FileText size={12} />,
  follow_up: <Bell size={12} />,
}

const PRIORITY_COLOR: Record<string, string> = {
  low:    '#64748b',
  medium: '#f59e0b',
  high:   '#ef4444',
}

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Thấp',
  medium: 'BT',
  high: 'Cao',
}

interface TaskGroup {
  key: string
  label: string
  color?: string
  tasks: CareHistory[]
}

const TasksView: React.FC = () => {
  const { confirm: showConfirm } = useDialog()
  const [tasks, setTasks] = useState<CareHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const [status, setStatus] = useState<StatusFilter>('open')
  const [assignee, setAssignee] = useState<string>('all')  // 'all' | 'me' | user_id | 'unassigned'
  const [search, setSearch] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<CareHistory | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id || null))
    fetchAssignableUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters: any = {}
      if (status === 'overdue') {
        filters.overdue = true
      } else if (status === 'all') {
        filters.status = 'all'
      } else {
        filters.status = status
      }
      if (assignee !== 'all') filters.assignee = assignee
      const data = await fetchTasks(filters)
      setTasks(data)
    } catch (e) {
      console.error(e)
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [status, assignee])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(t => {
      const hay = [
        t.title,
        t.content,
        (t as any).lead?.name,
        (t as any).lead?.email,
        (t as any).customer?.display_name,
        (t as any).customer?.email,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [tasks, search])

  const groups: TaskGroup[] = useMemo(() => {
    const now = new Date()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    const weekEnd = new Date(todayEnd.getTime() + 6 * 86400000)

    const overdue: CareHistory[] = []
    const today: CareHistory[] = []
    const week: CareHistory[] = []
    const later: CareHistory[] = []
    const noDate: CareHistory[] = []

    filtered.forEach(t => {
      if (!t.due_at) { noDate.push(t); return }
      const due = new Date(t.due_at)
      if (t.status === 'open' && due < now) overdue.push(t)
      else if (due <= todayEnd) today.push(t)
      else if (due <= weekEnd) week.push(t)
      else later.push(t)
    })

    return [
      { key: 'overdue', label: 'Quá hạn',       color: '#f87171', tasks: overdue },
      { key: 'today',   label: 'Hôm nay',       color: '#fbbf24', tasks: today },
      { key: 'week',    label: 'Tuần này',      color: '#a3e635', tasks: week },
      { key: 'later',   label: 'Sau đó',        color: '#94a3b8', tasks: later },
      { key: 'noDate',  label: 'Không có hạn',  color: '#64748b', tasks: noDate },
    ].filter(g => g.tasks.length > 0)
  }, [filtered])

  const openCount = tasks.filter(t => t.status === 'open').length
  const overdueCount = tasks.filter(t => t.status === 'open' && t.due_at && new Date(t.due_at) < new Date()).length

  const handleToggleComplete = async (task: CareHistory) => {
    try {
      const updated = task.status === 'done' ? await reopenTask(task.id) : await completeTask(task.id)
      setTasks(prev => {
        // If current filter excludes new status, drop it from list
        if (status !== 'all' && status !== 'overdue') {
          if ((status === 'open' && updated.status !== 'open') ||
              (status === 'done' && updated.status !== 'done')) {
            return prev.filter(t => t.id !== task.id)
          }
        }
        return prev.map(t => t.id === task.id ? updated : t)
      })
    } catch (e: any) {
      console.error(e)
    }
  }

  const handleCancel = async (task: CareHistory) => {
    const ok = await showConfirm({
      title: 'Huỷ task?',
      message: `Task "${task.title}" sẽ được chuyển sang trạng thái huỷ.`,
      confirmText: 'Huỷ task',
    })
    if (!ok) return
    try {
      const updated = await cancelTask(task.id)
      setTasks(prev => status === 'all' ? prev.map(t => t.id === task.id ? updated : t) : prev.filter(t => t.id !== task.id))
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (task: CareHistory) => {
    const ok = await showConfirm({
      title: 'Xoá task?',
      message: `Xoá vĩnh viễn task "${task.title}". Hành động này không thể hoàn tác.`,
      confirmText: 'Xoá',
    })
    if (!ok) return
    try {
      await deleteTask(task.id)
      setTasks(prev => prev.filter(t => t.id !== task.id))
    } catch (e) { console.error(e) }
  }

  const handleSaved = (task: CareHistory) => {
    setEditing(null)
    setAddOpen(false)
    // Simple: refresh list to respect current filters
    load()
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--theme-text-muted)' }}>
            CRM · Wave 1
          </p>
          <h1 className="text-2xl font-bold flex items-center gap-3" style={{ color: 'var(--theme-text)' }}>
            Tasks
            {overdueCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1"
                style={{
                  color: '#f87171',
                  borderColor: 'rgba(248,113,113,0.3)',
                  background: 'rgba(248,113,113,0.08)',
                }}>
                <AlertTriangle size={11} />{overdueCount} quá hạn
              </span>
            )}
          </h1>
        </div>
        <button
          onClick={() => { setEditing(null); setAddOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          <Plus size={14} />Task mới
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center flex-wrap gap-3 mb-5 p-3 rounded-xl border"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
        {/* Status pills */}
        <div className="flex gap-1 items-center">
          <Filter size={12} className="text-gray-500 mr-1" />
          {([
            { key: 'open',    label: `Đang mở${openCount ? ` · ${openCount}` : ''}` },
            { key: 'overdue', label: `Quá hạn${overdueCount ? ` · ${overdueCount}` : ''}` },
            { key: 'done',    label: 'Đã xong' },
            { key: 'all',     label: 'Tất cả' },
          ] as { key: StatusFilter; label: string }[]).map(o => (
            <button
              key={o.key}
              onClick={() => setStatus(o.key)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-all border"
              style={status === o.key
                ? { backgroundColor: 'var(--color-mission-accent)', color: '#000', borderColor: 'var(--color-mission-accent)' }
                : { background: 'transparent', color: 'var(--theme-text-muted)', borderColor: 'transparent' }
              }
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Assignee dropdown */}
        <div className="flex items-center gap-1.5">
          <UserIcon size={12} className="text-gray-500" />
          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            className="bg-transparent border border-gray-800 rounded-md px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
          >
            <option value="all">Mọi người</option>
            <option value="me">Của tôi</option>
            <option value="unassigned">Chưa giao</option>
            <optgroup label="Người dùng">
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] ml-auto">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm task theo tiêu đề, tên KH..."
            className="w-full bg-transparent border border-gray-800 rounded-md pl-7 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
          />
        </div>
      </div>

      {/* Grouped list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: 'var(--theme-surface-2)' }} />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
          <CheckCircle2 size={32} className="mx-auto mb-3 text-gray-600" />
          <p className="text-sm text-gray-400">Không có task nào phù hợp với bộ lọc.</p>
          <button
            onClick={() => { setEditing(null); setAddOpen(true) }}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors text-gray-300"
          >
            <Plus size={12} />Tạo task đầu tiên
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.color }} />
                <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: g.color }}>
                  {g.label}
                </h3>
                <span className="text-xs text-gray-600">· {g.tasks.length}</span>
              </div>
              <div className="rounded-xl border divide-y overflow-hidden"
                style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
                {g.tasks.map(t => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    currentUserId={currentUserId}
                    onToggle={() => handleToggleComplete(t)}
                    onEdit={() => { setEditing(t); setAddOpen(true) }}
                    onCancel={() => handleCancel(t)}
                    onDelete={() => handleDelete(t)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {addOpen && (
        <AddTaskModal
          onClose={() => { setAddOpen(false); setEditing(null) }}
          onSaved={handleSaved}
          editingTask={editing}
        />
      )}
    </div>
  )
}

// ─── TaskRow ─────────────────────────────────────────────────────────────────

interface RowProps {
  task: CareHistory
  currentUserId: string | null
  onToggle: () => void
  onEdit: () => void
  onCancel: () => void
  onDelete: () => void
}

const TaskRow: React.FC<RowProps> = ({ task, currentUserId, onToggle, onEdit, onCancel, onDelete }) => {
  const done = task.status === 'done'
  const cancelled = task.status === 'cancelled'
  const isOverdue = !done && !cancelled && task.due_at && new Date(task.due_at) < new Date()

  const linked =
    (task as any).lead ? { kind: 'KHTN', label: (task as any).lead.name || (task as any).lead.email, id: (task as any).lead.id }
    : (task as any).customer ? { kind: 'KH', label: (task as any).customer.display_name || (task as any).customer.email, id: (task as any).customer.id }
    : (task as any).order ? { kind: 'Đơn', label: `Đơn ${String((task as any).order.id).slice(0, 8)}`, id: (task as any).order.id }
    : null

  const assignee = (task as any).assignee
  const assigneeIsMe = currentUserId && task.assigned_to === currentUserId

  return (
    <div className="flex items-center gap-3 px-4 py-3 group transition-colors hover:bg-gray-800/60">
      {/* Checkbox */}
      <button
        onClick={onToggle}
        disabled={cancelled}
        className="shrink-0 transition-colors disabled:opacity-40"
        title={done ? 'Mở lại' : 'Đánh dấu hoàn thành'}
      >
        {done
          ? <CheckSquare size={18} style={{ color: 'var(--color-mission-accent)' }} />
          : <Square size={18} className="text-gray-500 hover:text-white" />
        }
      </button>

      {/* Body */}
      <div className="flex-1 min-w-0" onClick={onEdit} role="button">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-sm truncate"
            style={{
              color: done || cancelled ? '#6b7280' : 'var(--theme-text)',
              textDecoration: done || cancelled ? 'line-through' : 'none',
            }}
          >
            {task.title || task.content || '(Không có tiêu đề)'}
          </span>
          {task.priority && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium"
              style={{
                color: PRIORITY_COLOR[task.priority] || '#9ca3af',
                background: (PRIORITY_COLOR[task.priority] || '#9ca3af') + '18',
              }}
            >
              {PRIORITY_LABEL[task.priority] || task.priority}
            </span>
          )}
          {task.type && TYPE_ICON[task.type] && (
            <span className="text-gray-500 shrink-0">{TYPE_ICON[task.type]}</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          {task.due_at && (
            <span style={{ color: isOverdue ? '#f87171' : undefined }}>
              {format(new Date(task.due_at), "EEE dd/MM · HH:mm", { locale: vi })}
              {isOverdue && ' · Quá hạn'}
            </span>
          )}
          {linked && (
            <span className="flex items-center gap-1 truncate max-w-[220px]">
              <Link2 size={10} />
              <span className="text-gray-500">{linked.kind}:</span>
              <span className="truncate">{linked.label}</span>
            </span>
          )}
          {cancelled && <span className="text-gray-500">· đã huỷ</span>}
        </div>
      </div>

      {/* Assignee avatar */}
      {assignee && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border"
          title={`${assignee.display_name || assignee.email}${assigneeIsMe ? ' (bạn)' : ''}`}
          style={{
            backgroundColor: assigneeIsMe
              ? 'rgba(var(--color-mission-accent-rgb,182,255,0),0.15)'
              : '#1f2937',
            borderColor: assigneeIsMe
              ? 'rgba(var(--color-mission-accent-rgb,182,255,0),0.4)'
              : '#374151',
            color: assigneeIsMe ? 'var(--color-mission-accent)' : '#9ca3af',
          }}
        >
          {(assignee.display_name || assignee.email || '?')[0].toUpperCase()}
        </div>
      )}

      {/* Row actions (hover-reveal) */}
      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!cancelled && !done && (
          <button
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-white"
            title="Huỷ task"
          >
            <XCircle size={13} />
          </button>
        )}
        {(done || cancelled) && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-white"
            title="Mở lại"
          >
            <RotateCcw size={13} />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400"
          title="Xoá"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

export default TasksView
