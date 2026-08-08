// worker/src/channels/email.ts — STUB.
//
// Email-as-channel bridges IMAP inbox → chat_conversations, and SMTP → outbound.
//
// TODO (post-MVP):
//   • IMAP IDLE (or 60s poll) to fetch new messages.
//   • Thread key: normalize Subject (strip Re:/Fwd:) + From address, or use
//     Message-ID / References headers when present.
//   • Attachments → Supabase Storage bucket, link in chat_messages.attachments.
//   • SMTP send with In-Reply-To for proper threading.
//   • Autoresponder detection so we don't loop with Gmail vacation replies.
//
// This stub throws on start so setup UI shows a clear "coming soon" message.

import type { InboxRow, ChannelAdapter } from './types.js'

export async function startEmailAdapter(_inbox: InboxRow): Promise<ChannelAdapter> {
  throw new Error(
    'email adapter is not implemented yet. See worker/src/channels/email.ts TODOs. ' +
    'Reference: apps/support-agent/src/channels/email/send.ts for the SMTP half.'
  )
}
