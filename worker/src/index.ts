// worker/src/index.ts — Channels worker.
//
// Responsibilities:
//   1. On boot: load every active chat_inboxes row with a channel_type this
//      worker owns, and start an adapter for each.
//   2. Realtime subscribe to chat_outbound_queue INSERT so replies deliver
//      near-instantly.
//   3. Poll pending outbound rows every OUTBOUND_POLL_INTERVAL_MS as a
//      safety net (realtime drops happen).
//   4. Heartbeat every HEARTBEAT_INTERVAL_MS so the admin UI can show
//      worker health.
//
// This worker is OPTIONAL. Users who only want Telegram + Website chat can
// deploy the CRM alone on Vercel and never touch this directory.

import 'dotenv/config'
import { db } from './lib/supabase.js'
import { createLogger } from './lib/logger.js'
import { startHeartbeat } from './lib/heartbeat.js'
import type { ChannelAdapter, ChannelType, InboxRow } from './channels/types.js'
import { startZaloAdapter } from './channels/zalo.js'
import { startTelegramAdapter } from './channels/telegram.js'
import { startFacebookAdapter } from './channels/facebook.js'
import { startEmailAdapter } from './channels/email.js'

const log = createLogger('worker')

const DEFAULT_CHANNELS: ChannelType[] = ['zalo', 'telegram', 'facebook', 'email']

function ownedChannels(): ChannelType[] {
  const env = (process.env.WORKER_CHANNELS || '').trim()
  if (!env) return DEFAULT_CHANNELS
  return env.split(',').map(s => s.trim()).filter(Boolean) as ChannelType[]
}

const adapters = new Map<string, ChannelAdapter>()  // inbox_id → adapter

async function bootAdapter(inbox: InboxRow) {
  try {
    let adapter: ChannelAdapter
    switch (inbox.channel_type) {
      case 'zalo':     adapter = await startZaloAdapter(inbox); break
      case 'telegram': adapter = await startTelegramAdapter(inbox); break
      case 'facebook': adapter = await startFacebookAdapter(inbox); break
      case 'email':    adapter = await startEmailAdapter(inbox); break
      default:
        log.warn(`unknown channel_type=${inbox.channel_type} for inbox ${inbox.id} — skipping`)
        return
    }
    adapters.set(inbox.id, adapter)
    log.info(`adapter started`, { inbox: inbox.id, channel: inbox.channel_type, name: inbox.name })
  } catch (e: any) {
    log.error(`failed to start adapter for inbox ${inbox.id} (${inbox.channel_type})`, e.message)
  }
}

async function loadInboxes(): Promise<InboxRow[]> {
  const channels = ownedChannels()
  const { data, error } = await db().from('chat_inboxes')
    .select('id, name, channel_type, channel_config, external_id, is_active, auto_assign_to, greeting_enabled, greeting_message')
    .in('channel_type', channels)
    .eq('is_active', true)
  if (error) throw error
  return (data || []) as InboxRow[]
}

async function processQueueRow(row: any) {
  const adapter = adapters.get(row.inbox_id)
  if (!adapter) {
    log.warn(`no adapter for inbox ${row.inbox_id} — leaving queue row pending`)
    return
  }
  const attempts = (row.attempts || 0) + 1
  try {
    const result = await adapter.send(row.external_thread_id, row.content)
    if (result.ok) {
      await db().from('chat_outbound_queue').update({
        status: 'sent',
        attempts,
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', row.id)
      await db().from('chat_messages').update({
        delivery_status: 'sent',
        external_message_id: result.external_message_id,
      }).eq('id', row.message_id)
      log.info(`delivered`, { queue: row.id, channel: row.channel_type })
    } else {
      const failNow = attempts >= 5
      await db().from('chat_outbound_queue').update({
        status: failNow ? 'failed' : 'pending',
        attempts,
        last_error: result.error,
      }).eq('id', row.id)
      if (failNow) {
        await db().from('chat_messages').update({ delivery_status: 'failed' }).eq('id', row.message_id)
      }
      log.warn(`delivery failed (attempt ${attempts})`, { queue: row.id, err: result.error })
    }
  } catch (e: any) {
    await db().from('chat_outbound_queue').update({
      status: attempts >= 5 ? 'failed' : 'pending',
      attempts,
      last_error: e.message,
    }).eq('id', row.id)
    log.error(`delivery threw`, { queue: row.id, err: e.message })
  }
}

async function drainQueue(limit = 10) {
  const ownedInboxIds = Array.from(adapters.keys())
  if (!ownedInboxIds.length) return
  const { data, error } = await db().from('chat_outbound_queue')
    .select('id, message_id, inbox_id, conversation_id, channel_type, external_thread_id, content, attempts')
    .in('inbox_id', ownedInboxIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) { log.warn('drainQueue error', error.message); return }
  for (const row of data || []) {
    await processQueueRow(row)
  }
}

function subscribeQueue() {
  return db()
    .channel('outbound-queue')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_outbound_queue',
    }, (payload) => {
      const row = payload.new as any
      if (!adapters.has(row.inbox_id)) return
      void processQueueRow(row)
    })
    .subscribe(status => log.info(`realtime status: ${status}`))
}

async function main() {
  log.info('starting worker', { channels: ownedChannels() })

  const inboxes = await loadInboxes()
  if (!inboxes.length) {
    log.warn('no active inboxes found for owned channels. Sleeping — poll cycle will re-check.')
  }

  for (const inbox of inboxes) await bootAdapter(inbox)

  const stopHeartbeat = startHeartbeat(ownedChannels())
  const realtimeChannel = subscribeQueue()

  const pollMs = Number(process.env.OUTBOUND_POLL_INTERVAL_MS || 3000)
  const pollHandle = setInterval(() => { void drainQueue().catch(e => log.error('drain', e.message)) }, pollMs)

  // Re-scan inboxes every 60s so a freshly-configured inbox auto-attaches
  // without a worker restart.
  const rescanHandle = setInterval(async () => {
    try {
      const latest = await loadInboxes()
      for (const inbox of latest) {
        if (!adapters.has(inbox.id)) await bootAdapter(inbox)
      }
      // Stop adapters whose inbox was deleted / deactivated.
      const liveIds = new Set(latest.map(i => i.id))
      for (const [id, adapter] of Array.from(adapters.entries())) {
        if (!liveIds.has(id)) {
          log.info(`inbox ${id} no longer active — stopping adapter`)
          await adapter.stop()
          adapters.delete(id)
        }
      }
    } catch (e: any) {
      log.warn('rescan error', e.message)
    }
  }, 60_000)

  const shutdown = async (sig: string) => {
    log.info(`received ${sig}, shutting down`)
    clearInterval(pollHandle)
    clearInterval(rescanHandle)
    stopHeartbeat()
    try { await db().removeChannel(realtimeChannel) } catch { /* ignore */ }
    for (const adapter of adapters.values()) {
      try { await adapter.stop() } catch { /* ignore */ }
    }
    process.exit(0)
  }
  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  log.info('worker ready', {
    adapters: adapters.size,
    poll_ms: pollMs,
  })
}

main().catch(e => {
  console.error('worker fatal:', e)
  process.exit(1)
})
