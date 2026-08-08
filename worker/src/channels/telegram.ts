// worker/src/channels/telegram.ts — Telegram POLLING adapter.
//
// The Vercel-hosted CRM handles Telegram via webhook by default (see
// api/chat/telegram/webhook.ts). This polling adapter is a fallback for
// self-hosted deployments where the CRM has no public HTTPS URL.
//
// The adapter is only started when inbox.channel_config.mode === 'polling'.
// The reply path (chat_outbound_queue → send) always works regardless of
// mode; when webhook is used the worker's role reduces to outbound-only.

import { Bot } from 'grammy'
import type { InboxRow, ChannelAdapter, OutboundSendResult } from './types.js'
import { db } from '../lib/supabase.js'
import { tryDecrypt } from '../lib/crypto.js'
import { createLogger } from '../lib/logger.js'
import { resolveContact, upsertConversation, insertVisitorMessage } from './shared.js'

export async function startTelegramAdapter(inbox: InboxRow): Promise<ChannelAdapter> {
  const log = createLogger(`tg:${inbox.id.slice(0, 8)}`)
  const cfg = inbox.channel_config as any
  const token = tryDecrypt(cfg.bot_token_encrypted)
  if (!token) throw new Error(`inbox ${inbox.id} missing decryptable bot_token_encrypted`)

  const bot = new Bot(token)
  const mode = cfg.mode || 'webhook'

  if (mode === 'polling') {
    // Delete any existing webhook first, else long-polling refuses to start.
    try { await bot.api.deleteWebhook({ drop_pending_updates: false }) } catch { /* ignore */ }

    bot.on('message', async (ctx) => {
      try {
        const chat = ctx.chat
        const msg = ctx.message
        if (!msg) return
        const chatId = String(chat.id)
        const from = msg.from
        const text = msg.text || msg.caption || ''
        const email = `${from?.username || `tg${from?.id}`}@telegram.local`.toLowerCase()
        const contact = await resolveContact({
          email,
          name: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || `Telegram ${chatId}`,
          source: `telegram:${cfg.bot_username || 'bot'}`,
        })
        const convId = await upsertConversation({
          inboxId: inbox.id,
          channelType: 'telegram',
          externalThreadId: chatId,
          leadId: contact.leadId,
          customerId: contact.customerId,
          additional: { telegram: { chat_type: chat.type, from_id: from?.id } },
          greetingMessage: inbox.greeting_enabled ? inbox.greeting_message : null,
          assigneeId: inbox.auto_assign_to,
        })
        await insertVisitorMessage({
          conversationId: convId,
          content: text || '(non-text message)',
          senderId: contact.leadId || contact.customerId,
          externalMessageId: `tg:${chatId}:${msg.message_id}`,
        })
      } catch (e: any) {
        log.error('inbound handler threw', e.message)
      }
    })
    void bot.start()
    log.info('polling started')
  } else {
    log.info('outbound-only (webhook mode) — inbound handled by portal API')
  }

  // Sync bot username to inbox.external_id if not set
  try {
    const me = await bot.api.getMe()
    if (!inbox.external_id) {
      await db().from('chat_inboxes').update({ external_id: me.username }).eq('id', inbox.id)
    }
  } catch { /* ignore */ }

  return {
    channel: 'telegram',
    inboxId: inbox.id,
    async send(threadId: string, content: string): Promise<OutboundSendResult> {
      try {
        const r = await bot.api.sendMessage(threadId, content, { link_preview_options: { is_disabled: true } })
        return { ok: true, external_message_id: `tg:${threadId}:${r.message_id}` }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    },
    async stop() {
      try { await bot.stop() } catch { /* ignore */ }
    },
  }
}
