import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { MessageCircle, Send, Loader2, Circle, CheckCircle2, User, Mail, Phone, Tag, ExternalLink, Inbox as InboxIcon, StickyNote, MoreVertical, Filter, Settings, Copy, Check, ArrowRight, UserPlus, Zap } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { fetchPipelineStages } from '../../services/api'
import type { Lead, PipelineStage, Profile } from '../../types'
import LeadDetail from './LeadDetail'
import StudentDetailDrawer from './StudentDetailDrawer'

interface CannedResponse {
  id: string
  title: string
  body: string
  shortcut: string | null
}

interface Inbox {
  id: string; name: string; channel_type: string; channel_config: any
  website_token: string; is_active: boolean; auto_assign_to?: string | null
  greeting_enabled?: boolean; greeting_message?: string
}
interface Contact {
  type: 'lead' | 'customer'
  id: string; email: string
  name?: string; display_name?: string; phone?: string; source?: string; tags?: string[]
}
interface Conversation {
  id: string; display_id: number
  inbox_id: string
  lead_id?: string | null; customer_id?: string | null; assignee_id?: string | null
  status: 'open' | 'pending' | 'snoozed' | 'resolved'
  priority?: string | null; labels?: string[]
  last_activity_at: string; agent_last_seen_at?: string | null
  source_url?: string | null
  created_at: string
  contact?: Contact | null
  last_message?: { content: string; sender_type: string; created_at: string } | null
  unread?: boolean
}
interface Message {
  id: string; content: string; content_type: string
  sender_type: 'contact' | 'agent' | 'system' | 'bot'
  sender_id?: string | null; private: boolean; created_at: string
}

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}), ...(opts.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export default function ChatView() {
  const [inboxes, setInboxes] = useState<Inbox[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: 'open', assignee: '' as '' | 'me' | 'unassigned', inbox_id: '' })
  const [inboxManagerOpen, setInboxManagerOpen] = useState(false)

  // Cross-links: open Lead / Student drawer from contact sidebar
  const [leadDrawer, setLeadDrawer] = useState<Lead | null>(null)
  const [studentDrawer, setStudentDrawer] = useState<Profile | null>(null)
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)

  // Canned responses (shared across all conversations)
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([])

  const loadCanned = useCallback(async () => {
    try {
      const r = await api<{ canned_responses: CannedResponse[] }>('/api/chat/canned-responses')
      setCannedResponses(r.canned_responses || [])
    } catch (e) {
      // Non-fatal; just log
      console.warn('[ChatView] canned responses load failed:', e)
    }
  }, [])

  useEffect(() => {
    fetchPipelineStages().then(setPipelineStages).catch(() => setPipelineStages([]))
    loadCanned()
  }, [loadCanned])

  const openLeadDrawer = useCallback(async (leadId: string) => {
    setDrawerLoading(true); setDrawerError(null)
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*, pipeline_stage:pipeline_stages(*)')
        .eq('id', leadId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Không tìm thấy lead')
      setLeadDrawer(data as Lead)
    } catch (e: any) {
      setDrawerError(e?.message || 'Không mở được lead')
    } finally {
      setDrawerLoading(false)
    }
  }, [])

  const openStudentDrawer = useCallback(async (customerId: string) => {
    setDrawerLoading(true); setDrawerError(null)
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Không tìm thấy khách hàng')
      setStudentDrawer(data as Profile)
    } catch (e: any) {
      setDrawerError(e?.message || 'Không mở được khách hàng')
    } finally {
      setDrawerLoading(false)
    }
  }, [])

  const createLeadFromChat = useCallback(async (payload: { email: string; name?: string; phone?: string; source_url?: string }, conversationId: string) => {
    setDrawerLoading(true); setDrawerError(null)
    try {
      // Find or create lead
      const emailLower = payload.email.trim().toLowerCase()
      const { data: existing } = await supabase
        .from('leads')
        .select('*, pipeline_stage:pipeline_stages(*)')
        .eq('email', emailLower)
        .maybeSingle()

      let lead: Lead | null = existing as Lead | null
      if (!lead) {
        const { data: stages } = await supabase
          .from('pipeline_stages')
          .select('id')
          .order('order_index', { ascending: true })
          .limit(1)
        const { data: created, error: createErr } = await supabase
          .from('leads')
          .insert({
            name: payload.name || emailLower.split('@')[0],
            email: emailLower,
            phone: payload.phone || null,
            source: 'chat',
            pipeline_stage_id: stages?.[0]?.id || null,
            score: 10,
            notes: payload.source_url ? `Từ chat — ${payload.source_url}` : 'Từ chat',
          })
          .select('*, pipeline_stage:pipeline_stages(*)')
          .single()
        if (createErr) throw createErr
        lead = created as Lead
      }

      // Link the conversation to this lead so future chat sessions attach
      if (lead) {
        await supabase.from('chat_conversations').update({ lead_id: lead.id }).eq('id', conversationId)
      }
      if (lead) setLeadDrawer(lead)
    } catch (e: any) {
      setDrawerError(e?.message || 'Không tạo được lead')
    } finally {
      setDrawerLoading(false)
    }
  }, [])

  const loadInboxes = useCallback(async () => {
    try {
      const r = await api<{ inboxes: Inbox[] }>('/api/chat/inboxes')
      setInboxes(r.inboxes)
    } catch (e) { console.error(e) }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (filter.status) q.set('status', filter.status)
      if (filter.assignee) q.set('assignee', filter.assignee)
      if (filter.inbox_id) q.set('inbox_id', filter.inbox_id)
      const r = await api<{ conversations: Conversation[] }>(`/api/chat/conversations?${q}`)
      setConversations(r.conversations)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => { loadInboxes() }, [loadInboxes])
  useEffect(() => { loadList() }, [loadList])

  // Realtime: subscribe to new messages in ANY conversation → refresh list preview
  useEffect(() => {
    const channel = supabase
      .channel('chat-messages-global')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => { loadList() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadList])

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col bg-neutral-950">
      {/* TOP BAR: title + filters + settings (spans full width) */}
      <div className="border-b border-neutral-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 mr-2">
          <MessageCircle className="w-5 h-5" style={{ color: 'var(--color-mission-accent)' }} />
          <h2 className="font-semibold">Chat</h2>
        </div>
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          className="px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs min-w-[110px]">
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="snoozed">Snoozed</option>
          <option value="resolved">Resolved</option>
          <option value="">All statuses</option>
        </select>
        <select value={filter.assignee} onChange={e => setFilter(f => ({ ...f, assignee: e.target.value as any }))}
          className="px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs min-w-[140px]">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={filter.inbox_id} onChange={e => setFilter(f => ({ ...f, inbox_id: e.target.value }))}
          className="px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs min-w-[160px]">
          <option value="">All inboxes ({inboxes.length})</option>
          {inboxes.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => setInboxManagerOpen(true)}
          className="p-1.5 hover:bg-neutral-800 rounded" title="Manage inboxes">
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
      {/* LEFT: conversation list */}
      <div className="w-80 border-r border-neutral-800 flex flex-col flex-shrink-0">
        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-neutral-500"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-neutral-500 text-xs">Chưa có conversation nào</div>
          ) : conversations.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-neutral-800/50 hover:bg-neutral-900 transition ${
                selectedId === c.id ? 'bg-neutral-900' : ''
              }`}
              style={selectedId === c.id ? { borderLeft: '3px solid var(--color-mission-accent)' } : { borderLeft: '3px solid transparent' }}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {c.unread && <Circle className="w-2 h-2 text-blue-400 fill-current flex-shrink-0" />}
                  <span className="text-sm font-medium truncate">
                    {c.contact?.name || c.contact?.display_name || c.contact?.email || `#${c.display_id}`}
                  </span>
                </div>
                <span className="text-[10px] text-neutral-500 flex-shrink-0">
                  {new Date(c.last_activity_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-[11px] text-neutral-500 truncate">
                {c.last_message?.sender_type === 'agent' ? '→ ' : ''}{c.last_message?.content || '(no messages)'}
              </div>
              <div className="flex items-center gap-1 mt-1">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  c.status === 'open' ? 'border-green-500/30 text-green-400' :
                  c.status === 'resolved' ? 'border-neutral-700 text-neutral-500' :
                  'border-amber-500/30 text-amber-400'
                }`}>{c.status}</span>
                <span className="text-[9px] text-neutral-600">#{c.display_id}</span>
                {c.contact?.type === 'customer' && <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">customer</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* CENTER: chat view */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedId ? (
          <ConversationDetail
            key={selectedId}
            conversationId={selectedId}
            onUpdate={loadList}
            cannedResponses={cannedResponses}
            onOpenLead={openLeadDrawer}
            onOpenStudent={openStudentDrawer}
            onCreateLeadFromChat={createLeadFromChat}
            drawerLoading={drawerLoading}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            <div className="text-center">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 text-neutral-700" />
              <p className="text-sm">Chọn 1 conversation để bắt đầu</p>
            </div>
          </div>
        )}
      </div>

      </div>{/* /flex flex-1 */}

      {inboxManagerOpen && (
        <InboxManagerModal inboxes={inboxes} onClose={() => setInboxManagerOpen(false)} onSaved={loadInboxes} />
      )}

      {drawerError && (
        <div className="fixed bottom-4 right-4 z-[70] bg-red-500/20 border border-red-500/40 text-red-300 px-3 py-2 rounded text-xs max-w-xs shadow-lg">
          {drawerError}
          <button className="ml-2 text-red-100" onClick={() => setDrawerError(null)}>×</button>
        </div>
      )}

      {leadDrawer && (
        <LeadDetail
          lead={leadDrawer}
          stages={pipelineStages}
          onClose={() => setLeadDrawer(null)}
          onUpdate={updated => setLeadDrawer(updated)}
        />
      )}

      {studentDrawer && (
        <StudentDetailDrawer
          student={studentDrawer}
          onClose={() => setStudentDrawer(null)}
          onUpdate={updated => setStudentDrawer(updated)}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// CONVERSATION DETAIL
// ══════════════════════════════════════════════════════════════════════════
interface ConversationDetailProps {
  conversationId: string
  onUpdate: () => void
  cannedResponses: CannedResponse[]
  onOpenLead: (leadId: string) => void
  onOpenStudent: (customerId: string) => void
  onCreateLeadFromChat: (payload: { email: string; name?: string; phone?: string; source_url?: string }, conversationId: string) => void
  drawerLoading: boolean
}

function ConversationDetail({
  conversationId, onUpdate,
  cannedResponses, onOpenLead, onOpenStudent, onCreateLeadFromChat, drawerLoading,
}: ConversationDetailProps) {
  const [detail, setDetail] = useState<{ conversation: Conversation; messages: Message[]; contact: any; inbox: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [isNote, setIsNote] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Canned-response dropdown state — shown when reply starts with '/'
  const [cannedIdx, setCannedIdx] = useState(0)
  const cannedFilter = useMemo(() => {
    const trimmed = reply.trimStart()
    if (!trimmed.startsWith('/')) return null
    return trimmed.slice(1).toLowerCase()
  }, [reply])
  const cannedMatches = useMemo(() => {
    if (cannedFilter === null) return []
    const q = cannedFilter.trim()
    return cannedResponses.filter(cr => {
      if (!q) return true
      return (
        (cr.shortcut || '').toLowerCase().startsWith(q) ||
        cr.title.toLowerCase().includes(q)
      )
    }).slice(0, 8)
  }, [cannedFilter, cannedResponses])
  useEffect(() => { setCannedIdx(0) }, [cannedFilter])
  const cannedOpen = cannedFilter !== null && cannedMatches.length > 0

  const insertCanned = (cr: CannedResponse) => {
    setReply(cr.body)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<any>(`/api/chat/conversations?id=${conversationId}`)
      setDetail(r)
      // Mark as read
      await api(`/api/chat/conversations?action=mark-read&id=${conversationId}`, { method: 'POST', body: '{}' })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [conversationId])

  useEffect(() => { load() }, [load])

  // Realtime: subscribe to new messages IN THIS conversation
  // Dedup by message id — StrictMode double-mount, retry, or overlapping subscriptions
  // must never cause the same message to appear twice.
  useEffect(() => {
    const channel = supabase
      .channel(`chat-conv-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, payload => {
        const newMsg = payload.new as any
        setDetail(prev => {
          if (!prev) return prev
          if (prev.messages.some(m => m.id === newMsg.id)) return prev
          return { ...prev, messages: [...prev.messages, newMsg] }
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId])

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [detail?.messages?.length])

  // Ref guard against re-entry: setSending(true) is async, so a second Enter
  // fired within the same tick would slip through and POST twice.
  const sendingRef = useRef(false)
  const send = async () => {
    if (sendingRef.current) return
    if (!reply.trim()) return
    sendingRef.current = true
    setSending(true)
    // Snapshot + optimistic clear so a paused server call can't be double-sent
    const content = reply
    setReply('')
    try {
      await api(`/api/chat/conversations?action=${isNote ? 'note' : 'reply'}&id=${conversationId}`, {
        method: 'POST', body: JSON.stringify({ content }),
      })
      onUpdate()
    } catch (e: any) {
      setReply(content)   // restore on failure so user can retry
      alert(e.message)
    }
    finally { sendingRef.current = false; setSending(false) }
  }

  const changeStatus = async (status: string) => {
    await api(`/api/chat/conversations?action=status&id=${conversationId}`, {
      method: 'POST', body: JSON.stringify({ status }),
    })
    load(); onUpdate()
  }

  if (loading || !detail) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>

  const { conversation: c, messages, contact, inbox } = detail

  return (
    <div className="flex flex-1 min-w-0">
      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold">{contact?.name || contact?.display_name || contact?.email || `Conversation #${c.display_id}`}</span>
              <span className="text-[10px] text-neutral-500">#{c.display_id}</span>
              {inbox && <span className="text-[10px] px-1.5 py-0.5 bg-neutral-800 rounded">{inbox.name}</span>}
            </div>
            <div className="text-[11px] text-neutral-500 truncate">{contact?.email || '(no email)'}</div>
          </div>
          <div className="flex items-center gap-1">
            {c.status !== 'resolved' && (
              <button onClick={() => changeStatus('resolved')}
                className="text-xs px-2 py-1 border border-green-500/50 text-green-400 rounded hover:bg-green-500/10 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Resolve
              </button>
            )}
            {c.status === 'resolved' && (
              <button onClick={() => changeStatus('open')}
                className="text-xs px-2 py-1 border border-neutral-700 rounded hover:bg-neutral-800">
                Re-open
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-neutral-950">
          {messages.length === 0 ? (
            <p className="text-center text-neutral-500 text-xs py-8">No messages yet</p>
          ) : messages.map(m => (
            <MessageBubble key={m.id} m={m} />
          ))}
        </div>

        <div className={`border-t border-neutral-800 p-3 ${isNote ? 'bg-amber-500/5' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setIsNote(false)}
              className={`text-xs px-2 py-1 rounded ${!isNote ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-white'}`}>
              Reply
            </button>
            <button onClick={() => setIsNote(true)}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${isNote ? 'bg-amber-500/20 text-amber-400' : 'text-neutral-500 hover:text-white'}`}>
              <StickyNote className="w-3 h-3" /> Internal note
            </button>
          </div>
          <div className="flex gap-2 relative">
            <div className="flex-1 relative">
              <textarea ref={textareaRef} value={reply} onChange={e => setReply(e.target.value)}
                onKeyDown={e => {
                  if (cannedOpen) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setCannedIdx(i => Math.min(i + 1, cannedMatches.length - 1)); return }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setCannedIdx(i => Math.max(i - 1, 0)); return }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      // Close the dropdown but preserve any typed characters
                      if (reply.startsWith('/')) setReply(reply.replace(/^\//, ''))
                      return
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      const chosen = cannedMatches[cannedIdx]
                      if (chosen) insertCanned(chosen)
                      return
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const chosen = cannedMatches[cannedIdx]
                      if (chosen) insertCanned(chosen)
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }}
                rows={2}
                placeholder={isNote ? 'Nội bộ (visitor không thấy)...' : 'Nhập reply... (gõ "/" để chọn snippet, Enter để gửi, Shift+Enter xuống dòng)'}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm resize-none" />

              {cannedOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-neutral-950 border border-neutral-700 rounded shadow-lg max-h-56 overflow-y-auto z-30">
                  <div className="px-2 py-1 text-[10px] text-neutral-500 uppercase tracking-wider border-b border-neutral-800 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Snippets — Enter/Tab để chèn, Esc để huỷ
                  </div>
                  {cannedMatches.map((cr, i) => (
                    <button
                      key={cr.id}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); insertCanned(cr) }}
                      onMouseEnter={() => setCannedIdx(i)}
                      className={`w-full text-left px-2.5 py-2 border-b border-neutral-800/70 last:border-0 transition-colors ${
                        i === cannedIdx ? 'bg-neutral-800' : 'hover:bg-neutral-900'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-white truncate">{cr.title}</span>
                        {cr.shortcut && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-800 text-neutral-400 rounded">/{cr.shortcut}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-500 truncate">{cr.body}</div>
                    </button>
                  ))}
                  {cannedResponses.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-neutral-500">
                      Chưa có snippet nào — tạo trong Cài đặt → Chat snippets.
                    </div>
                  )}
                </div>
              )}
            </div>
            <button onClick={send} disabled={sending || !reply.trim()}
              style={{ background: isNote ? '#F59E0B' : 'var(--color-mission-accent)', color: '#000' }}
              className="px-4 py-2 rounded font-semibold text-sm flex items-center gap-1 hover:opacity-90 disabled:opacity-40">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: contact sidebar */}
      <div className="w-64 border-l border-neutral-800 p-4 space-y-4 overflow-y-auto flex-shrink-0">
        <div>
          <h3 className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Contact</h3>
          {contact ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2"><User className="w-3 h-3 text-neutral-500" /> {contact.name || contact.display_name || '-'}</div>
              <div className="flex items-center gap-2"><Mail className="w-3 h-3 text-neutral-500" /> <span className="truncate">{contact.email}</span></div>
              {contact.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3 text-neutral-500" /> {contact.phone}</div>}
              <div className="text-neutral-500">
                Type: <span className={contact.type === 'customer' ? 'text-blue-400' : 'text-green-400'}>{contact.type}</span>
              </div>
              {contact.tags && contact.tags.length > 0 && (
                <div>
                  <div className="text-neutral-500 mb-1 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 bg-neutral-800 rounded">{t}</span>)}
                  </div>
                </div>
              )}
              {contact.source && <div className="text-[10px] text-neutral-500">Source: {contact.source}</div>}

              {/* Cross-links to Lead / Customer detail drawers */}
              <div className="pt-2 flex flex-col gap-1.5">
                {contact.type === 'customer' && c.customer_id && (
                  <button
                    onClick={() => onOpenStudent(c.customer_id!)}
                    disabled={drawerLoading}
                    className="w-full flex items-center justify-between gap-1.5 text-[11px] px-2 py-1.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                  >
                    <span>Xem khách hàng</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {contact.type === 'lead' && c.lead_id && (
                  <button
                    onClick={() => onOpenLead(c.lead_id!)}
                    disabled={drawerLoading}
                    className="w-full flex items-center justify-between gap-1.5 text-[11px] px-2 py-1.5 rounded bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20 disabled:opacity-50"
                  >
                    <span>Xem lead gốc</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {/* Also allow jumping to the underlying lead when this is now a customer */}
                {contact.type === 'customer' && c.lead_id && (
                  <button
                    onClick={() => onOpenLead(c.lead_id!)}
                    disabled={drawerLoading}
                    className="w-full flex items-center justify-between gap-1.5 text-[11px] px-2 py-1.5 rounded border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    <span>Xem lead gốc</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">Anonymous visitor</p>
          )}

          {/* Offer to create a lead when there's no lead / customer link but we have an email */}
          {(!c.lead_id && !c.customer_id) && contact?.email && (
            <button
              onClick={() => onCreateLeadFromChat({
                email: contact.email,
                name: contact.name || contact.display_name,
                phone: contact.phone,
                source_url: c.source_url || undefined,
              }, c.id)}
              disabled={drawerLoading}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 rounded font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            >
              <UserPlus className="w-3 h-3" /> Tạo lead từ chat
            </button>
          )}
        </div>

        <div>
          <h3 className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Conversation</h3>
          <div className="space-y-1 text-xs text-neutral-400">
            <div>Started: {new Date(c.created_at).toLocaleString('vi-VN')}</div>
            <div>Last activity: {new Date(c.last_activity_at).toLocaleString('vi-VN')}</div>
            {c.source_url && <div className="truncate"><a href={c.source_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">Source page <ExternalLink className="w-2.5 h-2.5" /></a></div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ m }: { m: Message }) {
  const isContact = m.sender_type === 'contact'
  const isSystem = m.sender_type === 'system'
  const isNote = m.private
  return (
    <div className={`flex ${isContact ? 'justify-start' : isSystem ? 'justify-center' : 'justify-end'}`}>
      <div className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
        isSystem ? 'bg-transparent text-neutral-500 italic text-[11px]' :
        isNote ? 'bg-amber-500/10 border border-amber-500/30 text-amber-100' :
        isContact ? 'bg-neutral-800 text-neutral-100' :
        'bg-blue-500/20 border border-blue-500/30 text-blue-100'
      }`}>
        {isNote && <div className="text-[9px] text-amber-400 uppercase tracking-wider mb-1">Internal note</div>}
        <div className="whitespace-pre-wrap break-words">{m.content}</div>
        <div className="text-[9px] text-neutral-500 mt-1">
          {new Date(m.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// INBOX MANAGER MODAL
// ══════════════════════════════════════════════════════════════════════════
function InboxManagerModal({ inboxes, onClose, onSaved }: { inboxes: Inbox[]; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState<Partial<Inbox> | null>(null)
  const [saving, setSaving] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const save = async () => {
    if (!editing?.name) { alert('Tên inbox required'); return }
    setSaving(true)
    try {
      await api('/api/chat/inboxes', { method: 'POST', body: JSON.stringify(editing) })
      setEditing(null)
      onSaved()
    } catch (e: any) { alert(e.message) }
    finally { setSaving(false) }
  }

  const del = async (id: string, name: string) => {
    if (!confirm(`Xoá inbox "${name}"? (mọi conversation liên quan cũng bị xoá)`)) return
    await api(`/api/chat/inboxes?id=${id}`, { method: 'DELETE' })
    onSaved()
  }

  const copyEmbed = (token: string) => {
    const snippet = `<script src="${window.location.origin}/api/chat/widget/embed.js?token=${token}" async></script>`
    navigator.clipboard.writeText(snippet)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  if (editing) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-xl w-full my-8 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <h3 className="text-lg font-semibold">{editing.id ? 'Edit inbox' : 'New inbox'}</h3>
            <button onClick={() => setEditing(null)}>×</button>
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Name *</label>
            <input value={editing.name || ''} onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Channel</label>
            <select value={editing.channel_type || 'web_widget'} onChange={e => setEditing(prev => ({ ...prev, channel_type: e.target.value }))}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm">
              <option value="web_widget">Website Widget</option>
              <option value="email">Email (coming soon)</option>
              <option value="facebook">Facebook (coming soon)</option>
              <option value="zalo">Zalo OA (coming soon)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Widget color</label>
              <input type="color" value={(editing.channel_config as any)?.widget_color || '#B6FF00'}
                onChange={e => setEditing(prev => ({ ...prev, channel_config: { ...(prev?.channel_config || {}), widget_color: e.target.value }}))}
                className="w-full h-9 bg-neutral-950 border border-neutral-800 rounded" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Position</label>
              <select value={(editing.channel_config as any)?.position || 'bottom-right'}
                onChange={e => setEditing(prev => ({ ...prev, channel_config: { ...(prev?.channel_config || {}), position: e.target.value }}))}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm">
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Welcome title</label>
            <input value={(editing.channel_config as any)?.welcome_title || ''}
              onChange={e => setEditing(prev => ({ ...prev, channel_config: { ...(prev?.channel_config || {}), welcome_title: e.target.value }}))}
              placeholder="Chào bạn 👋"
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Welcome tagline</label>
            <input value={(editing.channel_config as any)?.welcome_tagline || ''}
              onChange={e => setEditing(prev => ({ ...prev, channel_config: { ...(prev?.channel_config || {}), welcome_tagline: e.target.value }}))}
              placeholder="Chúng tôi sẵn sàng hỗ trợ bạn"
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Greeting message (auto-send on new conversation)</label>
            <textarea value={editing.greeting_message || ''} onChange={e => setEditing(prev => ({ ...prev, greeting_message: e.target.value }))}
              rows={2} className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm"
              placeholder="Xin chào! Chúng tôi có thể giúp gì?" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.greeting_enabled !== false}
              onChange={e => setEditing(prev => ({ ...prev, greeting_enabled: e.target.checked }))} />
            Enable auto-greeting
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.is_active !== false}
              onChange={e => setEditing(prev => ({ ...prev, is_active: e.target.checked }))} />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-neutral-800">
            <button onClick={() => setEditing(null)} className="text-sm text-neutral-500 hover:text-white px-3">Huỷ</button>
            <button onClick={save} disabled={saving}
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              className="px-4 py-2 text-sm font-semibold rounded flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-3xl w-full p-5 space-y-3 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <InboxIcon className="w-5 h-5" style={{ color: 'var(--color-mission-accent)' }} />
            <h3 className="text-lg font-semibold">Chat Inboxes</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing({ channel_type: 'web_widget', is_active: true, greeting_enabled: true, channel_config: { widget_color: '#B6FF00', position: 'bottom-right', pre_chat_form_enabled: true }})}
              style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              className="px-3 py-1.5 text-sm font-semibold rounded">+ New</button>
            <button onClick={onClose} className="text-neutral-500 hover:text-white">×</button>
          </div>
        </div>
        {inboxes.length === 0 ? (
          <div className="text-center py-10 text-neutral-500 text-sm">
            Chưa có inbox. Bấm "+ New" để tạo inbox đầu tiên (dùng cho website chat widget).
          </div>
        ) : (
          <div className="space-y-2">
            {inboxes.map(i => (
              <div key={i.id} className="border border-neutral-800 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {i.name}
                      <span className="text-[10px] px-1.5 py-0.5 bg-neutral-800 rounded font-mono">{i.channel_type}</span>
                      {i.is_active ? <span className="text-[10px] text-green-400">● active</span> : <span className="text-[10px] text-neutral-500">● inactive</span>}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono truncate mt-0.5">token: {i.website_token}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => copyEmbed(i.website_token)}
                      className="text-xs px-2 py-1 border border-neutral-700 rounded hover:bg-neutral-800 flex items-center gap-1"
                      title="Copy embed script">
                      {copiedToken === i.website_token ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      Embed
                    </button>
                    <button onClick={() => setEditing(i)}
                      className="text-xs px-2 py-1 border border-neutral-700 rounded hover:bg-neutral-800">Edit</button>
                    <button onClick={() => del(i.id, i.name)}
                      className="text-xs px-2 py-1 border border-red-500/30 text-red-400 rounded hover:bg-red-500/10">×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
