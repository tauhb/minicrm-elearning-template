import React, { useCallback, useEffect, useState } from 'react'
import { Plus, CheckSquare, Square, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  fetchTasks,
  completeTask,
  reopenTask,
  deleteTask,
} from '../../services/api'
import { CareHistory } from '../../types'
import AddTaskModal from './AddTaskModal'
import { useDialog } from '../../contexts/DialogContext'

interface Props {
  leadId?: string
  customerId?: string
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#64748b',
  medium: '#f59e0b',
  high: '#ef4444',
}

const TasksTab: React.FC<Props> = ({ leadId, customerId }) => {
  const { confirm: showConfirm } = useDialog()
  const [tasks, setTasks] = useState<CareHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<CareHistory | null>(null)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTasks({
        lead_id: leadId,
        customer_id: customerId,
        status: showDone ? 'all' : 'open',
      })
      setTasks(data)
    } catch (e) {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [leadId, customerId, showDone])

  useEffect(() => { load() }, [load])

  const handleToggle = async (task: CareHistory) => {
    try {
      const updated = task.status === 'done' ? await reopenTask(task.id) : await completeTask(task.id)
      setTasks(prev => showDone ? prev.map(t => t.id === task.id ? updated : t) : prev.filter(t => t.id !== task.id))
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (task: CareHistory) => {
    const ok = await showConfirm({
      title: 'Xoá task?',
      message: `Xoá vĩnh viễn task "${task.title}".`,
      confirmText: 'Xoá',
    })
    if (!ok) return
    try {
      await deleteTask(task.id)
      setTasks(prev => prev.filter(t => t.id !== task.id))
    } catch (e) { console.error(e) }
  }

  const openTasks = tasks.filter(t => t.status === 'open')
  const otherTasks = tasks.filter(t => t.status !== 'open')

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Tasks đang mở</p>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{openTasks.length}</span>
        </div>
        <button
          onClick={() => { setEditing(null); setAddOpen(true) }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          <Plus size={12} />Task
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-gray-800 animate-pulse" />)}
        </div>
      ) : openTasks.length === 0 ? (
        <p className="text-xs text-gray-600 py-3">Chưa có task nào đang mở.</p>
      ) : (
        <div className="space-y-1.5">
          {openTasks.map(t => (
            <TaskItem key={t.id} task={t} onToggle={() => handleToggle(t)} onEdit={() => { setEditing(t); setAddOpen(true) }} onDelete={() => handleDelete(t)} />
          ))}
        </div>
      )}

      {/* Toggle for done/cancelled */}
      <button
        onClick={() => setShowDone(s => !s)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        {showDone ? 'Ẩn task đã xong/huỷ' : 'Hiện task đã xong/huỷ'}
      </button>

      {showDone && otherTasks.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <p className="text-xs text-gray-600 uppercase tracking-widest">Đã xong / huỷ</p>
          {otherTasks.map(t => (
            <TaskItem key={t.id} task={t} onToggle={() => handleToggle(t)} onEdit={() => { setEditing(t); setAddOpen(true) }} onDelete={() => handleDelete(t)} />
          ))}
        </div>
      )}

      {addOpen && (
        <AddTaskModal
          onClose={() => { setAddOpen(false); setEditing(null) }}
          onSaved={() => { setAddOpen(false); setEditing(null); load() }}
          defaultLeadId={leadId}
          defaultCustomerId={customerId}
          editingTask={editing}
        />
      )}
    </div>
  )
}

const TaskItem: React.FC<{
  task: CareHistory
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}> = ({ task, onToggle, onEdit, onDelete }) => {
  const done = task.status === 'done'
  const cancelled = task.status === 'cancelled'
  const isOverdue = !done && !cancelled && task.due_at && new Date(task.due_at) < new Date()
  const priorityColor = PRIORITY_COLOR[task.priority || 'medium']

  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50 group hover:bg-gray-800/90 transition-colors">
      <button onClick={onToggle} disabled={cancelled} className="shrink-0 disabled:opacity-40">
        {done
          ? <CheckSquare size={15} style={{ color: 'var(--color-mission-accent)' }} />
          : <Square size={15} className="text-gray-500 hover:text-white" />
        }
      </button>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <p
          className="text-sm truncate"
          style={{
            color: done || cancelled ? '#6b7280' : '#fff',
            textDecoration: done || cancelled ? 'line-through' : 'none',
          }}
        >
          {task.title || task.content || '(Không có tiêu đề)'}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          {task.due_at && (
            <span style={{ color: isOverdue ? '#f87171' : undefined }}>
              {format(new Date(task.due_at), "dd/MM HH:mm", { locale: vi })}
              {isOverdue && ' · quá hạn'}
            </span>
          )}
          {task.priority && task.priority !== 'medium' && (
            <span style={{ color: priorityColor }}>· {task.priority === 'high' ? 'Ưu tiên cao' : 'Ưu tiên thấp'}</span>
          )}
          {cancelled && <span className="text-gray-500">· đã huỷ</span>}
        </div>
      </div>
      <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400"
          title="Xoá"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

export default TasksTab
