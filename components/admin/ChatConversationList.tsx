import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageCircle, ChevronDown, ChevronRight, Inbox as InboxIcon, StickyNote } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../services/supabase'

interface Props {
  leadId?: string
  customerId?: string
  /** Extra fallback: also include conversations whose visitor email matches this. */
  emailFallback?: string
}

interface ChatConversationRow {
  id: string
  display_id: number
  inbox_id: string
  status: 'open' | 'pending' | 'snoozed' | 'resolved'
  last_activity_at: string
  created_at: string
  source_url: string | null
  lead_id: string | null
  customer_id: string | null
  inbox?: { id: string; name: string; channel_type: string } | null
  message_count?: number
  first_message?: string | null
  last_message?: string | null
}

interface ChatMessageRow {
  id: string
  content: string | null
  sender_type: 'contact' | 'agent' | 'system' | 'bot'
  private: boolean
  created_at: string
}

const STATUS_STYLE: Record<string, string> = {
  open: 'border-green-500/40 text-green-400 bg-green-500/10',
  pending: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
  snoozed: 'border-blue-500/40 text-blue-300 bg-blue-500/10',
  resolved: 'border-neutral-700 text-neutral-400 bg-neutral-800/40',
}

const ChatConversationList: React.FC<Props> = ({ leadId, customerId, emailFallback }) => {
  const [conversations, setConversations] = useState<ChatConversationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messagesById, setMessagesById] = useState<Record<string, ChatMessageRow[]>>({})
  const [loadingThread, setLoadingThread] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch by lead_id / customer_id, and (optionally) by email match on the linked lead.
      // The RLS policy on chat_conversations restricts to admin/sales — RLS also lets
      // support role read if they've been granted; either way, we query directly.
      const filters: string[] = []
      if (leadId) filters.push(`lead_id.eq.${leadId}`)
      if (customerId) filters.push(`customer_id.eq.${customerId}`)

      let convs: ChatConversationRow[] = []

      if (filters.length) {
        const { data, error: err } = await supabase
          .from('chat_conversations')
          .select('id, display_id, inbox_id, status, last_activity_at, created_at, source_url, lead_id, customer_id')
          .or(filters.join(','))
          .order('last_activity_at', { ascending: false })
          .limit(50)
        if (err) throw err
        convs = (data || []) as ChatConversationRow[]
      }

      // Fallback: also include conversations linked to a lead with matching email
      if (emailFallback) {
        const email = emailFallback.trim().toLowerCase()
        if (email) {
          const { data: matchingLeads } = await supabase
            .from('leads')
            .select('id')
            .eq('email', email)
            .limit(20)
          const leadIds = (matchingLeads || []).map(l => l.id)
          if (leadIds.length) {
            const { data: extraConvs } = await supabase
              .from('chat_conversations')
              .select('id, display_id, inbox_id, status, last_activity_at, created_at, source_url, lead_id, customer_id')
              .in('lead_id', leadIds)
              .order('last_activity_at', { ascending: false })
              .limit(50)
            for (const c of (extraConvs || []) as ChatConversationRow[]) {
              if (!convs.some(existing => existing.id === c.id)) convs.push(c)
            }
          }
        }
      }

      convs.sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())

      // Batch-load inbox names + message counts + first/last message preview
      const inboxIds = Array.from(new Set(convs.map(c => c.inbox_id).filter(Boolean)))
      const convIds = convs.map(c => c.id)

      const [{ data: inboxRows }, { data: msgRows }] = await Promise.all([
        inboxIds.length
          ? supabase.from('chat_inboxes').select('id, name, channel_type').in('id', inboxIds)
          : Promise.resolve({ data: [] as { id: string; name: string; channel_type: string }[] }),
        convIds.length
          ? supabase
              .from('chat_messages')
              .select('conversation_id, content, sender_type, created_at, private')
              .in('conversation_id', convIds)
              .order('created_at', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
      ])

      const inboxMap = new Map<string, { id: string; name: string; channel_type: string }>()
      ;(inboxRows || []).forEach(i => inboxMap.set(i.id, i))

      const msgsByConv = new Map<string, { count: number; first?: string; last?: string }>()
      ;(msgRows || []).forEach((m: any) => {
        if (m.private) return
        const bucket = msgsByConv.get(m.conversation_id) || { count: 0 }
        bucket.count += 1
        if (!bucket.first) bucket.first = (m.content || '').slice(0, 140)
        bucket.last = (m.content || '').slice(0, 140)
        msgsByConv.set(m.conversation_id, bucket)
      })

      const enriched = convs.map(c => ({
        ...c,
        inbox: inboxMap.get(c.inbox_id) || null,
        message_count: msgsByConv.get(c.id)?.count || 0,
        first_message: msgsByConv.get(c.id)?.first || null,
        last_message: msgsByConv.get(c.id)?.last || null,
      }))

      setConversations(enriched)
    } catch (e: any) {
      console.error('[ChatConversationList] load error', e)
      setError(e?.message || 'Không tải được lịch sử chat.')
    } finally {
      setLoading(false)
    }
  }, [leadId, customerId, emailFallback])

  useEffect(() => { load() }, [load])

  const toggle = async (convId: string) => {
    if (expandedId === convId) {
      setExpandedId(null)
      return
    }
    setExpandedId(convId)
    if (!messagesById[convId]) {
      setLoadingThread(m => ({ ...m, [convId]: true }))
      try {
        const { data, error: err } = await supabase
          .from('chat_messages')
          .select('id, content, sender_type, private, created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true })
        if (err) throw err
        setMessagesById(m => ({ ...m, [convId]: (data || []) as ChatMessageRow[] }))
      } catch (e: any) {
        console.error('[ChatConversationList] thread load error', e)
        setMessagesById(m => ({ ...m, [convId]: [] }))
      } finally {
        setLoadingThread(m => ({ ...m, [convId]: false }))
      }
    }
  }

  const empty = useMemo(() => !loading && conversations.length === 0, [loading, conversations])

  if (loading) {
    return (
      <div className="py-6 flex justify-center text-neutral-500">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
        {error}
      </div>
    )
  }

  if (empty) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-xs">
          {leadId
            ? 'Chưa có cuộc chat nào với lead này.'
            : 'Chưa có cuộc chat nào với khách hàng này.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {conversations.map(c => {
        const expanded = expandedId === c.id
        return (
          <div key={c.id} className="border border-gray-700 rounded-lg bg-gray-800/40 overflow-hidden">
            <button
              onClick={() => toggle(c.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-800/70 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {expanded ? <ChevronDown size={12} className="text-gray-500 shrink-0" /> : <ChevronRight size={12} className="text-gray-500 shrink-0" />}
                  <span className="text-xs font-medium text-white truncate">
                    {c.first_message || `Conversation #${c.display_id}`}
                  </span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STATUS_STYLE[c.status] || STATUS_STYLE.open}`}>
                  {c.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-gray-500 pl-4 flex-wrap">
                {c.inbox && (
                  <span className="flex items-center gap-1">
                    <InboxIcon size={9} /> {c.inbox.name}
                  </span>
                )}
                <span>#{c.display_id}</span>
                <span>{c.message_count} tin nhắn</span>
                <span>
                  {formatDistanceToNow(new Date(c.last_activity_at), { addSuffix: true, locale: vi })}
                </span>
              </div>
            </button>

            {expanded && (
              <div className="border-t border-gray-700 bg-gray-900/60 p-3 max-h-72 overflow-y-auto space-y-1.5">
                {loadingThread[c.id] ? (
                  <div className="flex justify-center py-2 text-neutral-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </div>
                ) : (messagesById[c.id] || []).length === 0 ? (
                  <p className="text-xs text-gray-500 py-2 text-center">Chưa có tin nhắn</p>
                ) : (
                  (messagesById[c.id] || []).map(m => {
                    const isContact = m.sender_type === 'contact'
                    const isSystem = m.sender_type === 'system'
                    const isNote = m.private
                    return (
                      <div
                        key={m.id}
                        className={`flex ${isContact ? 'justify-start' : isSystem ? 'justify-center' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[85%] px-2.5 py-1.5 rounded-lg text-[11px] leading-snug ${
                            isSystem
                              ? 'bg-transparent text-neutral-500 italic'
                              : isNote
                                ? 'bg-amber-500/10 border border-amber-500/30 text-amber-100'
                                : isContact
                                  ? 'bg-gray-800 text-gray-100'
                                  : 'bg-blue-500/20 border border-blue-500/30 text-blue-100'
                          }`}
                        >
                          {isNote && (
                            <div className="text-[9px] text-amber-400 uppercase tracking-wider mb-0.5 flex items-center gap-1">
                              <StickyNote size={8} /> nội bộ
                            </div>
                          )}
                          <div className="whitespace-pre-wrap break-words">{m.content || ''}</div>
                          <div className="text-[9px] text-gray-500 mt-0.5">
                            {new Date(m.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ChatConversationList
