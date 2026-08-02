#!/usr/bin/env node
/**
 * rebrand.mjs — Update app_settings (title, primaryColor, logoUrl, theme, ...)
 *
 * Usage:
 *   node scripts/rebrand.mjs                                    # Interactive
 *   node scripts/rebrand.mjs --name="My Academy" --color="#00D9FF" --theme=aurora
 *   node scripts/rebrand.mjs --set title="X" --set theme=zen    # Bulk set
 *
 * Requires .env.local with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const c = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', yellow:'\x1b[33m', gray:'\x1b[90m' }
const pass = m => console.log(`  ${c.green}✓${c.reset} ${m}`)
const err  = m => console.log(`  ${c.red}✗${c.reset} ${m}`)
const info = m => console.log(`  ${c.cyan}→${c.reset} ${m}`)

const VALID_THEMES = ['cyberpunk', 'aurora', 'synthwave', 'minimal', 'zen']
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/

// ── Env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const f = join(ROOT, '.env.local')
  if (!existsSync(f)) return {}
  return Object.fromEntries(
    readFileSync(f, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}
const env = loadEnv()
const SB_URL = env.VITE_SUPABASE_URL
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SB_URL || !SB_KEY) {
  err('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flags = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--set') {
    const [k, ...v] = (args[++i] || '').split('=')
    if (k && v.length) flags[k.trim()] = v.join('=').trim()
  } else if (a.startsWith('--name=')) flags.title = a.slice(7)
  else if (a.startsWith('--color=')) flags.primaryColor = a.slice(8)
  else if (a.startsWith('--logo=')) flags.logoUrl = a.slice(7)
  else if (a.startsWith('--theme=')) flags.theme = a.slice(8)
  else if (a.startsWith('--desc=')) flags.description = a.slice(7)
}

// ── Supabase REST ────────────────────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {})
    }
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function getSetting(key) {
  const rows = await sbFetch(`/app_settings?key=eq.${encodeURIComponent(key)}&select=value`)
  return rows[0]?.value?.value ?? rows[0]?.value ?? null
}

async function setSetting(key, value) {
  // Upsert: try update first, if 0 rows, insert
  const existing = await sbFetch(`/app_settings?key=eq.${encodeURIComponent(key)}&select=id`)
  const payload = { value: { value } }
  if (existing.length > 0) {
    await sbFetch(`/app_settings?key=eq.${encodeURIComponent(key)}`, {
      method: 'PATCH', body: JSON.stringify(payload)
    })
  } else {
    await sbFetch(`/app_settings`, {
      method: 'POST', body: JSON.stringify({ key, ...payload })
    })
  }
}

// ── Interactive prompt ───────────────────────────────────────────────────────
async function prompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q, def = '') => new Promise(r => rl.question(`  ${c.cyan}?${c.reset} ${q}${def ? ` ${c.gray}(${def})${c.reset}` : ''}: `, a => r(a.trim() || def)))

  console.log(`\n${c.bold}Current settings:${c.reset}`)
  const current = {}
  for (const key of ['title', 'primaryColor', 'logoUrl', 'theme', 'description']) {
    current[key] = await getSetting(key)
    console.log(`  ${c.gray}${key}:${c.reset} ${current[key] || c.gray + '(unset)' + c.reset}`)
  }
  console.log()

  console.log(`Nhấn Enter để giữ nguyên, hoặc nhập giá trị mới:\n`)
  const updates = {}
  const newTitle = await ask('App title', current.title || '')
  if (newTitle && newTitle !== current.title) updates.title = newTitle

  const newColor = await ask('Primary color (#hex)', current.primaryColor || '#B6FF00')
  if (newColor && newColor !== current.primaryColor) {
    if (!HEX_COLOR_RE.test(newColor)) { err(`Invalid hex: ${newColor}`); rl.close(); process.exit(1) }
    updates.primaryColor = newColor
  }

  const newLogo = await ask('Logo URL (bỏ trống nếu dùng text)', current.logoUrl || '')
  if (newLogo !== current.logoUrl) updates.logoUrl = newLogo

  const newTheme = await ask(`Theme (${VALID_THEMES.join('|')})`, current.theme || 'cyberpunk')
  if (newTheme && newTheme !== current.theme) {
    if (!VALID_THEMES.includes(newTheme)) { err(`Invalid theme: ${newTheme}`); rl.close(); process.exit(1) }
    updates.theme = newTheme
  }

  rl.close()
  return updates
}

// ── Main ─────────────────────────────────────────────────────────────────────
const updates = Object.keys(flags).length > 0 ? flags : await prompt()

if (Object.keys(updates).length === 0) {
  info('Không có thay đổi. Exit.')
  process.exit(0)
}

// Validate
if (updates.primaryColor && !HEX_COLOR_RE.test(updates.primaryColor)) {
  err(`Invalid primaryColor: ${updates.primaryColor} (must match #RRGGBB)`)
  process.exit(1)
}
if (updates.theme && !VALID_THEMES.includes(updates.theme)) {
  err(`Invalid theme: ${updates.theme} (must be one of ${VALID_THEMES.join(', ')})`)
  process.exit(1)
}

console.log(`\n${c.bold}Applying updates:${c.reset}`)
for (const [key, value] of Object.entries(updates)) {
  try {
    await setSetting(key, value)
    pass(`${key} → ${value || '(cleared)'}`)
  } catch (e) {
    err(`${key}: ${e.message}`)
    process.exit(1)
  }
}

console.log(`\n${c.green}✓ Rebrand applied.${c.reset} Reload portal to see changes (no redeploy needed).`)
if (env.CUSTOMER_PORTAL_URL) console.log(`  Portal URL: ${c.cyan}${env.CUSTOMER_PORTAL_URL}${c.reset}`)
console.log()
