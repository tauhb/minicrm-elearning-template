// api/chat/widget/session.ts — Create/resume visitor session
// POST /api/chat/widget/session
// Body: { token, session_token?, meta? }
// Returns: { session_token, conversation_id? }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { token, session_token, meta } = req.body || {}
  if (!token) return res.status(400).json({ error: 'token required' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: inbox } = await admin.from('chat_inboxes')
    .select('id, is_active').eq('website_token', token).maybeSingle()
  if (!inbox || !inbox.is_active) return res.status(404).json({ error: 'Inbox not found' })

  // Resume existing session
  if (session_token) {
    const { data: session } = await admin.from('chat_visitor_sessions')
      .select('id, session_token, conversation_id')
      .eq('session_token', session_token).eq('inbox_id', inbox.id).maybeSingle()
    if (session) {
      await admin.from('chat_visitor_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id)
      return res.json({
        session_token: session.session_token,
        conversation_id: session.conversation_id,
      })
    }
  }

  // Create new session
  const ua = (req.headers['user-agent'] as string) || ''
  const ip = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || 'unknown'
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)

  const visitorMeta = {
    user_agent: ua.slice(0, 300),
    ip_hash: ipHash,
    ...(meta || {}),
  }

  const { data: newSession, error } = await admin.from('chat_visitor_sessions').insert({
    inbox_id: inbox.id,
    visitor_meta: visitorMeta,
  }).select('session_token').single()

  if (error || !newSession) return res.status(500).json({ error: error?.message || 'Session create failed' })

  return res.json({ session_token: newSession.session_token })
}
