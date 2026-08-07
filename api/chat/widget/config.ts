// api/chat/widget/config.ts — Public widget config (no auth, uses website_token)
// GET /api/chat/widget/config?token=<website_token>

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const url = new URL(req.url || '', 'http://localhost')
  const token = url.searchParams.get('token')
  if (!token) return res.status(400).json({ error: 'token required' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: inbox } = await admin.from('chat_inboxes')
    .select('id, name, channel_type, channel_config, greeting_enabled, greeting_message, working_hours_enabled, out_of_office_message, is_active')
    .eq('website_token', token)
    .maybeSingle()

  if (!inbox || !inbox.is_active) return res.status(404).json({ error: 'Inbox not found or inactive' })

  return res.json({
    inbox_id: inbox.id,
    name: inbox.name,
    config: {
      widget_color: (inbox.channel_config as any)?.widget_color || '#B6FF00',
      welcome_title: (inbox.channel_config as any)?.welcome_title || 'Chào bạn 👋',
      welcome_tagline: (inbox.channel_config as any)?.welcome_tagline || 'Chúng tôi sẵn sàng hỗ trợ bạn',
      pre_chat_form_enabled: (inbox.channel_config as any)?.pre_chat_form_enabled ?? true,
      pre_chat_form_fields: (inbox.channel_config as any)?.pre_chat_form_fields || [
        { name: 'name', label: 'Họ tên', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
      ],
      position: (inbox.channel_config as any)?.position || 'bottom-right',
      greeting_enabled: inbox.greeting_enabled,
      greeting_message: inbox.greeting_message,
      working_hours_enabled: inbox.working_hours_enabled,
      out_of_office_message: inbox.out_of_office_message,
    },
  })
}
