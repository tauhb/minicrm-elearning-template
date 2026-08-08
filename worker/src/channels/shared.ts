// Shared contact / conversation / message helpers used by all channel
// adapters — same policies as the Telegram webhook (leads-first, dedup,
// greeting-as-system).
import { db } from '../lib/supabase.js'

export interface ContactResolution {
  leadId: string | null
  customerId: string | null
}

export async function resolveContact(opts: {
  email: string
  phone?: string | null
  name: string
  source: string
}): Promise<ContactResolution> {
  const emailLower = opts.email.trim().toLowerCase()

  // 1) Existing customer with this email → link, don't create lead.
  const { data: cust } = await db().from('customers')
    .select('id').eq('email', emailLower).maybeSingle()
  if (cust) return { leadId: null, customerId: cust.id }

  // 2) Existing lead (email OR phone)
  const { data: leadByEmail } = await db().from('leads')
    .select('id').eq('email', emailLower).maybeSingle()
  if (leadByEmail) return { leadId: leadByEmail.id, customerId: null }
  if (opts.phone) {
    const { data: leadByPhone } = await db().from('leads')
      .select('id').eq('phone', opts.phone).maybeSingle()
    if (leadByPhone) return { leadId: leadByPhone.id, customerId: null }
  }

  // 3) Create new lead
  const { data: created } = await db().from('leads').insert({
    email: emailLower,
    name: opts.name,
    phone: opts.phone || null,
    source: opts.source,
  }).select('id').single()
  return { leadId: created?.id || null, customerId: null }
}

export async function upsertConversation(opts: {
  inboxId: string
  channelType: string
  externalThreadId: string
  leadId: string | null
  customerId: string | null
  additional?: Record<string, unknown>
  greetingMessage?: string | null
  assigneeId?: string | null
}): Promise<string> {
  const { data: existing } = await db().from('chat_conversations')
    .select('id')
    .eq('inbox_id', opts.inboxId)
    .eq('channel_type', opts.channelType)
    .eq('external_thread_id', opts.externalThreadId)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await db().from('chat_conversations').insert({
    inbox_id: opts.inboxId,
    channel_type: opts.channelType,
    external_thread_id: opts.externalThreadId,
    lead_id: opts.leadId,
    customer_id: opts.customerId,
    status: 'open',
    assignee_id: opts.assigneeId || null,
    additional_attributes: opts.additional || {},
  }).select('id').single()
  if (error || !created) throw new Error(`conversation insert failed: ${error?.message}`)

  if (opts.greetingMessage) {
    await db().from('chat_messages').insert({
      conversation_id: created.id,
      content: opts.greetingMessage,
      content_type: 'system',
      sender_type: 'system',
      delivery_status: 'sent',
    })
  }
  return created.id
}

export async function insertVisitorMessage(opts: {
  conversationId: string
  content: string
  senderId: string | null
  externalMessageId?: string
}): Promise<void> {
  if (opts.externalMessageId) {
    const { data: dup } = await db().from('chat_messages')
      .select('id').eq('external_message_id', opts.externalMessageId).maybeSingle()
    if (dup) return  // idempotent
  }
  await db().from('chat_messages').insert({
    conversation_id: opts.conversationId,
    content: opts.content,
    content_type: 'text',
    sender_type: 'contact',
    sender_id: opts.senderId,
    external_message_id: opts.externalMessageId,
    delivery_status: 'delivered',
  })
}
