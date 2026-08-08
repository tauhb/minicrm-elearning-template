/**
 * services/email.ts — Multi-provider email transport.
 *
 * Rewritten Wave 3: routes each send through a specific email_connections row.
 * Adapters live in services/email-adapters/*. Registry (labels, capability
 * flags) in services/email-providers.ts.
 *
 * Selection rules (in order):
 *   1. Explicit connectionId  → use that row (must be active)
 *   2. kind='marketing'       → is_default_marketing
 *   3. else (transactional)   → is_default_transactional
 * Fallback: any active row with matching supports_* → any active row → error.
 *
 * Backward compat: legacy callers `sendEmail({template, to, subject, from,
 * data})` still work — they resolve to the transactional default.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { tryDecryptOrRaw } from './crypto'
import { EMAIL_PROVIDERS } from './email-providers'
import * as resendAdapter from './email-adapters/resend'
import * as brevoAdapter  from './email-adapters/brevo'
import type { AdapterConnection, AdapterSendResult } from './email-adapters/resend'

export type EmailTemplate =
  | 'welcome-magic-link'
  | 'welcome-credentials'
  | 'password-reset'
  | 'enrollment'
  | 'payment-confirmation'
  | 'certificate'
  | 'broadcast'

export type EmailKind = 'transactional' | 'marketing'

export interface SendEmailInput {
  to: string | string[]
  subject: string
  template: EmailTemplate
  data: Record<string, any>
  from?: string
  replyTo?: string
  /** Explicit connection to use — overrides the default resolution. */
  connectionId?: string
  /** Bucket for default resolution. Defaults to 'transactional'. */
  kind?: EmailKind
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  provider: string   // provider id ('resend' | 'brevo' | future) or 'none' | 'supabase-magic-link'
  connection_id?: string
  error?: string
}

// ─── Template loading ────────────────────────────────────────────────────────
const TEMPLATES_DIR = join(process.cwd(), 'emails', 'templates')
const templateCache = new Map<string, string>()

function loadTemplate(name: string): string {
  if (templateCache.has(name)) return templateCache.get(name)!
  const path = join(TEMPLATES_DIR, `${name}.html`)
  if (!existsSync(path)) throw new Error(`Email template not found: ${name}.html`)
  const content = readFileSync(path, 'utf8')
  templateCache.set(name, content)
  return content
}

function renderTemplate(tpl: string, data: Record<string, any>): string {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) =>
    data[key] ? body : '',
  )
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    data[key] != null ? String(data[key]) : '',
  )
  return out
}

function renderEmail(template: EmailTemplate, data: Record<string, any>): string {
  const layout = loadTemplate('_layout')
  const contentTpl = loadTemplate(template)
  const content = renderTemplate(contentTpl, data)
  return renderTemplate(layout, { ...data, content })
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
function admin() {
  const url = process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) throw new Error('Supabase not configured (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function getAppTitle(): Promise<string> {
  try {
    const db = admin()
    const { data } = await db.from('app_settings').select('value').eq('key', 'title').maybeSingle()
    return (data?.value as any)?.value || 'Portal'
  } catch { return 'Portal' }
}

interface ResolvedConnection {
  id: string
  provider: string
  name: string
  from_email: string
  from_name: string | null
  api_key: string
  extra: Record<string, any>
  monthly_sent: number
  monthly_reset_at: string | null
}

/**
 * Pick a connection row per the selection rules described in the module header.
 * Returns null when nothing usable exists (caller surfaces a friendly error).
 */
async function resolveConnection(
  connectionId: string | undefined,
  kind: EmailKind,
): Promise<{ ok: true; conn: ResolvedConnection } | { ok: false; error: string }> {
  const db = admin()

  const decode = (row: any): ResolvedConnection => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    from_email: row.from_email,
    from_name: row.from_name,
    api_key: tryDecryptOrRaw(row.api_key_encrypted) || '',
    extra: row.extra || {},
    monthly_sent: row.monthly_sent || 0,
    monthly_reset_at: row.monthly_reset_at,
  })

  // 1. Explicit id
  if (connectionId) {
    const { data } = await db.from('email_connections')
      .select('*').eq('id', connectionId).eq('status', 'active').maybeSingle()
    if (!data) return { ok: false, error: `Email connection ${connectionId} not found or disabled` }
    return { ok: true, conn: decode(data) }
  }

  const defaultFlag = kind === 'marketing' ? 'is_default_marketing' : 'is_default_transactional'

  // 2. Preferred default for the requested kind
  const { data: preferred } = await db.from('email_connections')
    .select('*').eq(defaultFlag, true).eq('status', 'active').maybeSingle()
  if (preferred) return { ok: true, conn: decode(preferred) }

  // 3. Any active connection whose provider supports this kind
  const capabilityField = kind === 'marketing' ? 'supports_marketing' : 'supports_transactional'
  const capableProviders = Object.values(EMAIL_PROVIDERS)
    .filter(p => (p as any)[capabilityField])
    .map(p => p.id)
  const { data: capable } = await db.from('email_connections')
    .select('*').eq('status', 'active').in('provider', capableProviders)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (capable) return { ok: true, conn: decode(capable) }

  // 4. Last resort: any active connection at all
  const { data: any } = await db.from('email_connections')
    .select('*').eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (any) return { ok: true, conn: decode(any) }

  return {
    ok: false,
    error: 'Chưa có email connection nào (active). Vào Cài đặt → Email → Kết nối để thêm.',
  }
}

function pickAdapter(providerId: string) {
  if (providerId === 'resend') return resendAdapter
  if (providerId === 'brevo')  return brevoAdapter
  throw new Error(`No adapter for email provider "${providerId}"`)
}

/** Increment usage counters (fire-and-forget). Handles monthly rollover. */
function bumpUsage(connId: string, currentSent: number, resetAt: string | null): void {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const needsReset = !resetAt || new Date(resetAt) < monthStart
  const patch: Record<string, any> = { last_used_at: now.toISOString() }
  if (needsReset) {
    patch.monthly_sent = 1
    patch.monthly_reset_at = monthStart.toISOString()
  } else {
    patch.monthly_sent = currentSent + 1
  }
  admin().from('email_connections').update(patch).eq('id', connId)
    .then(() => {}, () => {})
}

// ─── Main API ────────────────────────────────────────────────────────────────
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const appName = await getAppTitle()

  const to = (Array.isArray(input.to) ? input.to : [input.to]).filter(Boolean)
  if (!to.length) return { ok: false, provider: 'none', error: 'No recipients' }

  const resolved = await resolveConnection(input.connectionId, input.kind || 'transactional')
  if (resolved.ok !== true) {
    return { ok: false, provider: 'none', error: resolved.error }
  }
  const conn = resolved.conn

  if (!conn.api_key) {
    return {
      ok: false, provider: conn.provider, connection_id: conn.id,
      error: `Connection "${conn.name}" (${conn.provider}) chưa có API key hoặc không giải mã được.`,
    }
  }

  // Sender override: legacy `from` string wins over connection default.
  const adapterConn: AdapterConnection = {
    api_key: conn.api_key,
    from_email: conn.from_email,
    from_name: conn.from_name || appName,
    extra: conn.extra,
  }
  if (input.from) {
    const match = input.from.match(/^(.*?)\s*<(.+)>$/)
    if (match) {
      adapterConn.from_name = match[1]?.trim() || adapterConn.from_name
      adapterConn.from_email = match[2] || adapterConn.from_email
    } else {
      adapterConn.from_email = input.from
    }
  }

  const html = renderEmail(input.template, { appName, ...input.data })

  let adapter
  try { adapter = pickAdapter(conn.provider) }
  catch (e: any) {
    return { ok: false, provider: conn.provider, connection_id: conn.id, error: e.message }
  }

  const result: AdapterSendResult = await adapter.send(adapterConn, {
    to, subject: input.subject, html, replyTo: input.replyTo,
  })

  if (result.ok) {
    bumpUsage(conn.id, conn.monthly_sent, conn.monthly_reset_at)
    return { ok: true, id: result.id, provider: conn.provider, connection_id: conn.id }
  }
  return { ok: false, provider: conn.provider, connection_id: conn.id, error: result.error }
}

/**
 * Fallback: generate + send Supabase magic link when no email connection exists.
 * Used by webhook/provision as a last resort.
 */
export async function sendSupabaseMagicLink(email: string, redirectTo?: string): Promise<SendEmailResult> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, provider: 'none', error: 'Supabase not configured' }
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  try {
    const { error } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    })
    if (error) return { ok: false, provider: 'supabase-magic-link', error: error.message }
    return { ok: true, provider: 'supabase-magic-link' }
  } catch (e: any) {
    return { ok: false, provider: 'supabase-magic-link', error: e.message }
  }
}

/**
 * Convenience: send welcome email with automatic fallback to Supabase magic
 * link when no email connection is configured.
 */
export async function sendWelcome(opts: {
  email: string
  name: string
  portalUrl: string
  mode: 'magic-link' | 'credentials'
  password?: string
  loginUrl?: string
}): Promise<SendEmailResult> {
  const appName = await getAppTitle()

  // Probe: any active connection? If none, fall back to Supabase magic link.
  try {
    const db = admin()
    const { count } = await db.from('email_connections')
      .select('id', { count: 'exact', head: true }).eq('status', 'active')
    if (!count) return sendSupabaseMagicLink(opts.email, opts.portalUrl)
  } catch { /* fall through to attempt send */ }

  if (opts.mode === 'credentials') {
    return sendEmail({
      to: opts.email,
      subject: `Thông tin đăng nhập ${appName}`,
      template: 'welcome-credentials',
      kind: 'transactional',
      data: {
        name: opts.name,
        email: opts.email,
        password: opts.password || '',
        portalUrl: opts.portalUrl,
      },
    })
  }

  return sendEmail({
    to: opts.email,
    subject: `Truy cập ${appName}`,
    template: 'welcome-magic-link',
    kind: 'transactional',
    data: {
      name: opts.name,
      loginUrl: opts.loginUrl || opts.portalUrl,
    },
  })
}
