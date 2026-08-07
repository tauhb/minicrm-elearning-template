/**
 * services/sepay.ts — SePay VietQR integration helpers.
 *
 * Flow:
 *   1. On order form submit → build reference code + amount → create funnel_orders row
 *   2. Generate VietQR URL (vietqr.app/img) with bank + acc + amount + des
 *   3. Show QR to customer → they scan + pay
 *   4. SePay's webhook fires → verify secret → match reference → mark paid
 */

import crypto from 'crypto'

export interface PaymentConfig {
  provider?: 'sepay'
  bank_name?: string         // e.g. 'Vietcombank' (used as ?bank= for vietqr.app)
  bank_bin?: string          // optional
  account_number?: string
  account_holder?: string
  qr_template?: 'compact' | 'qronly'
  amount_mode?: 'fixed' | 'from_form'
  fixed_amount?: number
  amount_form_field?: string
  webhook_secret_encrypted?: string
  order_prefix?: string
}

/** Build VietQR image URL — SePay uses vietqr.app service. */
export function buildQrUrl(cfg: PaymentConfig, amount: number, referenceCode: string): string {
  const params = new URLSearchParams()
  if (cfg.bank_name) params.set('bank', cfg.bank_name)
  if (cfg.account_number) params.set('acc', cfg.account_number)
  if (amount > 0) params.set('amount', String(amount))
  if (referenceCode) params.set('des', referenceCode)
  params.set('template', cfg.qr_template || 'compact')
  return `https://qr.sepay.vn/img?${params.toString()}`
}

/** Generate short unique reference code: "FN-abc1234" */
export function generateReferenceCode(prefix?: string): string {
  const p = (prefix || 'FN').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'FN'
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `${p}${rand}`
}

/** Extract amount from form data (either fixed or from a form field). */
export function resolveAmount(cfg: PaymentConfig, formData: Record<string, any>): number {
  if (cfg.amount_mode === 'from_form' && cfg.amount_form_field) {
    const raw = formData[cfg.amount_form_field]
    const n = typeof raw === 'string' ? parseInt(raw.replace(/[^\d]/g, ''), 10) : Number(raw)
    return isNaN(n) ? 0 : n
  }
  return Math.max(0, Number(cfg.fixed_amount) || 0)
}

/**
 * Verify SePay webhook — SePay sends Authorization: Apikey <secret> header.
 * Compare with decrypted webhook_secret from config.
 */
export function verifyWebhookAuth(headerAuth: string | undefined, expectedSecret: string): boolean {
  if (!expectedSecret) return false
  if (!headerAuth) return false
  // SePay format: "Apikey <secret>" — case-insensitive match
  const m = headerAuth.match(/^Apikey\s+(.+)$/i)
  const provided = m ? m[1].trim() : headerAuth.trim()
  return provided === expectedSecret
}

/**
 * Extract reference code from SePay webhook content.
 * Content example: "AIKITSTORE FN12A3B4C5 Chuyen tien"
 * Look for our prefix pattern in content.
 */
export function extractReferenceFromContent(content: string, orderPrefix?: string): string | null {
  const p = (orderPrefix || 'FN').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const re = new RegExp(`${p}[A-Z0-9]{6,12}`, 'i')
  const m = content?.match(re)
  return m ? m[0].toUpperCase() : null
}
