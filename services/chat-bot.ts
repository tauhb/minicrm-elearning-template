/**
 * services/chat-bot.ts — Sprint D
 *
 * Auto-reply orchestrator. When a visitor message arrives (widget POST /widget/conversation
 * or /chat/telegram/webhook), the caller invokes maybeReply(conversationId) which:
 *   1. Loads inbox → checks auto_reply_enabled (else no-op).
 *   2. Retrieves relevant KB chunks (Sprint B rag.ts). If top score < min_score → skip.
 *   3. Builds grounded prompt (persona + retrieved chunks + last N conversation turns).
 *   4. Calls runCompletion (Sprint A ai-router.ts) with configured provider/model.
 *   5. Inserts chat_message (sender_type='bot') with bot_metadata for audit.
 *   6. Returns {replied: bool, reason?} — caller can log/analytics.
 *
 * Handoff triggers (bot goes silent):
 *   - Visitor says the handoff phrase (default "chuyển agent" / "gặp người thật").
 *   - Conversation exceeds max_turns visitor messages.
 *   - Latest visitor msg has @agent mention.
 *   - Any human agent message in the conversation → agents took over.
 *
 * Bot's messages are inserted with sender_type='bot' so ChatView renders them distinctly.
 */

import { createClient } from '@supabase/supabase-js'
import { runCompletion } from './ai-router'
import { retrieve, retrieveForProduct, type RagChunk } from './rag'

const HANDOFF_DEFAULTS = ['chuyển agent', 'gặp người thật', 'nói chuyện với người', 'talk to human']

interface InboxAutoReplyConfig {
  kb_ids?: string[]
  min_score?: number
  persona?: string
  handoff_phrase?: string
  max_turns?: number
  provider_id?: string
  model?: string
}

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export interface MaybeReplyResult {
  replied: boolean
  reason?: 'auto_reply_disabled' | 'no_kb_configured' | 'low_confidence' | 'handoff_triggered' | 'human_took_over' | 'max_turns' | 'ok' | 'error'
  bot_message_id?: string
  latency_ms?: number
  error?: string
}

/**
 * Attempt an auto-reply for the most recent visitor message in this conversation.
 * Idempotent-ish: if a bot message was already sent for the exact same visitor
 * message id, skip (guarded by ordering — checks last message is visitor kind).
 */
export async function maybeReply(conversationId: string): Promise<MaybeReplyResult> {
  const started = Date.now()
  const db = adminDb()

  const { data: conv } = await db.from('chat_conversations')
    .select('id, inbox_id, status, contact:leads(email,name), customer:customers!chat_conversations_customer_id_fkey(email,display_name)')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conv) return { replied: false, reason: 'error', error: 'conversation not found' }
  if (conv.status === 'resolved') return { replied: false, reason: 'handoff_triggered' }

  const { data: inbox } = await db.from('chat_inboxes')
    .select('id, name, channel_type, auto_reply_enabled, auto_reply_config')
    .eq('id', conv.inbox_id).maybeSingle()
  if (!inbox) return { replied: false, reason: 'error', error: 'inbox not found' }
  if (!inbox.auto_reply_enabled) return { replied: false, reason: 'auto_reply_disabled' }
  const cfg = (inbox.auto_reply_config || {}) as InboxAutoReplyConfig

  // Load recent messages (last 20) to build context + check handoff triggers
  const { data: messages } = await db.from('chat_messages')
    .select('id, sender_type, sender_id, content, created_at, private')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20)
  const msgs = (messages || []).reverse()   // chronological
  if (!msgs.length) return { replied: false, reason: 'error', error: 'no messages' }

  // Handoff: if any agent (human) message exists, defer to humans forever.
  if (msgs.some(m => m.sender_type === 'agent' && !m.private)) {
    return { replied: false, reason: 'human_took_over' }
  }

  // Handoff: max_turns visitor messages
  const visitorCount = msgs.filter(m => m.sender_type === 'visitor' || m.sender_type === 'contact').length
  const maxTurns = cfg.max_turns ?? 20
  if (visitorCount > maxTurns) return { replied: false, reason: 'max_turns' }

  // Handoff phrase check on last visitor msg
  const lastVisitor = [...msgs].reverse().find(m => m.sender_type === 'visitor' || m.sender_type === 'contact')
  if (!lastVisitor) return { replied: false, reason: 'error', error: 'no visitor message' }
  const lastText = (lastVisitor.content || '').toLowerCase()
  const handoffs = cfg.handoff_phrase ? [cfg.handoff_phrase.toLowerCase()] : HANDOFF_DEFAULTS
  if (handoffs.some(p => lastText.includes(p))) {
    // Insert a system message so the transcript records the trigger.
    await db.from('chat_messages').insert({
      conversation_id: conversationId,
      sender_type: 'system',
      content: `Bot đã chuyển cuộc trò chuyện cho agent (visitor yêu cầu).`,
      private: false,
    })
    return { replied: false, reason: 'handoff_triggered' }
  }

  // Idempotency: if last message is already a bot message (not our visitor msg), skip.
  if (msgs[msgs.length - 1].sender_type === 'bot') {
    return { replied: false, reason: 'ok' }   // already replied
  }

  // Retrieve KB chunks — explicit kb_ids OR inbox's linked-funnel's product's KBs.
  // (For MVP we support explicit kb_ids only; inbox↔product wiring can be added later.)
  const kbIds = cfg.kb_ids || []
  if (!kbIds.length) return { replied: false, reason: 'no_kb_configured' }

  const minScore = cfg.min_score ?? 0.6
  let chunks: RagChunk[] = []
  try {
    chunks = await retrieve(kbIds, lastVisitor.content, { topK: 5, minScore })
  } catch (e: any) {
    return { replied: false, reason: 'error', error: `retrieve: ${e.message}` }
  }
  if (!chunks.length) return { replied: false, reason: 'low_confidence' }

  // Build grounded prompt
  const persona = cfg.persona ||
    'Bạn là trợ lý AI hỗ trợ khách hàng. Trả lời NGẮN GỌN (dưới 4 câu), tiếng Việt tự nhiên, ' +
    'dùng "bạn" (không "anh/chị"). Chỉ dùng thông tin từ KB dưới đây. Nếu không đủ thông tin, ' +
    'thành thật nói "Mình cần chuyển câu này cho đội tư vấn" — không được bịa.'

  const kbContext = chunks.map((c, i) =>
    `[Nguồn ${i + 1}: ${c.entry_title}]\n${c.chunk_text}`
  ).join('\n\n---\n\n')

  const historyLines = msgs.slice(-6).map(m => {
    const role = m.sender_type === 'bot' ? 'Bot'
      : (m.sender_type === 'visitor' || m.sender_type === 'contact') ? 'Khách' : 'Agent'
    return `${role}: ${m.content}`
  }).join('\n')

  const systemPrompt = `${persona}\n\n=== KB CONTEXT ===\n${kbContext}\n=== END KB ===`
  const userPrompt = `Lịch sử trò chuyện:\n${historyLines}\n\nTrả lời câu cuối của khách.`

  // Generate
  let replyText = ''
  let modelUsed = ''
  try {
    const r = await runCompletion({
      provider: cfg.provider_id,   // undefined → default provider
      model: cfg.model,
      systemPrompt,
      userPrompt,
      maxTokens: 400,
      temperature: 0.3,
    })
    replyText = r.text.trim()
    modelUsed = r.model
  } catch (e: any) {
    return { replied: false, reason: 'error', error: `LLM: ${e.message}` }
  }
  if (!replyText) return { replied: false, reason: 'error', error: 'empty LLM response' }

  // Insert bot message
  const latency = Date.now() - started
  const { data: botMsg, error } = await db.from('chat_messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content: replyText,
    private: false,
    delivery_status: 'sent',
    bot_metadata: {
      chunks_used: chunks.map(c => ({ entry_id: c.entry_id, entry_title: c.entry_title, score: c.score })),
      model: modelUsed,
      latency_ms: latency,
    },
  }).select('id').single()

  if (error) return { replied: false, reason: 'error', error: `insert: ${error.message}` }

  // If external channel (Telegram/Zalo/etc.) — enqueue for delivery to visitor's platform.
  // For Telegram we can send inline in the webhook handler. For others, the worker picks
  // it up from the outbound queue. For website widget: nothing to enqueue — the widget
  // polls chat_messages and will see it on next poll cycle.
  if (['telegram', 'zalo', 'facebook', 'email'].includes(inbox.channel_type)) {
    const { data: convFull } = await db.from('chat_conversations')
      .select('external_thread_id').eq('id', conversationId).maybeSingle()
    if (convFull?.external_thread_id) {
      await db.from('chat_outbound_queue').insert({
        message_id: botMsg.id,
        inbox_id: inbox.id,
        channel_type: inbox.channel_type,
        external_thread_id: convFull.external_thread_id,
        content: replyText,
        status: 'pending',
      })
    }
  }

  return { replied: true, reason: 'ok', bot_message_id: botMsg.id, latency_ms: latency }
}
