/**
 * services/email-adapters/brevo.ts — Brevo (Sendinblue) transactional adapter.
 *
 * Uses /v3/smtp/email for actual sends (works for both marketing and
 * transactional in Brevo's model) and /v3/account for connection verification.
 */

import type { AdapterConnection, AdapterMessage, AdapterSendResult } from './resend'

export async function send(
  connection: AdapterConnection,
  message: AdapterMessage,
): Promise<AdapterSendResult> {
  if (!connection.api_key) return { ok: false, error: 'Brevo: missing api_key' }
  if (!message.to.length)  return { ok: false, error: 'Brevo: no recipients' }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
        'api-key': connection.api_key,
      },
      body: JSON.stringify({
        sender: {
          name: connection.from_name || undefined,
          email: connection.from_email,
        },
        to: message.to.map(e => ({ email: e })),
        subject: message.subject,
        htmlContent: message.html,
        replyTo: message.replyTo ? { email: message.replyTo } : undefined,
      }),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` }
    return { ok: true, id: data?.messageId }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Verify by pulling account info — cheap, no side effects. */
export async function verify(connection: AdapterConnection): Promise<AdapterSendResult> {
  if (!connection.api_key) return { ok: false, error: 'Brevo: missing api_key' }
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': connection.api_key, 'accept': 'application/json' },
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status} ${txt.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
