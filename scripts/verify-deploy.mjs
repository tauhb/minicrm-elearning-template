#!/usr/bin/env node
/**
 * verify-deploy.mjs — Smoke test cho portal đã deploy
 *
 * Usage:
 *   node scripts/verify-deploy.mjs                        # Uses CUSTOMER_PORTAL_URL from .env.local
 *   node scripts/verify-deploy.mjs https://my.vercel.app
 *   node scripts/verify-deploy.mjs https://my.vercel.app --verbose
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 *   2 = usage error (missing URL)
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
}
const pass = (m) => console.log(`  ${c.green}✓${c.reset} ${m}`)
const fail = (m) => console.log(`  ${c.red}✗${c.reset} ${m}`)
const warn = (m) => console.log(`  ${c.yellow}⚠${c.reset} ${m}`)
const dim  = (m) => console.log(`    ${c.gray}${m}${c.reset}`)

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const urlArg = args.find(a => a.startsWith('http'))

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const envFile = join(ROOT, '.env.local')
  if (!existsSync(envFile)) return {}
  return Object.fromEntries(
    readFileSync(envFile, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}
const env = loadEnv()

// ── Determine URL ────────────────────────────────────────────────────────────
const portalUrl = urlArg || env.CUSTOMER_PORTAL_URL
if (!portalUrl) {
  console.error(`\n${c.red}✗${c.reset} Missing portal URL.`)
  console.error(`  Pass as arg: node scripts/verify-deploy.mjs https://your.vercel.app`)
  console.error(`  Or set CUSTOMER_PORTAL_URL in .env.local\n`)
  process.exit(2)
}

const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseAnon = env.VITE_SUPABASE_ANON_KEY

console.log(`\n${c.bold}${c.cyan}🩺 Portal Health Check${c.reset} — ${portalUrl}\n`)

// ── Fetch helper with timeout ────────────────────────────────────────────────
async function tryFetch(url, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text, headers: res.headers }
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

// ── Checks ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0

async function check(name, fn) {
  try {
    const result = await fn()
    if (result.ok) {
      pass(`${name}${result.detail ? ` — ${result.detail}` : ''}`)
      if (verbose && result.debug) dim(result.debug)
      passed++
    } else {
      fail(`${name} — ${result.reason || 'unknown'}`)
      if (result.hint) dim(`Hint: ${result.hint}`)
      failed++
    }
  } catch (e) {
    fail(`${name} — exception: ${e.message}`)
    failed++
  }
}

// 1. Portal HTML loads
await check('Portal HTML loads', async () => {
  const r = await tryFetch(portalUrl)
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status || r.error}`, hint: 'Check deploy status: vercel ls / railway status' }
  const titleMatch = r.text.match(/<title>([^<]+)<\/title>/)
  return { ok: true, detail: `HTTP 200${titleMatch ? `, title: "${titleMatch[1]}"` : ''}` }
})

// 2. Login page renders
await check('Login page renders', async () => {
  const r = await tryFetch(`${portalUrl}/login`)
  if (!r.ok && r.status !== 200) return { ok: false, reason: `HTTP ${r.status || r.error}` }
  return { ok: true, detail: `HTTP ${r.status}` }
})

// 3. Supabase reachable
if (supabaseUrl && supabaseAnon) {
  await check('Supabase reachable', async () => {
    const r = await tryFetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: supabaseAnon }
    })
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, hint: 'Verify VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY' }
    return { ok: true, detail: `HTTP ${r.status}` }
  })

  // 4. App settings loadable
  await check('App settings loadable', async () => {
    const r = await tryFetch(`${supabaseUrl}/rest/v1/app_settings?select=key,value&limit=5`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${supabaseAnon}` }
    })
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, hint: 'RLS policy có thể chưa cho phép anon đọc app_settings' }
    try {
      const rows = JSON.parse(r.text)
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ok: false, reason: 'app_settings table empty', hint: 'Chạy: npm run setup:db && npm run seed' }
      }
      const titleRow = rows.find(x => x.key === 'title')
      return { ok: true, detail: titleRow ? `title: "${titleRow.value?.value || titleRow.value}"` : `${rows.length} settings loaded` }
    } catch {
      return { ok: false, reason: 'Invalid JSON response' }
    }
  })

  // 5. Zones seeded
  await check('Course zones seeded', async () => {
    const r = await tryFetch(`${supabaseUrl}/rest/v1/zones?select=id&limit=1`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${supabaseAnon}` }
    })
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` }
    try {
      const rows = JSON.parse(r.text)
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ok: false, reason: 'No zones', hint: 'Chạy: npm run seed' }
      }
      return { ok: true, detail: `${rows.length}+ zone(s) present` }
    } catch {
      return { ok: false, reason: 'Invalid JSON' }
    }
  })
} else {
  warn('Skipped Supabase checks — VITE_SUPABASE_URL/ANON_KEY missing in .env.local')
}

// 6. API /health endpoint
await check('API /health endpoint', async () => {
  const r = await tryFetch(`${portalUrl}/api/health`)
  if (r.status === 404) return { ok: false, reason: 'Not found (create api/health.ts)', hint: 'Nếu chưa có endpoint này, deploy portal version cũ hơn — skip nếu không critical' }
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` }
  try {
    const body = JSON.parse(r.text)
    return { ok: body.status === 'ok', detail: `status: ${body.status}${body.version ? `, version: ${body.version}` : ''}` }
  } catch {
    return { ok: false, reason: 'Invalid JSON' }
  }
})

// 7. Admin endpoint responds (not 500)
await check('Admin endpoint sane', async () => {
  const r = await tryFetch(`${portalUrl}/api/admin-create-customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  if (r.status >= 500) return { ok: false, reason: `HTTP ${r.status}`, hint: 'Check server logs: vercel logs / railway logs' }
  // 400/401/405 are all acceptable — means endpoint is alive and responding
  return { ok: true, detail: `responds with ${r.status} (expected 4xx)` }
})

// ── Summary ──────────────────────────────────────────────────────────────────
console.log()
const total = passed + failed
const emoji = failed === 0 ? '🎉' : '⚠️ '
console.log(`  ${c.bold}Overall: ${emoji} ${passed}/${total} PASSED${c.reset}`)
if (failed === 0) {
  console.log(`  ${c.green}Portal ready to use.${c.reset}\n`)
} else {
  console.log(`  ${c.yellow}Some checks failed. Review hints above.${c.reset}\n`)
}

process.exit(failed === 0 ? 0 : 1)
