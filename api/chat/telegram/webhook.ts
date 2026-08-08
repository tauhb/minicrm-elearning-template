// api/chat/telegram/webhook.ts — Inbound Telegram updates (webhook mode)
//
// POST /api/chat/telegram/webhook?token={webhook_secret}
//
//   • Verifies token matches inbox.channel_config.webhook_secret.
//   • Optionally verifies X-Telegram-Bot-Api-Secret-Token header (if set on
//     setWebhook — Telegram forwards it back on every update).
//   • Parses the Update — we handle .message and .edited_message (text only
//     for MVP; media parked as attachments metadata).
//   • Finds or creates a chat_conversations row keyed on
//     (inbox_id, external_thread_id=chat.id).
//   • Resolves contact leads-first: match on phone if user shared contact,
//     else on username-derived synthetic email, else create anonymous lead.
//   • Inserts chat_messages(sender_type='visitor'... external_message_id).
//   • Always returns 200 to Telegram — never rely on webhook to reply
//     (agent replies async via ChatView).
//
// Notes:
//   • Anti-double-insert: external_message_id has a partial unique-ish index
//     (see 021 migration). We use upsert to be safe under Telegram retries.
//   • sender_type='contact' matches the existing chat_messages CHECK constraint
//     (013 migration allows 'contact' | 'agent' | 'system' | 'bot').

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Telegram Update — we only care about a small subset for MVP.
interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}
interface TgChat { id: number; type: string; title?: string; username?: string }
interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  date: number
  text?: string
  caption?: string
  photo?: any[]
  document?: any
  contact?: { phone_number: string; first_name?: string; last_name?: string; user_id?: number }
}
interface TgUpdate {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  channel_post?: TgMessage
}

function makeSyntheticEmail(user: TgUser | undefined, chatId: number): string {
  // Stable synthetic email so re-visits map to the same lead.
  const handle = user?.username || `tg${user?.id || chatId}`
  return `${handle}@telegram.local`.toLowerCase()
}

function displayName(user: TgUser | undefined, chat: TgChat): string {
  if (chat.type !== 'private' && chat.title) return chat.title
  const parts = [user?.first_name, user?.last_name].filter(Boolean)
  return parts.join(' ').trim() || user?.username || `Telegram ${chat.id}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })

  const url = new URL(req.url || '', 'http://localhost')
  const token = url.searchParams.get('token') || ''
  if (!token) return res.status(400).json({ ok: false, error: 'token required' })

  const admin = adminDb()

  // Find inbox by webhook_secret in channel_config
  const { data: inboxes, error: inboxErr } = await admin
    .from('chat_inboxes')
    .select('id, channel_config, is_active, auto_assign_to, greeting_enabled, greeting_message, external_id')
    .eq('channel_type', 'telegram')
  if (inboxErr) return res.status(500).json({ ok: false, error: inboxErr.message })
  const inbox = (inboxes || []).find((i: any) =>
    (i.channel_config?.webhook_secret || '') === token
  )
  if (!inbox) return res.status(403).json({ ok: false, error: 'unknown token' })
  if (!inbox.is_active) return res.status(200).json({ ok: true, ignored: 'inbox inactive' })

  // Optional: Telegram forwards X-Telegram-Bot-Api-Secret-Token when set on setWebhook.
  const headerSecret = (req.headers['x-telegram-bot-api-secret-token'] as string) || ''
  const expectedHeaderSecret = (inbox.channel_config as any)?.webhook_header_secret || ''
  if (expectedHeaderSecret && headerSecret !== expectedHeaderSecret) {
    return res.status(403).json({ ok: false, error: 'header secret mismatch' })
  }

  const update = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as TgUpdate
  const msg = update.message || update.edited_message || update.channel_post
  if (!msg) return res.status(200).json({ ok: true, ignored: 'no message' })

  const chatId = String(msg.chat.id)
  const text = (msg.text || msg.caption || '').trim()
  const contentType: 'text' | 'image' | 'file' =
    msg.photo ? 'image' : msg.document ? 'file' : 'text'

  try {
    // ── Dedup on retry: check existing external_message_id ────────────────
    if (msg.message_id) {
      const { data: existing } = await admin
        .from('chat_messages')
        .select('id')
        .eq('external_message_id', `tg:${chatId}:${msg.message_id}`)
        .maybeSingle()
      if (existing) return res.status(200).json({ ok: true, deduped: true })
    }

    // ── Find or create conversation ───────────────────────────────────────
    let { data: conv } = await admin
      .from('chat_conversations')
      .select('id, lead_id, customer_id')
      .eq('inbox_id', inbox.id)
      .eq('channel_type', 'telegram')
      .eq('external_thread_id', chatId)
      .maybeSingle()

    let leadId: string | null = conv?.lead_id ?? null
    let customerId: string | null = conv?.customer_id ?? null

    if (!conv) {
      // ── Resolve contact (leads-first) ───────────────────────────────────
      const phone = msg.contact?.phone_number || null
      let existingLead: any = null

      if (phone) {
        const { data } = await admin
          .from('leads').select('id').eq('phone', phone).maybeSingle()
        existingLead = data
      }
      if (!existingLead) {
        const email = makeSyntheticEmail(msg.from, msg.chat.id)
        const { data } = await admin
          .from('leads').select('id').eq('email', email).maybeSingle()
        existingLead = data
      }

      if (existingLead) {
        leadId = existingLead.id
      } else {
        const email = makeSyntheticEmail(msg.from, msg.chat.id)
        const { data: created } = await admin.from('leads').insert({
          email,
          name: displayName(msg.from, msg.chat),
          phone,
          source: `telegram:${inbox.external_id || 'bot'}`,
        }).select('id').single()
        leadId = created?.id || null
      }

      // Create conversation
      const { data: newConv, error: convErr } = await admin.from('chat_conversations').insert({
        inbox_id: inbox.id,
        channel_type: 'telegram',
        external_thread_id: chatId,
        lead_id: leadId,
        customer_id: customerId,
        status: 'open',
        source_url: null,
        additional_attributes: {
          telegram: {
            chat_type: msg.chat.type,
            chat_username: msg.chat.username,
            from_username: msg.from?.username,
            from_id: msg.from?.id,
          },
        },
        assignee_id: inbox.auto_assign_to || null,
      }).select('id').single()
      if (convErr || !newConv) throw new Error(convErr?.message || 'conv create failed')
      conv = { id: newConv.id, lead_id: leadId, customer_id: customerId }

      // Send greeting (as system message so agent sees; NOT sent back to Telegram
      // — visitor would just see silence). If admin wants a welcome DM, they can
      // send it via ChatView after their first agent reply is scheduled.
      if (inbox.greeting_enabled && inbox.greeting_message) {
        await admin.from('chat_messages').insert({
          conversation_id: newConv.id,
          content: inbox.greeting_message,
          content_type: 'system',
          sender_type: 'system',
          delivery_status: 'sent',
        })
      }
    }

    // ── Insert the visitor message ────────────────────────────────────────
    await admin.from('chat_messages').insert({
      conversation_id: conv.id,
      content: text || '(non-text message)',
      content_type: contentType === 'text' ? 'text' : contentType,
      sender_type: 'contact',
      sender_id: leadId || customerId,
      external_message_id: `tg:${chatId}:${msg.message_id}`,
      delivery_status: 'delivered',
      attachments: msg.photo || msg.document ? [{ raw: msg.photo || msg.document }] : [],
    })

    return res.status(200).json({ ok: true })
  } catch (e: any) {
    console.error('[telegram/webhook]', e)
    // Telegram retries on non-2xx — return 200 to prevent spam, and log.
    return res.status(200).json({ ok: false, error: e.message })
  }
}
