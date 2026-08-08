// worker/src/channels/facebook.ts — STUB.
//
// Facebook Messenger integration requires:
//   • A Facebook App with pages_messaging + pages_manage_metadata permissions.
//   • A Page Access Token (long-lived) per connected page.
//   • A public HTTPS webhook to receive `messages` and `messaging_postbacks`
//     — this could actually live on Vercel like Telegram (no persistent
//     connection needed). Kept in the worker for now to keep the FB code
//     together with Zalo.
//
// TODO (post-MVP):
//   • Verify webhook (X-Hub-Signature-256 with app_secret).
//   • Parse Messenger Send API responses.
//   • Delivery + read receipts → chat_messages.delivery_status='delivered'/'read'.
//   • Attachment handling (image / video / template).
//
// This stub throws on start so setup UI shows a clear "coming soon" message.

import type { InboxRow, ChannelAdapter } from './types.js'

export async function startFacebookAdapter(_inbox: InboxRow): Promise<ChannelAdapter> {
  throw new Error(
    'facebook adapter is not implemented yet. See worker/src/channels/facebook.ts TODOs. ' +
    'Track: use apps/support-agent/src/channels/facebook/send.ts as reference.'
  )
}
