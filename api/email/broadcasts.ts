// api/email/broadcasts.ts — Broadcast history + preview count (admin only)
//
//   GET /api/email/broadcasts
//     → { broadcasts: [...] }   past 100 sends, newest first
//
//   GET /api/email/broadcasts?action=preview&audience=all-leads
//   GET /api/email/broadcasts?action=preview&audience=tag&tag=vip
//     → { count: N }
//
//   GET /api/email/broadcasts?action=env
//     → { provider: 'brevo'|'resend'|'none', has_key: bool, warnings: [...] }
//
// Wave 2 Track F — companion to /api/email/broadcast (POST).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveRecipients } from './broadcast'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const BROADCAST_ROLES = ['owner', 'admin', 'sales']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

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

  const { data: caller } = await userClient
    .from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!caller || !BROADCAST_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Không có quyền xem broadcasts' })
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const action = url.searchParams.get('action')

  // ── ENV CHECK ───────────────────────────────────────────────────────────
  // Merge env vars + app_settings (Settings > Email UI writes there). This is
  // what makes the "Đang dùng Brevo" pill update after the user pastes their key
  // in Settings without editing .env.
  if (action === 'env') {
    const { data: rows } = await admin.from('app_settings').select('key, value')
      .in('key', ['email_provider', 'brevo_api_key', 'resend_api_key'])
    const s: Record<string, string> = {}
    ;(rows || []).forEach((r: any) => { s[r.key] = (r.value?.value ?? r.value ?? '') as string })
    const provider = (s['email_provider'] || process.env.EMAIL_PROVIDER || 'resend').toLowerCase()
    const brevoKey  = !!(s['brevo_api_key']  || process.env.BREVO_API_KEY)
    const resendKey = !!(s['resend_api_key'] || process.env.RESEND_API_KEY)
    const warnings: string[] = []
    if (provider === 'brevo' && !brevoKey) {
      warnings.push('EMAIL_PROVIDER=brevo nhưng thiếu Brevo API key. Vào Cài đặt → Email → Email Marketing để lưu key.')
    }
    if (!brevoKey && !resendKey) {
      warnings.push('Chưa có API key nào (Brevo hoặc Resend) — broadcast sẽ fail. Vào Cài đặt → Email.')
    }
    return res.json({
      provider, has_brevo_key: brevoKey, has_resend_key: resendKey,
      warnings, brevo_dashboard_url: 'https://app.brevo.com',
    })
  }

  // ── PREVIEW ─────────────────────────────────────────────────────────────
  if (action === 'preview') {
    const audience = url.searchParams.get('audience') || ''
    const tag = url.searchParams.get('tag') || undefined
    const tagsParam = url.searchParams.get('tags') || ''
    const tags = tagsParam.split(',').map(s => s.trim()).filter(Boolean)
    const course_id = url.searchParams.get('course_id') || undefined
    try {
      const recipients = await resolveRecipients(admin, audience, { tag, tags, course_id })
      return res.json({ count: recipients.length })
    } catch (e: any) {
      return res.status(400).json({ error: e.message || 'Preview failed', count: 0 })
    }
  }

  // ── TAGS LIST ───────────────────────────────────────────────────────────
  // Returns distinct tags from customers + leads for the audience picker dropdown.
  if (action === 'tags') {
    const [{ data: custs }, { data: leadRows }] = await Promise.all([
      admin.from('customers').select('tags').not('tags', 'is', null),
      admin.from('leads').select('tags').not('tags', 'is', null),
    ])
    const counts = new Map<string, number>()
    for (const row of [...(custs || []), ...(leadRows || [])]) {
      const arr = (row.tags as string[] | null) || []
      for (const t of arr) if (t?.trim()) counts.set(t, (counts.get(t) || 0) + 1)
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }))
    return res.json({ tags })
  }

  // ── LIST HISTORY (default GET) ──────────────────────────────────────────
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200)
  const { data, error } = await admin.from('email_broadcasts')
    .select(`
      id, subject, recipient_filter, recipient_count,
      sent_count, failed_count, status, error, created_at, connection_id,
      creator:customers!email_broadcasts_created_by_fkey(id, display_name, email),
      connection:email_connections!email_broadcasts_connection_id_fkey(id, name, provider)
    `)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ broadcasts: data || [] })
}
