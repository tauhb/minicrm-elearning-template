/**
 * services/crypto.ts — AES-256-GCM encryption for storing OAuth tokens
 *
 * Encrypts before DB write, decrypts on read. Key from env:
 *   PROVIDER_ENCRYPTION_KEY = 32-byte hex string (64 hex chars)
 *
 * Generate a key: `openssl rand -hex 32`
 *
 * Output format: base64(iv || authTag || ciphertext)
 *   - iv: 12 bytes
 *   - authTag: 16 bytes
 *   - ciphertext: variable
 */

import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer {
  const hex = process.env.PROVIDER_ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      'PROVIDER_ENCRYPTION_KEY env var is required. Generate with: openssl rand -hex 32'
    )
  }
  if (hex.length !== 64) {
    throw new Error('PROVIDER_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const key = getKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decrypt(payload: string): string {
  if (!payload) return ''
  const key = getKey()
  const raw = Buffer.from(payload, 'base64')
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error('Encrypted payload too short')
  }
  const iv = raw.subarray(0, IV_LEN)
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = raw.subarray(IV_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/**
 * Safe decrypt — returns null if decryption fails (bad key, corrupted data).
 * Use in read paths where you want to fail gracefully rather than throw.
 */
export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null
  try {
    return decrypt(payload)
  } catch {
    return null
  }
}

/**
 * Best-effort decrypt with plaintext fallback.
 *
 * Migration friendly: when legacy rows (e.g. app_settings.brevo_api_key that
 * were stored plaintext) get inserted into a new *_encrypted column by a SQL
 * seed, this returns the raw payload so callers keep working. First re-save
 * via UI writes properly-encrypted ciphertext.
 *
 * Prefer tryDecrypt() in code paths that only ever handle values written by
 * encrypt() — this helper trades a bit of ambiguity for backward compat.
 */
export function tryDecryptOrRaw(payload: string | null | undefined): string | null {
  if (!payload) return null
  try {
    return decrypt(payload)
  } catch {
    return payload
  }
}
