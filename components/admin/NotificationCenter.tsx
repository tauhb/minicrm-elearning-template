// components/admin/NotificationCenter.tsx — Wave 3
// Bell icon in AdminLayout header. Popover shows recent notifications from 3 sources:
//   - Overdue tasks (care_history kind='task' status='open' due_at<NOW)
//   - Unread chat conversations (chat_conversations agent hasn't seen last visitor msg)
//   - Pending funnel_orders about to expire (informational)
//
// Realtime: subscribes to inserts on care_history + chat_messages so badge updates
// without polling. Dedup across sources.

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckSquare, MessageCircle, DollarSign, X, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../services/supabase'

type NotifKind = 'task-overdue' | 'chat-unread' | 'order-pending'

interface Notif {
  id: string                          // Stable dedup key ("task-{id}", "chat-{id}", "order-{id}")
  kind: NotifKind
  title: string
  detail?: string
  time: string                        // ISO
  route: string                       // navigate() target
}

const KIND_META: Record<NotifKind, { icon: React.ElementType; color: string; label: string }> = {
  'task-overdue': { icon: CheckSquare, color: '#f87171', label: 'Task quá hạn' },
  'chat-unread':  { icon: MessageCircle, color: '#60a5fa', label: 'Chat mới' },
  'order-pending':{ icon: DollarSign, color: '#fbbf24', label: 'Đơn chờ TT' },
}

export default function NotificationCenter() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const now = new Date().toISOString()
      // 3 parallel queries
      const [tasksRes, chatRes, ordersRes] = await Promise.all([
        // Overdue tasks (limit 20)
        supabase.from('care_history')
          .select('id, title, content, due_at, lead:leads(id, name), customer:customers!care_history_customer_id_fkey(id, display_name)')
          .eq('kind', 'task').eq('status', 'open')
          .lt('due_at', now)
          .order('due_at', { ascending: true }).limit(20),
        // Chat conversations where last message is from visitor and agent hasn't seen since
        // Approximation: unread=true set by API when new msg + no agent view
        supabase.from('chat_conversations')
          .select('id, display_id, status, last_activity_at, agent_last_seen_at, contact:leads(name, email), customer:customers!chat_conversations_customer_id_fkey(display_name, email)')
          .eq('status', 'open')
          .order('last_activity_at', { ascending: false }).limit(20),
        // Pending funnel orders (informational)
        supabase.from('funnel_orders')
          .select('id, reference_code, amount, expires_at, customer_snapshot, funnel_id, funnel_flows!inner(slug, name)')
          .eq('status', 'pending')
          .gt('expires_at', now)
          .order('created_at', { ascending: false }).limit(10),
      ])

      const items: Notif[] = []

      for (const t of (tasksRes.data || [])) {
        const entity = (t as any).lead?.name || (t as any).customer?.display_name || 'Không rõ'
        items.push({
          id: `task-${t.id}`, kind: 'task-overdue',
          title: t.title || (t.content || '').slice(0, 60) || 'Task không tên',
          detail: `${entity} · ${(t as any).lead ? 'lead' : 'customer'}`,
          time: t.due_at || '',
          route: (t as any).lead ? `/admin/leads` : `/admin/students`,
        })
      }

      // Chat unread: heuristic — last_activity_at > agent_last_seen_at
      for (const c of (chatRes.data || [])) {
        const seen = (c as any).agent_last_seen_at
        if (seen && new Date((c as any).last_activity_at) <= new Date(seen)) continue
        const who = (c as any).contact?.name || (c as any).customer?.display_name || (c as any).contact?.email || `#${(c as any).display_id}`
        items.push({
          id: `chat-${c.id}`, kind: 'chat-unread',
          title: `Chat #${(c as any).display_id} — ${who}`,
          detail: 'Có tin nhắn mới',
          time: (c as any).last_activity_at,
          route: '/admin/chat',
        })
      }

      for (const o of (ordersRes.data || [])) {
        const who = (o as any).customer_snapshot?.name || (o as any).customer_snapshot?.email || 'Ẩn danh'
        const funnelName = (o as any).funnel_flows?.name || 'funnel'
        items.push({
          id: `order-${o.id}`, kind: 'order-pending',
          title: `${who} — ${new Intl.NumberFormat('vi-VN').format((o as any).amount)}₫`,
          detail: `Đang chờ QR · ${funnelName}`,
          time: (o as any).expires_at,
          route: '/admin/orders',
        })
      }

      // Sort by time DESC, cap 20
      items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setNotifs(items.slice(0, 20))
    } catch (e) {
      console.warn('[NotificationCenter] load failed:', e)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime: refresh on new task or new chat message
  useEffect(() => {
    const ch = supabase
      .channel('notification-center-global')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'care_history' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'funnel_orders' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const overdueTaskCount = notifs.filter(n => n.kind === 'task-overdue').length
  const chatUnreadCount = notifs.filter(n => n.kind === 'chat-unread').length
  const badge = overdueTaskCount + chatUnreadCount   // Order-pending is informational, no badge

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 hover:bg-gray-800 rounded transition"
        title="Thông báo"
      >
        <Bell size={18} className="text-gray-400 hover:text-white" />
        {badge > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[500px] bg-gray-900 border border-gray-800 rounded-lg shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-gray-400" />
              <span className="text-sm font-semibold text-white">Thông báo</span>
              {badge > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{badge} cần xử lý</span>}
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white"><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && notifs.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">Đang tải...</div>
            ) : notifs.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                <Bell size={28} className="mx-auto mb-2 opacity-30" />
                Không có thông báo mới
              </div>
            ) : (
              notifs.map(n => {
                const meta = KIND_META[n.kind]
                const Icon = meta.icon
                return (
                  <button
                    key={n.id}
                    onClick={() => { navigate(n.route); setOpen(false) }}
                    className="w-full text-left p-3 border-b border-gray-800/50 hover:bg-gray-800 transition flex items-start gap-3"
                  >
                    <div
                      className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: `${meta.color}20`, color: meta.color }}
                    >
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{n.title}</p>
                      {n.detail && <p className="text-[11px] text-gray-500 truncate mt-0.5">{n.detail}</p>}
                      {n.time && (
                        <p className="text-[10px] text-gray-600 mt-0.5 flex items-center gap-1">
                          <Clock size={9} />
                          {n.kind === 'task-overdue'
                            ? `Quá hạn ${formatDistanceToNow(new Date(n.time), { locale: vi })}`
                            : formatDistanceToNow(new Date(n.time), { locale: vi, addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
          <div className="p-2 border-t border-gray-800 text-center">
            <button
              onClick={() => { navigate('/admin/tasks'); setOpen(false) }}
              className="text-[11px] text-gray-500 hover:text-white"
            >
              Xem tất cả tasks →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
