// Shared shapes across channel adapters. Each adapter registers a handler
// that (a) receives inbound messages and inserts them as chat_messages, and
// (b) exposes send(threadId, content) for outbound queue delivery.

export type ChannelType = 'telegram' | 'zalo' | 'facebook' | 'email'

export interface InboxRow {
  id: string
  name: string
  channel_type: ChannelType
  channel_config: Record<string, unknown>
  external_id: string | null
  is_active: boolean
  auto_assign_to: string | null
  greeting_enabled: boolean | null
  greeting_message: string | null
}

export interface OutboundSendResult {
  ok: boolean
  error?: string
  external_message_id?: string
}

export interface ChannelAdapter {
  channel: ChannelType
  inboxId: string
  /** Deliver a queued reply. Return ok + optional external_message_id for
   *  chat_messages update. */
  send(threadId: string, content: string): Promise<OutboundSendResult>
  /** Cleanly stop the connection so the worker can exit / restart. */
  stop(): Promise<void>
}
