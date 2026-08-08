/**
 * services/email-adapters/resend.ts — Resend adapter.
 *
 * All adapters implement the same shape:
 *   send(connection, message)     → Promise<{ok:true, id?} | {ok:false, error}>
 *   verify(connection)            → Promise<{ok:true} | {ok:false, error}>  (optional)
 */

import { Resend } from 'resend'

export interface AdapterConnection {
  api_key: string
  from_email: string
  from_name?: string
  extra?: Record<string, any>
}

export interface AdapterMessage {
  to: string[]
  subject: string
  html: string
  replyTo?: string
}

export interface AdapterSendResult {
  ok: boolean
  id?: string
  error?: string
}

function fromLine(c: AdapterConnection): string {
  const name = c.from_name?.trim()
  return name ? `${name} <${c.from_email}>` : c.from_email
}

export async function send(
  connection: AdapterConnection,
  message: AdapterMessage,
): Promise<AdapterSendResult> {
  if (!connection.api_key) return { ok: false, error: 'Resend: missing api_key' }
  if (!message.to.length)  return { ok: false, error: 'Resend: no recipients' }
  try {
    const client = new Resend(connection.api_key)
    const res = await client.emails.send({
      from: fromLine(connection),
      to: message.to,
      subject: message.subject,
      html: message.html,
      replyTo: message.replyTo,
    })
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true, id: res.data?.id }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Verify credentials without sending mail. Resend exposes /domains — a 200
 * proves the key is valid (may return zero domains for unverified accounts).
 */
export async function verify(connection: AdapterConnection): Promise<AdapterSendResult> {
  if (!connection.api_key) return { ok: false, error: 'Resend: missing api_key' }
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${connection.api_key}` },
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
