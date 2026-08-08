# Chat Channels — End-to-End Setup

> The CRM's Chat inbox now speaks Website, Telegram, Zalo, Facebook, and Email — one unified conversation view, one contact resolution policy (leads-first), one reply UI.

## Architecture at a glance

```
                  ┌─────────────────────────────────────────┐
                  │             Supabase (Postgres)         │
                  │  chat_inboxes / chat_conversations /    │
                  │  chat_messages / chat_outbound_queue    │
                  │  worker_heartbeats                      │
                  └───────────────┬─────────────────────────┘
                                  │
     ┌────────────────────────────┼─────────────────────────────┐
     │                            │                             │
┌────▼─────────────────┐   ┌──────▼──────────┐    ┌─────────────▼──────────┐
│  Portal (Vercel)     │   │  Admin UI       │    │  worker/ (optional)    │
│  api/chat/telegram/  │   │  ChatView.tsx   │    │  Docker / Railway /    │
│  api/chat/widget/    │   │  realtime feeds │    │  Fly / VPS             │
│  Website widget      │   │                 │    │  zca-js, IMAP, FB      │
└──────┬───────────────┘   └─────────────────┘    └────┬───────────────────┘
       │                                               │
   Telegram webhook              persistent connections│
       │                            (Zalo, Email)      │
       ▼                                               ▼
  Telegram bot                                     Zalo / IMAP
```

Two runtime tiers:

- **Portal (Vercel)** — always on. Hosts Website widget + Telegram webhook (both are stateless HTTP). Reply handler for Telegram is inline (no queue hop).
- **Worker (optional)** — long-lived Node process. Required only for channels that need a persistent socket: Zalo (unofficial `zca-js`), Email (IMAP), and Facebook (kept here for code locality, could move).

Reply flow for all external channels is symmetric: agent types in ChatView → POST `/api/chat/conversations?action=reply` → `chat_messages` row → **Telegram delivered inline**, **Zalo/FB/Email queued** on `chat_outbound_queue` → worker picks up (realtime + 3s poll) and delivers → flips `delivery_status`.

---

## 1. Website widget (existing, unchanged)

Nothing new. Create inbox with channel `Website widget`, copy the embed snippet, paste on your site. See `api/chat/widget/embed.ts`.

## 2. Telegram — 3 minutes, no worker

1. **Create a bot**: DM [@BotFather](https://t.me/BotFather), `/newbot`, copy the token.
2. In CRM **Chat → Settings → + New**:
   - Name: e.g. `Telegram — Sales`
   - Channel: `Telegram bot`
   - **Save the inbox first** (must exist before we can wire the webhook).
3. Reopen the inbox → paste bot token → click **Cấu hình webhook tự động**.
   - The portal calls `getMe` to fetch the bot username, encrypts the token, generates a webhook secret + a Telegram `secret_token`, and calls `setWebhook` on your behalf.
   - Success message shows the webhook URL like `https://<portal>/api/chat/telegram/webhook?token=<secret>`.
4. Message your bot from Telegram → conversation appears in ChatView. Reply from ChatView → user receives the message immediately.

### Requirements

- `CUSTOMER_PORTAL_URL` env var set (production URL). In dev the endpoint derives from the request host, but Telegram refuses non-HTTPS webhooks — use `ngrok` or a preview deploy while testing.
- `PROVIDER_ENCRYPTION_KEY` set on the portal (64 hex chars; the same key already used for OAuth tokens).

### Rotating the token

Paste a new token in the same inbox → **Cấu hình webhook tự động** again. Telegram accepts overwriting the existing webhook; the old bot instantly stops working.

## 3. Zalo — needs the worker

Zalo has no public messaging API for personal accounts. We use the community-maintained `zca-js` reverse-engineered client. It requires a live cookie session (obtained via QR scan), and a persistent connection — which Vercel cannot host.

**Deploy the worker first** (see `worker/README.md`), then:

1. Log in to Zalo Web in your browser, export the cookie JSON (dev tools → Application → Cookies for `.zalo.me` — export as JSON array of `{key, value, domain, ...}`).
2. In CRM **Chat → Settings → + New**:
   - Channel: `Zalo`
   - Paste cookie JSON, IMEI (from `chat.zalo.me` local storage — key `imei`), and User-Agent (your browser's UA string).
3. Save. The worker's 60-second rescan will notice the new active inbox and start the Zalo adapter. Watch the worker logs for `connected as <uid>`.

> **Caveat**: Zalo can invalidate sessions at any time. When that happens, the adapter goes into `disconnected` — re-paste a fresh cookie. Full QR flow inside the worker is on the roadmap.

**Rate limiting**: the worker caps at 8 messages / 10s per inbox (Zalo bans accounts that look like bots).

## 4. Facebook — stub

The stub lives at `worker/src/channels/facebook.ts`. It throws on start so the admin UI clearly says "not implemented." Wiring notes:

- Uses Meta's Send API. A public HTTPS webhook is enough (can move to Vercel later, no persistent connection required).
- Store `page_access_token` encrypted the same way as Telegram.
- Reference: `apps/support-agent/src/channels/facebook/send.ts`.

The UI panel already collects Page ID + token so the config is not lost when the feature ships.

## 5. Email — stub

Stub at `worker/src/channels/email.ts`. To ship:

- IMAP IDLE (or 60s poll) → new messages become `chat_messages`.
- Thread key: normalize Subject (strip `Re:`, `Fwd:`) + From, or use `Message-ID` / `References` headers.
- SMTP send with `In-Reply-To` for proper threading.
- Attachments → Supabase Storage bucket.
- Reference: `apps/support-agent/src/channels/email/send.ts`.

## 6. Worker health indicator

The Chat top bar shows a **Worker online / stale / offline** pill whenever at least one active inbox needs a worker (zalo, facebook, email). It reads `worker_heartbeats` (updated every 15s by default) — under 60s = green.

## Data model additions (migration 021)

| Column                                | Purpose                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `chat_inboxes.channel_type`           | Widened CHECK to include `telegram`. `web_widget` migrated to `website`. |
| `chat_inboxes.external_id`            | Bot username / Zalo own UID / FB page ID.                              |
| `chat_inboxes.channel_config` (JSONB) | Per-channel secrets (encrypted) and options. Shape documented in the migration file. |
| `chat_inboxes.worker_last_heartbeat_at` | Reserved for future per-inbox health. Currently workers write to `worker_heartbeats`. |
| `chat_conversations.external_thread_id` | Telegram `chat.id`, Zalo `threadId`, etc. Keyed with `channel_type`.  |
| `chat_conversations.channel_type`       | Denormalized from inbox so inbound webhook can find the conversation in one query. |
| `chat_messages.external_message_id`   | For inbound dedup on webhook retries, and for outbound receipt storage. |
| `chat_messages.delivery_status`       | `pending / sent / delivered / failed` — the UI can show a send indicator. |
| `chat_outbound_queue`                 | Agent reply → external channel handoff. Worker consumes.               |
| `worker_heartbeats`                   | One row per worker instance, refreshed each cycle.                     |

## Contact resolution (unchanged policy)

Leads-first — same as the website widget: match on phone → email → synthetic email (`<handle>@telegram.local`, `zalo-<uid>@zalo.local`). Create a lead if nothing matches. Never create a customer from chat.

## Common issues

- **Telegram webhook 403 "unknown token"**: the URL secret in the query string doesn't match any inbox's `webhook_secret`. Reconfigure the webhook (which regenerates the secret).
- **Telegram webhook succeeds but no conversation appears**: inbox is inactive. Toggle Active in the modal.
- **Worker starts but Zalo adapter fails with "session invalid"**: cookie expired. Re-paste and save the inbox.
- **Reply says "delivered" but user got nothing on Zalo**: check worker logs — the adapter tries `ThreadType.User` first, then `ThreadType.Group`. If both fail the queue row moves to `failed` after 5 attempts.
- **Reply on Vercel says "failed"**: `PROVIDER_ENCRYPTION_KEY` on the portal doesn't match the one used when the token was encrypted. Re-run "Cấu hình webhook tự động" with the same bot token to re-encrypt.
