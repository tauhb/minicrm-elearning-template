// api/chat/widget/conversation.ts — Widget conversation actions (public)
//
// POST /api/chat/widget/conversation?action=start   → start conversation (pre-chat form)
// POST /api/chat/widget/conversation?action=message → send visitor message
// GET  /api/chat/widget/conversation?action=poll    → get new messages since ts
//
// All require session_token in body/query for identity.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action') || 'start'

  const admin = adminDb()

  // ── POLL: GET new messages since last_ts ─────────────────────────────────
  if (action === 'poll') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const sessionToken = url.searchParams.get('session_token')
    const sinceTs = url.searchParams.get('since') || new Date(0).toISOString()
    if (!sessionToken) return res.status(400).json({ error: 'session_token required' })

    const { data: session } = await admin.from('chat_visitor_sessions')
      .select('conversation_id').eq('session_token', sessionToken).maybeSingle()
    if (!session?.conversation_id) return res.json({ messages: [] })

    const { data: messages } = await admin.from('chat_messages')
      .select('id, content, content_type, sender_type, created_at')
      .eq('conversation_id', session.conversation_id)
      .eq('private', false)
      .gt('created_at', sinceTs)
      .order('created_at')
      .limit(50)

    // Update contact_last_seen_at
    await admin.from('chat_conversations').update({
      contact_last_seen_at: new Date().toISOString(),
    }).eq('id', session.conversation_id)

    return res.json({ messages: messages || [] })
  }

  // ── START: create conversation from pre-chat form ────────────────────────
  if (action === 'start') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const { session_token, name, email, phone, initial_message, source } = req.body || {}
    if (!session_token) return res.status(400).json({ error: 'session_token required' })
    if (!email) return res.status(400).json({ error: 'email required (or make pre-chat form optional in inbox config)' })

    const { data: session } = await admin.from('chat_visitor_sessions')
      .select('id, inbox_id, conversation_id, visitor_meta')
      .eq('session_token', session_token).maybeSingle()
    if (!session) return res.status(404).json({ error: 'Session not found — reload page' })

    // If session already has conversation → return it (idempotent)
    if (session.conversation_id) {
      return res.json({ conversation_id: session.conversation_id, existed: true })
    }

    // ── Contact resolution: leads-first ──
    const emailLower = String(email).trim().toLowerCase()
    let leadId: string | null = null
    let customerId: string | null = null

    // 1. Check customer with this email
    const { data: existingCustomer } = await admin.from('customers')
      .select('id').eq('email', emailLower).maybeSingle()
    if (existingCustomer) customerId = existingCustomer.id

    // 2. Check lead with this email (regardless of customer)
    const { data: existingLead } = await admin.from('leads')
      .select('id, name, phone').eq('email', emailLower).maybeSingle()
    if (existingLead) {
      leadId = existingLead.id
      // Update contact info if new
      const patch: any = {}
      if (name && !existingLead.name) patch.name = name
      if (phone && !existingLead.phone) patch.phone = phone
      if (Object.keys(patch).length) await admin.from('leads').update(patch).eq('id', leadId)
    } else if (!customerId) {
      // 3. Create new lead (visitor is neither customer nor existing lead)
      const meta = (session.visitor_meta as any) || {}
      const { data: newLead } = await admin.from('leads').insert({
        email: emailLower,
        name: name || emailLower.split('@')[0],
        phone: phone || null,
        source: `chat-widget:${meta.funnel_slug || 'direct'}`,
        utm_source: meta.utm?.utm_source || null,
        utm_medium: meta.utm?.utm_medium || null,
        utm_campaign: meta.utm?.utm_campaign || null,
      }).select('id').single()
      leadId = newLead?.id || null
    }

    // ── Create conversation ──
    const meta = (session.visitor_meta as any) || {}
    const { data: conv, error: convErr } = await admin.from('chat_conversations').insert({
      inbox_id: session.inbox_id,
      lead_id: leadId,
      customer_id: customerId,
      visitor_session_id: session.id,
      status: 'open',
      source_url: source?.url || meta.first_seen_url || null,
      source_funnel_id: source?.funnel_id || null,
      source_step_id: source?.step_id || null,
      utm: meta.utm || {},
      additional_attributes: { visitor_meta: meta },
    }).select('id').single()
    if (convErr || !conv) return res.status(500).json({ error: convErr?.message || 'Conversation create failed' })

    // Link session → conversation
    await admin.from('chat_visitor_sessions').update({ conversation_id: conv.id }).eq('id', session.id)

    // Insert initial message if provided
    if (initial_message && String(initial_message).trim()) {
      await admin.from('chat_messages').insert({
        conversation_id: conv.id,
        content: String(initial_message).trim(),
        content_type: 'text',
        sender_type: 'contact',
        sender_id: leadId || customerId,
      })
    }

    // Auto-greeting from inbox
    const { data: inbox } = await admin.from('chat_inboxes')
      .select('greeting_enabled, greeting_message, auto_assign_to').eq('id', session.inbox_id).maybeSingle()
    if (inbox?.greeting_enabled && inbox.greeting_message) {
      await admin.from('chat_messages').insert({
        conversation_id: conv.id,
        content: inbox.greeting_message,
        content_type: 'text',
        sender_type: 'system',
      })
    }
    if (inbox?.auto_assign_to) {
      await admin.from('chat_conversations').update({ assignee_id: inbox.auto_assign_to }).eq('id', conv.id)
    }

    return res.json({ conversation_id: conv.id, existed: false })
  }

  // ── MESSAGE: visitor sends a message ─────────────────────────────────────
  if (action === 'message') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const { session_token, content } = req.body || {}
    if (!session_token) return res.status(400).json({ error: 'session_token required' })
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'content required' })

    const { data: session } = await admin.from('chat_visitor_sessions')
      .select('conversation_id').eq('session_token', session_token).maybeSingle()
    if (!session?.conversation_id) return res.status(400).json({ error: 'No conversation — start first' })

    const { data: conv } = await admin.from('chat_conversations')
      .select('lead_id, customer_id').eq('id', session.conversation_id).maybeSingle()

    const { data: msg, error } = await admin.from('chat_messages').insert({
      conversation_id: session.conversation_id,
      content: String(content).trim(),
      content_type: 'text',
      sender_type: 'contact',
      sender_id: conv?.lead_id || conv?.customer_id || null,
    }).select('id, created_at').single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ message_id: msg.id, created_at: msg.created_at })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}
