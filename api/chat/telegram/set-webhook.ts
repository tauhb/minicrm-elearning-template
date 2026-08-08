// api/chat/telegram/set-webhook.ts — Admin-only. Register the CRM as the
//   webhook target for a Telegram bot, storing the encrypted token + secret
//   in the inbox's channel_config.
//
// POST /api/chat/telegram/set-webhook
//   body: { inbox_id: UUID, bot_token: string }
//   → 200 { webhook_url, bot_username }
//
// Also accepts action=info to just fetch the bot username without changing
// the webhook (useful when the admin only wants to sanity-check the token).
//
// Requires PROVIDER_ENCRYPTION_KEY and CUSTOMER_PORTAL_URL (or the current
// request host is derived if the env is missing — dev convenience).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { encrypt } from '../../../services/crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function getPortalUrl(req: VercelRequest): string {
  const env = process.env.CUSTOMER_PORTAL_URL
  if (env) return env.replace(/\/$/, '')
  // Fallback: derive from request (dev)
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host
  return `${proto}://${host}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!['admin', 'sales', 'owner'].includes(caller?.role as string)) return res.status(403).json({ error: 'Admin only' })

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}
  const inboxId = String(body.inbox_id || '').trim()
  const botToken = String(body.bot_token || '').trim()
  const action = String(body.action || 'set').trim()

  if (!inboxId) return res.status(400).json({ error: 'inbox_id required' })
  if (!botToken) return res.status(400).json({ error: 'bot_token required' })
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    return res.status(400).json({ error: 'bot_token looks malformed (expected "123456789:ABC...")' })
  }

  const admin = adminDb()

  // 1. getMe → verify token + fetch username
  const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
  const me = await meRes.json() as any
  if (!me.ok) return res.status(400).json({ error: `Telegram getMe failed: ${me.description}` })
  const botUsername = me.result.username as string
  const botId = String(me.result.id)

  if (action === 'info') {
    return res.json({ bot_username: botUsername, bot_id: botId })
  }

  // 2. Load inbox
  const { data: inbox } = await admin.from('chat_inboxes')
    .select('id, channel_type, channel_config').eq('id', inboxId).maybeSingle()
  if (!inbox) return res.status(404).json({ error: 'inbox not found' })
  if (inbox.channel_type !== 'telegram') {
    return res.status(400).json({ error: `inbox is ${inbox.channel_type}, not telegram` })
  }

  // 3. Generate secrets (path token + Telegram header secret)
  const webhookSecret = crypto.randomBytes(24).toString('hex')
  const headerSecret = crypto.randomBytes(24).toString('hex')  // must be [A-Za-z0-9_-] len 1..256
  const portal = getPortalUrl(req)
  const webhookUrl = `${portal}/api/chat/telegram/webhook?token=${webhookSecret}`

  // 4. Encrypt bot_token + persist
  let encryptedToken: string
  try {
    encryptedToken = encrypt(botToken)
  } catch (e: any) {
    return res.status(500).json({ error: `Encryption failed: ${e.message}. Set PROVIDER_ENCRYPTION_KEY.` })
  }

  const updatedConfig = {
    ...(inbox.channel_config as any || {}),
    bot_token_encrypted: encryptedToken,
    bot_username: botUsername,
    bot_id: botId,
    webhook_secret: webhookSecret,
    webhook_header_secret: headerSecret,
    webhook_url: webhookUrl,
    mode: 'webhook',
    updated_at: new Date().toISOString(),
  }

  const { error: updErr } = await admin.from('chat_inboxes').update({
    channel_config: updatedConfig,
    external_id: botUsername,
    updated_at: new Date().toISOString(),
  }).eq('id', inboxId)
  if (updErr) return res.status(500).json({ error: `Save failed: ${updErr.message}` })

  // 5. Call setWebhook
  const setRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: headerSecret,
      allowed_updates: ['message', 'edited_message', 'channel_post'],
      drop_pending_updates: false,
    }),
  })
  const setJson = await setRes.json() as any
  if (!setJson.ok) {
    return res.status(500).json({
      error: `setWebhook failed: ${setJson.description}`,
      hint: 'Telegram requires HTTPS. If running locally, use ngrok or deploy first.',
    })
  }

  return res.json({
    ok: true,
    bot_username: botUsername,
    bot_id: botId,
    webhook_url: webhookUrl,
    telegram_response: setJson.result,
  })
}
