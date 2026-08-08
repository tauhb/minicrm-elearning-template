/**
 * services/email-providers.ts — Registry of email transport providers.
 *
 * Mirrors the AI providers pattern (services/ai-providers.ts): one entry per
 * supported provider, credentials stored per-row in email_connections table.
 * Adding a provider = new entry here + optional adapter in email-adapters/.
 *
 * MVP ships with Resend + Brevo adapters. Others are declared (disabled: true)
 * so the UI can list them as "coming soon" without silently offering broken
 * connections.
 */

export type EmailAuthType = 'api-key' | 'smtp' | 'aws-sig'

export interface EmailProviderConfig {
  id: string
  label: string
  auth: EmailAuthType
  docs_url: string                 // where user creates the API key
  dashboard_url?: string           // where user manages campaigns/logs/analytics (for the "Mở [Provider] Dashboard" button)
  supports_marketing: boolean
  supports_transactional: boolean
  monthly_free?: number
  best_for?: 'marketing' | 'transactional' | 'both'
  requires_domain?: boolean
  requires_region?: boolean
  disabled?: boolean               // MVP: mark future providers as disabled=true
  from_email_hint?: string          // "must be verified in Brevo"
}

export const EMAIL_PROVIDERS: Record<string, EmailProviderConfig> = {
  resend: {
    id: 'resend', label: 'Resend', auth: 'api-key',
    docs_url: 'https://resend.com/api-keys',
    dashboard_url: 'https://resend.com/emails',
    supports_marketing: true, supports_transactional: true,
    monthly_free: 3000, best_for: 'transactional',
    from_email_hint: 'Dùng onboarding@resend.dev cho test; verify domain thật cho production.',
  },
  brevo: {
    id: 'brevo', label: 'Brevo', auth: 'api-key',
    docs_url: 'https://app.brevo.com/settings/keys/api',
    dashboard_url: 'https://app.brevo.com',
    supports_marketing: true, supports_transactional: true,
    monthly_free: 9000, best_for: 'marketing',
    from_email_hint: 'Email phải được verify trong Brevo → Senders & IP.',
  },
  mailgun: {
    id: 'mailgun', label: 'Mailgun', auth: 'api-key',
    docs_url: 'https://app.mailgun.com/settings/api_security',
    dashboard_url: 'https://app.mailgun.com',
    supports_marketing: true, supports_transactional: true,
    requires_domain: true, disabled: true,
  },
  sendgrid: {
    id: 'sendgrid', label: 'SendGrid', auth: 'api-key',
    docs_url: 'https://app.sendgrid.com/settings/api_keys',
    dashboard_url: 'https://app.sendgrid.com/email_activity',
    supports_marketing: true, supports_transactional: true, disabled: true,
  },
  ses: {
    id: 'ses', label: 'Amazon SES', auth: 'aws-sig',
    docs_url: 'https://console.aws.amazon.com/ses',
    dashboard_url: 'https://console.aws.amazon.com/ses',
    supports_marketing: true, supports_transactional: true,
    requires_region: true, disabled: true,
  },
  postmark: {
    id: 'postmark', label: 'Postmark', auth: 'api-key',
    docs_url: 'https://account.postmarkapp.com/servers',
    dashboard_url: 'https://account.postmarkapp.com/servers',
    supports_marketing: false, supports_transactional: true,
    best_for: 'transactional', disabled: true,
  },
  smtp: {
    id: 'smtp', label: 'SMTP tuỳ chỉnh', auth: 'smtp',
    docs_url: '',
    supports_marketing: true, supports_transactional: true, disabled: true,
  },
}

export function getEmailProviderConfig(id: string): EmailProviderConfig {
  const cfg = EMAIL_PROVIDERS[id]
  if (!cfg) throw new Error(`Unknown email provider: ${id}. Registered: ${Object.keys(EMAIL_PROVIDERS).join(', ')}`)
  return cfg
}

export function listEmailProviderIds(): string[] {
  return Object.keys(EMAIL_PROVIDERS)
}
