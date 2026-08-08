// api/chat/conversations/index.ts — Admin conversation ops
//   GET    /api/chat/conversations                            → list (with filters)
//   GET    /api/chat/conversations?id=xxx                     → detail + messages
//   POST   /api/chat/conversations?action=reply&id=xxx        → agent send message
//   POST   /api/chat/conversations?action=note&id=xxx         → internal note
//   POST   /api/chat/conversations?action=assign&id=xxx       → set assignee
//   POST   /api/chat/conversations?action=status&id=xxx       → change status
//   POST   /api/chat/conversations?action=mark-read&id=xxx    → mark agent read

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { tryDecrypt } from '../../../services/crypto'

// Send a Telegram message inline (no worker needed). We fetch the bot token
// from inbox.channel_config every reply — 1 extra select per reply, but that
// keeps everyone else's happy-path unchanged and avoids caching decrypted
// secrets in this hot API process.
async function deliverTelegram(
  admin: any,
  inboxId: string,
  chatId: string,
  content: string,
): Promise<{ ok: boolean; error?: string; message_id?: number }> {
  try {
    const { data: inbox } = await admin
      .from('chat_inboxes').select('channel_config').eq('id', inboxId).maybeSingle()
    const cfg = (inbox && (inbox as any).channel_config) || {}
    const enc = cfg.bot_token_encrypted
    if (!enc) return { ok: false, error: 'inbox missing bot_token_encrypted — reconfigure webhook' }
    const botToken = tryDecrypt(enc)
    if (!botToken) return { ok: false, error: 'decrypt failed — check PROVIDER_ENCRYPTION_KEY' }
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: content, disable_web_page_preview: true }),
    })
    const j = await r.json() as any
    if (!j.ok) return { ok: false, error: `Telegram: ${j.description}` }
    return { ok: true, message_id: j.result?.message_id }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!['admin', 'sales'].includes(caller?.role as string)) return res.status(403).json({ error: 'Admin/sales only' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id')
  const action = url.searchParams.get('action')

  try {
    // ── GET list or detail ────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (id) {
        const { data: conv, error } = await admin.from('chat_conversations').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        const { data: messages } = await admin.from('chat_messages')
          .select('*').eq('conversation_id', id).order('created_at')
        // Resolve contact info
        let contact: any = null
        if (conv.customer_id) {
          const { data: c } = await admin.from('customers').select('id, email, display_name, phone').eq('id', conv.customer_id).maybeSingle()
          contact = c ? { type: 'customer', ...c } : null
        } else if (conv.lead_id) {
          const { data: l } = await admin.from('leads').select('id, email, name, phone, source, tags').eq('id', conv.lead_id).maybeSingle()
          contact = l ? { type: 'lead', ...l } : null
        }
        // Resolve inbox name
        const { data: inbox } = await admin.from('chat_inboxes').select('id, name, channel_type').eq('id', conv.inbox_id).maybeSingle()
        return res.json({ conversation: conv, messages: messages || [], contact, inbox })
      }
      // List
      const status = url.searchParams.get('status')
      const assignee = url.searchParams.get('assignee')
      const inboxId = url.searchParams.get('inbox_id')
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)

      let q = admin.from('chat_conversations').select(`
        id, display_id, inbox_id, lead_id, customer_id, assignee_id,
        status, priority, labels, last_activity_at, contact_last_seen_at, agent_last_seen_at,
        source_url, source_funnel_id, created_at
      `).order('last_activity_at', { ascending: false }).limit(limit)

      if (status) q = q.eq('status', status)
      if (assignee === 'me') q = q.eq('assignee_id', user.id)
      else if (assignee === 'unassigned') q = q.is('assignee_id', null)
      else if (assignee) q = q.eq('assignee_id', assignee)
      if (inboxId) q = q.eq('inbox_id', inboxId)

      const { data } = await q

      // Attach last message + contact preview for each conv (batch)
      const convIds = (data || []).map(c => c.id)
      const leadIds = (data || []).map(c => c.lead_id).filter(Boolean)
      const custIds = (data || []).map(c => c.customer_id).filter(Boolean)

      const [lastMsgsRes, leadsRes, custsRes] = await Promise.all([
        convIds.length ? admin.from('chat_messages')
          .select('conversation_id, content, sender_type, created_at')
          .in('conversation_id', convIds).order('created_at', { ascending: false }).limit(convIds.length * 3)
          : Promise.resolve({ data: [] }),
        leadIds.length ? admin.from('leads').select('id, email, name').in('id', leadIds as string[])
          : Promise.resolve({ data: [] }),
        custIds.length ? admin.from('customers').select('id, email, display_name').in('id', custIds as string[])
          : Promise.resolve({ data: [] }),
      ])
      const lastMsgByConv = new Map<string, any>()
      ;((lastMsgsRes.data || []) as any[]).forEach((m: any) => {
        if (!lastMsgByConv.has(m.conversation_id)) lastMsgByConv.set(m.conversation_id, m)
      })
      const leadById = new Map((leadsRes.data as any[] || []).map(l => [l.id, l]))
      const custById = new Map((custsRes.data as any[] || []).map(c => [c.id, c]))

      const enriched = (data || []).map(c => {
        const contact = c.customer_id
          ? custById.get(c.customer_id) && { type: 'customer', ...custById.get(c.customer_id) }
          : c.lead_id
          ? leadById.get(c.lead_id) && { type: 'lead', ...leadById.get(c.lead_id) }
          : null
        return {
          ...c,
          contact,
          last_message: lastMsgByConv.get(c.id) || null,
          unread: c.last_activity_at && (!c.agent_last_seen_at || new Date(c.agent_last_seen_at) < new Date(c.last_activity_at)),
        }
      })
      return res.json({ conversations: enriched })
    }

    // ── POST actions ──────────────────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!id) return res.status(400).json({ error: 'id required' })
    const body = req.body || {}

    if (action === 'reply' || action === 'note') {
      const content = String(body.content || '').trim()
      if (!content) return res.status(400).json({ error: 'content required' })

      // Load conversation to find channel + thread — needed for external delivery.
      const { data: conv } = await admin
        .from('chat_conversations')
        .select('inbox_id, channel_type, external_thread_id')
        .eq('id', id)
        .maybeSingle()

      // Internal notes never leave the CRM regardless of channel.
      const isNote = action === 'note'
      const isExternal = !isNote && conv?.external_thread_id
        && ['telegram', 'zalo', 'facebook', 'email'].includes(conv.channel_type || '')

      // Initial delivery_status:
      //   • note or website → 'sent' immediately (nothing to deliver externally)
      //   • telegram → 'pending' → flipped to 'sent' inline below
      //   • zalo/facebook/email → 'pending' → worker flips after delivery
      const initialStatus = isExternal ? 'pending' : 'sent'

      const { data: msg, error } = await admin.from('chat_messages').insert({
        conversation_id: id,
        content,
        content_type: 'text',
        sender_type: 'agent',
        sender_id: user.id,
        private: isNote,
        delivery_status: initialStatus,
      }).select('*').single()
      if (error) return res.status(500).json({ error: error.message })

      // ── External channel delivery ────────────────────────────────────────
      if (isExternal && conv) {
        if (conv.channel_type === 'telegram') {
          // Inline: no worker needed — Telegram is a plain HTTP call.
          const result = await deliverTelegram(admin, conv.inbox_id, conv.external_thread_id!, content)
          await admin.from('chat_messages').update({
            delivery_status: result.ok ? 'sent' : 'failed',
            external_message_id: result.message_id
              ? `tg:${conv.external_thread_id}:${result.message_id}` : null,
          }).eq('id', msg.id)
          if (!result.ok) {
            // Also record on the queue for worker retry visibility, so admins
            // can see failed deliveries in one place.
            await admin.from('chat_outbound_queue').insert({
              message_id: msg.id,
              inbox_id: conv.inbox_id,
              conversation_id: id,
              channel_type: 'telegram',
              external_thread_id: conv.external_thread_id!,
              content,
              status: 'failed',
              attempts: 1,
              last_error: result.error,
            })
          }
        } else {
          // Zalo / Facebook / Email — queue for worker.
          await admin.from('chat_outbound_queue').insert({
            message_id: msg.id,
            inbox_id: conv.inbox_id,
            conversation_id: id,
            channel_type: conv.channel_type!,
            external_thread_id: conv.external_thread_id!,
            content,
            status: 'pending',
          })
        }
      }

      return res.json(msg)
    }

    if (action === 'assign') {
      const { data, error } = await admin.from('chat_conversations')
        .update({ assignee_id: body.assignee_id || null, updated_at: new Date().toISOString() })
        .eq('id', id).select('id, assignee_id').single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json(data)
    }

    if (action === 'status') {
      const newStatus = String(body.status || '')
      if (!['open', 'pending', 'snoozed', 'resolved'].includes(newStatus)) {
        return res.status(400).json({ error: 'invalid status' })
      }
      const patch: any = { status: newStatus, updated_at: new Date().toISOString() }
      if (newStatus === 'resolved') patch.resolved_at = new Date().toISOString()
      if (newStatus === 'snoozed' && body.snoozed_until) patch.snoozed_until = body.snoozed_until
      const { data, error } = await admin.from('chat_conversations').update(patch).eq('id', id).select('id, status, resolved_at, snoozed_until').single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json(data)
    }

    if (action === 'mark-read') {
      await admin.from('chat_conversations').update({ agent_last_seen_at: new Date().toISOString() }).eq('id', id)
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
