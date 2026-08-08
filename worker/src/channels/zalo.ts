// worker/src/channels/zalo.ts — Zalo channel adapter (zca-js).
//
// Pattern mirrors apps/support-agent/src/channels/zalo/client.ts:
//   • Cookie + IMEI + userAgent restored from inbox.channel_config
//     (all three encrypted per 021 migration).
//   • listener.start({ retryOnClose: true }) survives transient drops.
//   • sendMessage rate-limited (8 msgs / 10s sliding window) to avoid bans.
//
// Difference vs support-agent:
//   • Inbound messages become chat_messages rows keyed by inbox_id +
//     external_thread_id (leads-first contact resolution).
//   • No RAG / LLM autoresponder — the agent replies in ChatView; we just
//     transport bytes both directions.
//
// Zca-js is an unofficial reverse-engineered client. It works in practice
// but Zalo can invalidate the session at any time; the admin must then
// re-scan a QR code (currently: paste a fresh cookie JSON in the UI —
// full QR flow is a TODO on the worker side).

import type { InboxRow, ChannelAdapter, OutboundSendResult } from './types.js'
import { db } from '../lib/supabase.js'
import { tryDecrypt } from '../lib/crypto.js'
import { createLogger } from '../lib/logger.js'
import { resolveContact, upsertConversation, insertVisitorMessage } from './shared.js'

const SEND_WINDOW_MS = 10_000
const SEND_WINDOW_MAX = 8

// Dynamic import so the worker can start even if zca-js has installation
// issues on the deploy platform (missing native deps, etc.) — Zalo adapter
// then throws and the other channels keep running.
async function loadZca() {
  try {
    // @ts-ignore — no types shipped for zca-js
    const mod = await import('zca-js')
    return mod
  } catch (e: any) {
    throw new Error(`zca-js not installed / failed to load: ${e.message}`)
  }
}

export async function startZaloAdapter(inbox: InboxRow): Promise<ChannelAdapter> {
  const log = createLogger(`zalo:${inbox.id.slice(0, 8)}`)
  const cfg = inbox.channel_config as any

  const cookie = tryDecrypt(cfg.cookie_encrypted)
  const imei = cfg.imei
  const userAgent = cfg.user_agent

  if (!cookie || !imei || !userAgent) {
    throw new Error(`inbox ${inbox.id} missing zalo credentials (cookie/imei/user_agent)`)
  }

  const { Zalo, ThreadType } = await loadZca()

  const zalo = new Zalo()
  const api = await zalo.login({
    cookie: JSON.parse(cookie),
    imei,
    userAgent,
  })

  const ownUid: string = api.getOwnId()
  log.info(`connected as ${ownUid}`)

  // Persist ownUid on the inbox for reference
  await db().from('chat_inboxes').update({
    external_id: ownUid,
  }).eq('id', inbox.id)

  const sendTimestamps: number[] = []
  const checkRate = () => {
    const now = Date.now()
    while (sendTimestamps.length && now - sendTimestamps[0] > SEND_WINDOW_MS) sendTimestamps.shift()
    if (sendTimestamps.length >= SEND_WINDOW_MAX) return false
    sendTimestamps.push(now)
    return true
  }

  const listener = api.listener
  listener.on('closed', (code: unknown, reason: unknown) => {
    log.warn('listener closed', { code: String(code), reason: String(reason) })
  })
  listener.on('error', (err: unknown) => {
    log.error('listener error', (err as Error)?.message || err)
  })
  listener.on('message', async (message: any) => {
    if (message.isSelf) return
    try {
      const threadId = String(message.threadId)
      const isGroup = message.type === ThreadType.Group
      const senderId: string = String(message.data?.uidFrom || message.data?.senderId || 'unknown')
      const displayName: string = message.data?.dName || message.data?.displayName || `Zalo ${senderId}`
      const text: string = message.data?.content ?? ''
      const extMsgId = `zalo:${threadId}:${message.data?.msgId || message.data?.cliMsgId || Date.now()}`

      // Contact resolution: leads-first by synthetic email zalo-{uid}@zalo.local
      const email = `zalo-${senderId}@zalo.local`
      const contact = await resolveContact({
        email,
        name: displayName,
        source: `zalo:${ownUid}`,
      })

      const convId = await upsertConversation({
        inboxId: inbox.id,
        channelType: 'zalo',
        externalThreadId: threadId,
        leadId: contact.leadId,
        customerId: contact.customerId,
        additional: {
          zalo: { thread_type: isGroup ? 'group' : 'user', own_uid: ownUid, sender_uid: senderId },
        },
        greetingMessage: inbox.greeting_enabled ? inbox.greeting_message : null,
        assigneeId: inbox.auto_assign_to,
      })

      await insertVisitorMessage({
        conversationId: convId,
        content: text || '(non-text message)',
        senderId: contact.leadId || contact.customerId,
        externalMessageId: extMsgId,
      })
    } catch (e: any) {
      log.error('inbound handler threw', e.message)
    }
  })
  listener.start({ retryOnClose: true })

  return {
    channel: 'zalo',
    inboxId: inbox.id,
    async send(threadId: string, content: string): Promise<OutboundSendResult> {
      if (!checkRate()) return { ok: false, error: 'rate_limited (8/10s cap)' }
      try {
        // We don't know if threadId is a User or a Group at delivery time —
        // Zalo differentiates. Best signal: numeric UIDs are users, hash-ish
        // are groups. For MVP we try User first; fall back to Group on error.
        try {
          await api.sendMessage({ msg: content }, threadId, ThreadType.User)
        } catch {
          await api.sendMessage({ msg: content }, threadId, ThreadType.Group)
        }
        return { ok: true, external_message_id: `zalo:${threadId}:out:${Date.now()}` }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    },
    async stop() {
      try { api.listener.stop() } catch { /* ignore */ }
    },
  }
}
