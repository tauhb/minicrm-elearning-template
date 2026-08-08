// Copy of apps/customer-portal-giftbox/services/crypto.ts — kept in-worker
// so the worker doesn't reach outside its own directory. Any change in the
// portal's crypto helper must be mirrored here.
import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer {
  const hex = process.env.PROVIDER_ENCRYPTION_KEY
  if (!hex) throw new Error('PROVIDER_ENCRYPTION_KEY is required (64 hex chars).')
  if (hex.length !== 64) throw new Error('PROVIDER_ENCRYPTION_KEY must be 64 hex chars.')
  return Buffer.from(hex, 'hex')
}

export function decrypt(payload: string): string {
  if (!payload) return ''
  const key = getKey()
  const raw = Buffer.from(payload, 'base64')
  if (raw.length < IV_LEN + TAG_LEN) throw new Error('encrypted payload too short')
  const iv = raw.subarray(0, IV_LEN)
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = raw.subarray(IV_LEN + TAG_LEN)
  const dec = crypto.createDecipheriv(ALGO, key, iv)
  dec.setAuthTag(tag)
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8')
}

export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null
  try { return decrypt(payload) } catch { return null }
}
