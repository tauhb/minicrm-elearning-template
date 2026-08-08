/**
 * services/email.ts — Provider-agnostic email helper
 *
 * Currently supports: Resend (default)
 * Falls back to Supabase Auth magic link if RESEND_API_KEY absent.
 *
 * Usage:
 *   import { sendEmail } from '../services/email'
 *   await sendEmail({
 *     to: 'user@x.com',
 *     subject: 'Welcome',
 *     template: 'welcome-magic-link',
 *     data: { name: 'Alice', loginUrl: 'https://...' }
 *   })
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

export type EmailTemplate =
  | 'welcome-magic-link'
  | 'welcome-credentials'
  | 'password-reset'
  | 'enrollment'
  | 'payment-confirmation'
  | 'certificate'
  | 'broadcast'

export interface SendEmailInput {
  to: string | string[]
  subject: string
  template: EmailTemplate
  data: Record<string, any>
  from?: string   // Override sender
  replyTo?: string
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  provider: 'resend' | 'supabase-magic-link' | 'none'
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

// Simple {{var}} + {{#if var}}...{{/if}} rendering (no partials, no loops beyond truthy check)
function renderTemplate(tpl: string, data: Record<string, any>): string {
  // Handle {{#if x}}...{{/if}} first
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) =>
    data[key] ? body : ''
  )
  // Handle {{var}}
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    data[key] != null ? String(data[key]) : ''
  )
  return out
}

function renderEmail(template: EmailTemplate, data: Record<string, any>): string {
  const layout = loadTemplate('_layout')
  const contentTpl = loadTemplate(template)
  const content = renderTemplate(contentTpl, data)
  return renderTemplate(layout, { ...data, content })
}

// ─── App settings helper (read from Supabase) ────────────────────────────────
async function getAppSettings(): Promise<{
  appName: string
  resendKey: string
  brevoKey: string
  provider: 'brevo' | 'resend'
}> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  let appName = 'Portal'
  let resendKey = process.env.RESEND_API_KEY || ''
  let brevoKey  = process.env.BREVO_API_KEY || ''
  let provider  = (process.env.EMAIL_PROVIDER || '').toLowerCase() as 'brevo' | 'resend' | ''

  if (supabaseUrl && serviceKey) {
    try {
      const db = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data } = await db.from('app_settings')
        .select('key, value').in('key', ['title', 'resend_api_key', 'brevo_api_key', 'email_provider'])
      if (data) {
        const map: Record<string, any> = {}
        data.forEach((r: any) => { map[r.key] = r.value })
        appName = map['title']?.value || appName
        if (!resendKey) resendKey = map['resend_api_key']?.value || ''
        if (!brevoKey)  brevoKey  = map['brevo_api_key']?.value || ''
        if (!provider)  provider  = (map['email_provider']?.value || '').toLowerCase()
      }
    } catch { /* silent */ }
  }
  // Auto-pick: if user saved a Brevo key but never set provider, prefer Brevo for marketing.
  if (!provider) provider = brevoKey ? 'brevo' : 'resend'
  return { appName, resendKey, brevoKey, provider: provider as 'brevo' | 'resend' }
}

// ─── Main API ────────────────────────────────────────────────────────────────
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { appName, resendKey, brevoKey, provider } = await getAppSettings()

  const html = renderEmail(input.template, { appName, ...input.data })
  const to = (Array.isArray(input.to) ? input.to : [input.to]).filter(Boolean)
  if (!to.length) return { ok: false, provider: 'none', error: 'No recipients' }

  // Provider selection: honor explicit provider setting, fallback to whichever key exists.
  const useBrevo  = provider === 'brevo'  && brevoKey
  const useResend = !useBrevo && resendKey
  if (!useBrevo && !useResend) {
    return { ok: false, provider: 'none',
      error: 'Chưa có API key nào (Brevo hoặc Resend). Vào Cài đặt → Email để cấu hình.' }
  }

  // ── Brevo path (marketing + transactional) ─────────────────────────────
  if (useBrevo) {
    const from = input.from || `${appName} <no-reply@brevo.local>`
    const fromMatch = from.match(/^(.*?)\s*<(.+)>$/)
    const senderName  = fromMatch?.[1]?.trim() || appName
    const senderEmail = fromMatch?.[2] || 'no-reply@brevo.local'
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'accept': 'application/json',
          'api-key': brevoKey,
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: to.map(e => ({ email: e })),
          subject: input.subject,
          htmlContent: html,
          replyTo: input.replyTo ? { email: input.replyTo } : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, provider: 'brevo', error: data?.message || `HTTP ${res.status}` }
      return { ok: true, id: data?.messageId, provider: 'brevo' }
    } catch (e: any) {
      return { ok: false, provider: 'brevo', error: e.message || String(e) }
    }
  }

  // ── Resend path (transactional / fallback) ─────────────────────────────
  const from = input.from || `${appName} <onboarding@resend.dev>`
  try {
    const resend = new Resend(resendKey)
    const res = await resend.emails.send({
      from, to, subject: input.subject, html, replyTo: input.replyTo,
    })
    if (res.error) return { ok: false, provider: 'resend', error: res.error.message }
    return { ok: true, id: res.data?.id, provider: 'resend' }
  } catch (e: any) {
    return { ok: false, provider: 'resend', error: e.message || String(e) }
  }
}

/**
 * Fallback: generate + send Supabase magic link if Resend absent.
 * Used by webhook/provision when no RESEND_API_KEY.
 */
export async function sendSupabaseMagicLink(email: string, redirectTo?: string): Promise<SendEmailResult> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, provider: 'none', error: 'Supabase not configured' }
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
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
 * Convenience: send welcome email with automatic Resend/Supabase fallback.
 */
export async function sendWelcome(opts: {
  email: string
  name: string
  portalUrl: string
  mode: 'magic-link' | 'credentials'
  password?: string
  loginUrl?: string
}): Promise<SendEmailResult> {
  const { appName, resendKey } = await getAppSettings()
  if (!resendKey) return sendSupabaseMagicLink(opts.email, opts.portalUrl)

  if (opts.mode === 'credentials') {
    return sendEmail({
      to: opts.email,
      subject: `Thông tin đăng nhập ${appName}`,
      template: 'welcome-credentials',
      data: {
        name: opts.name,
        email: opts.email,
        password: opts.password || '',
        portalUrl: opts.portalUrl,
      }
    })
  }

  return sendEmail({
    to: opts.email,
    subject: `Truy cập ${appName}`,
    template: 'welcome-magic-link',
    data: {
      name: opts.name,
      loginUrl: opts.loginUrl || opts.portalUrl,
    }
  })
}
