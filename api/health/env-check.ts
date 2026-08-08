// api/health/env-check.ts — Admin health check for env vars & integrations
//
// GET /api/health/env-check  (Bearer token — admin only)
//
// Returns: { items: [{ key, label, category, present, hint?, meta? }], ok: boolean }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

interface HealthItem {
  key: string
  label: string
  category: 'core' | 'ai' | 'email' | 'payment' | 'portal'
  present: boolean
  optional?: boolean
  hint?: string
  meta?: Record<string, any>
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Verify admin
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const token = authHeader.slice(7)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // If core Supabase env is missing, still allow response so UI can flag it.
  if (supabaseUrl && anonKey) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: { user } } = await userClient.auth.getUser()
      if (!user) return res.status(401).json({ error: 'Invalid token' })
      const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
      if (!['owner','admin'].includes(caller?.role || '')) return res.status(403).json({ error: 'Admin only' })
    } catch (e: any) {
      return res.status(500).json({ error: `Auth check failed: ${e.message}` })
    }
  }

  const items: HealthItem[] = []

  // ── Core ─────────────────────────────────────────────
  items.push({
    key: 'VITE_SUPABASE_URL',
    label: 'Supabase URL',
    category: 'core',
    present: !!supabaseUrl,
    hint: supabaseUrl ? undefined : 'Set VITE_SUPABASE_URL trong .env.local (Supabase project URL), rồi restart dev server.',
  })
  items.push({
    key: 'VITE_SUPABASE_ANON_KEY',
    label: 'Supabase Anon Key',
    category: 'core',
    present: !!anonKey,
    hint: anonKey ? undefined : 'Set VITE_SUPABASE_ANON_KEY trong .env.local, rồi restart dev server.',
  })
  items.push({
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    label: 'Supabase Service Role Key',
    category: 'core',
    present: !!serviceKey,
    hint: serviceKey ? undefined : 'Set SUPABASE_SERVICE_ROLE_KEY trong .env.local. Bắt buộc cho admin actions & webhooks.',
  })

  // Supabase reachability ping
  let dbOk = false
  let dbError: string | undefined
  if (supabaseUrl && anonKey) {
    try {
      const db = createClient(supabaseUrl, anonKey)
      const { error } = await db.from('app_settings').select('key').limit(1)
      dbOk = !error
      if (error) dbError = error.message
    } catch (e: any) {
      dbError = e.message
    }
  }
  items.push({
    key: 'SUPABASE_REACHABLE',
    label: 'Supabase kết nối được',
    category: 'core',
    present: dbOk,
    hint: dbOk ? undefined : (dbError ? `Không kết nối được: ${dbError}` : 'Kiểm tra VITE_SUPABASE_URL / anon key có đúng project không.'),
  })

  // ── AI (OpenAI key OR OAuth Codex session in DB) ─────────
  const openaiEnv = !!process.env.OPENAI_API_KEY
  let oauthCodex = false
  let oauthMeta: any = undefined
  if (serviceKey && supabaseUrl) {
    try {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
      // Prefer provider_credentials (active connection); fall back to authorized oauth_device_sessions rows
      const { data: cred } = await admin.from('provider_credentials')
        .select('provider, status, expires_at, connected_at, account_email')
        .eq('provider', 'openai-codex')
        .maybeSingle()
      if (cred && cred.status === 'active') {
        const notExpired = !cred.expires_at || new Date(cred.expires_at as any) > new Date()
        if (notExpired) {
          oauthCodex = true
          oauthMeta = { via: 'oauth_device_code', account_email: cred.account_email, connected_at: cred.connected_at }
        }
      }
      if (!oauthCodex) {
        const { data: sess } = await admin.from('oauth_device_sessions')
          .select('id, status, authorized_at')
          .eq('provider', 'openai-codex')
          .eq('status', 'authorized')
          .order('authorized_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (sess) {
          oauthCodex = true
          oauthMeta = { via: 'oauth_device_session', authorized_at: sess.authorized_at }
        }
      }
    } catch {
      // ignore — treat as no oauth
    }
  }
  items.push({
    key: 'AI_PROVIDER',
    label: 'AI Provider (OpenAI key hoặc OAuth Codex)',
    category: 'ai',
    present: openaiEnv || oauthCodex,
    hint: (openaiEnv || oauthCodex)
      ? (openaiEnv ? 'OPENAI_API_KEY đã cấu hình trong .env' : 'Đã kết nối OpenAI Codex qua OAuth device.')
      : 'Set OPENAI_API_KEY trong .env.local hoặc vào Cài đặt → AI Providers để kết nối tài khoản ChatGPT.',
    meta: { openai_env: openaiEnv, oauth_codex: oauthCodex, ...(oauthMeta || {}) },
  })

  // ── Email ────────────────────────────────────────────────
  // The new source of truth is email_connections (Track β). Fall back to env vars +
  // legacy app_settings only when the table is empty (fresh install pre-migration).
  let emailPresent = false
  let emailHint: string | undefined
  const emailMeta: any = { connections: 0, has_transactional_default: false, has_marketing_default: false }
  try {
    if (serviceKey && supabaseUrl) {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
      const { data: conns } = await admin.from('email_connections')
        .select('provider, name, status, is_default_transactional, is_default_marketing')
        .eq('status', 'active')
      const active = conns || []
      emailMeta.connections = active.length
      emailMeta.providers = [...new Set(active.map((c: any) => c.provider))]
      emailMeta.has_transactional_default = active.some((c: any) => c.is_default_transactional)
      emailMeta.has_marketing_default     = active.some((c: any) => c.is_default_marketing)
      if (active.length > 0) {
        emailPresent = true
        const labels = active.map((c: any) => c.name).join(', ')
        emailHint = `${active.length} kết nối đang hoạt động: ${labels}`
        // Warn if no defaults set (broadcast will resolve to any active — still works but ambiguous)
        if (!emailMeta.has_marketing_default) {
          emailHint += ' — chưa đặt default marketing (bấm ⭐ trong Settings → Email → Kết nối).'
        }
      }
    }
  } catch (e: any) {
    emailMeta.error = e.message
  }
  // Fallback: env or legacy app_settings key present but no connections yet
  if (!emailPresent) {
    const brevoKey  = !!process.env.BREVO_API_KEY
    const resendKey = !!process.env.RESEND_API_KEY
    if (brevoKey || resendKey) {
      emailPresent = true
      emailHint = 'Có API key trong .env nhưng chưa tạo email_connections. Vào Cài đặt → Email → Kết nối để thêm.'
    } else {
      emailHint = 'Chưa có kết nối email nào. Vào Cài đặt → Email → Kết nối để thêm Brevo/Resend.'
    }
  }
  items.push({
    key: 'email_connections',
    label: 'Email connections',
    category: 'email',
    present: emailPresent,
    hint: emailHint,
    meta: emailMeta,
  })

  // ── Payment (SePay on any funnel with inline_qr) ─────────
  let paymentFunnels = 0
  let paymentPresent = false
  if (serviceKey && supabaseUrl) {
    try {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
      const { count } = await admin
        .from('funnel_flows')
        .select('id', { count: 'exact', head: true })
        .eq('payment_mode', 'inline_qr')
      paymentFunnels = count || 0
      paymentPresent = paymentFunnels > 0
    } catch {
      // table may not exist — treat as none
    }
  }
  items.push({
    key: 'PAYMENT_SEPAY',
    label: 'SePay VietQR đã bật trên funnel nào chưa',
    category: 'payment',
    present: paymentPresent,
    optional: true,
    hint: paymentPresent
      ? `${paymentFunnels} funnel đang bật inline QR thanh toán.`
      : 'Chưa có funnel nào bật thanh toán inline. Vào AI Funnels → sửa funnel → payment_mode=inline_qr + cấu hình SePay.',
    meta: { count: paymentFunnels },
  })

  // ── Customer Portal integration ─────────────────────────
  const portalUrl = process.env.CUSTOMER_PORTAL_URL
  const selfHost = !portalUrl
  items.push({
    key: 'CUSTOMER_PORTAL_URL',
    label: 'Customer Portal URL',
    category: 'portal',
    // Standalone install: mark as present (this app IS the portal), N/A visually
    present: selfHost || !!portalUrl,
    optional: true,
    hint: selfHost
      ? 'Standalone install (app này là Customer Portal). Không cần CUSTOMER_PORTAL_URL.'
      : `CUSTOMER_PORTAL_URL = ${portalUrl}`,
    meta: { standalone: selfHost, portal_url: portalUrl || null },
  })

  const requiredOk = items.filter(i => !i.optional).every(i => i.present)

  return res.status(200).json({
    ok: requiredOk,
    timestamp: new Date().toISOString(),
    items,
  })
}
