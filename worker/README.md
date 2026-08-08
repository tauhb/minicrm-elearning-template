# Channels Worker (optional)

Long-running Node process that owns channels the Vercel-hosted CRM cannot host itself:

| Channel  | Where it runs                                          | Reason                                           |
| -------- | ------------------------------------------------------ | ------------------------------------------------ |
| Website  | Portal API (Vercel)                                    | Static HTTP.                                     |
| Telegram | Portal API (Vercel) — webhook mode                     | Telegram delivers via HTTPS POST.                |
| Telegram | Worker — polling mode (fallback)                       | Set `mode: 'polling'` if no public HTTPS URL.    |
| Zalo     | **Worker only**                                        | `zca-js` needs a persistent socket.              |
| Facebook | Worker (stub) — can move to portal later               | Webhook, but code lives here for simplicity.     |
| Email    | **Worker only**                                        | IMAP idle / polling.                             |

If you only care about Website + Telegram, **skip this worker entirely** — the portal handles it all.

---

## Run locally

```bash
cd worker
cp .env.example .env       # fill VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROVIDER_ENCRYPTION_KEY
npm install
npm run dev
```

You should see:

```
[...] INFO worker: starting worker { channels: ["zalo","telegram","facebook","email"] }
[...] INFO worker: adapter started { inbox: "...", channel: "telegram", name: "..." }
[...] INFO worker: worker ready { adapters: 1, poll_ms: 3000 }
```

## Deploy — Docker

```bash
docker build -t crm-channels-worker .
docker run --env-file .env crm-channels-worker
```

## Deploy — Railway / Fly / Render

Any platform that runs a long-lived Node process. The worker is stateless
(all state lives in Supabase), so multiple replicas are fine as long as you
shard by `WORKER_CHANNELS` — e.g. one worker for Zalo, one for Email — to
avoid double-delivery on the same inbox.

- **Railway:** New Service → Deploy from GitHub → set root to `worker/`.
- **Fly.io:** `fly launch` from `worker/`; add env via `fly secrets set`.
- **Render:** New Background Worker → `Dockerfile` in `worker/`.

Health probe: query `SELECT last_beat_at FROM worker_heartbeats` — under
60 seconds old means the worker is alive.

## Configuration

- `WORKER_CHANNELS` (comma list) — which channel types this worker owns.
  Default: all four. Set to `zalo` on your persistent VPS and skip
  installing this worker on Vercel-only deployments.
- `PROVIDER_ENCRYPTION_KEY` — **must** match the portal's key. Bot tokens
  and Zalo cookies are AES-256-GCM encrypted with it.
- `OUTBOUND_POLL_INTERVAL_MS` (default 3000) — poll fallback when realtime
  drops.
- `HEARTBEAT_INTERVAL_MS` (default 15000) — how often the worker refreshes
  `worker_heartbeats.last_beat_at`.

## Adding channels via the CRM

Channels are configured in the CRM (**Chat → Manage Inboxes**), not via
worker env. The worker reads `chat_inboxes` rows every 60 seconds and
starts/stops adapters as inboxes are activated / deactivated / deleted.
