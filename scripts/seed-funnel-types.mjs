#!/usr/bin/env node
/**
 * seed-funnel-types.mjs — Read funnel-skills/*.md → upsert into funnel_types table
 *
 * Compose:
 *   sales   = sales-skill + copywriting-overlay + landing-copy-overlay
 *   leads   = leads-skill + copywriting-overlay + landing-copy-overlay
 *
 * Usage: node scripts/seed-funnel-types.mjs
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SKILLS_DIR = join(ROOT, 'funnel-skills')

const c = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m' }
const ok = m => console.log(`${c.green}✓${c.reset} ${m}`)
const err = m => console.log(`${c.red}✗${c.reset} ${m}`)

// Load env
for (const f of ['.env', '.env.local']) {
  const p = join(ROOT, f)
  if (existsSync(p)) {
    readFileSync(p, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) { const v = m[2].replace(/^['"]|['"]$/g, '').trim(); if (v) process.env[m[1]] = v }
    })
  }
}

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { err('Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local'); process.exit(1) }

function loadSkill(name) {
  const p = join(SKILLS_DIR, name)
  if (!existsSync(p)) { err(`Missing skill: ${name}`); process.exit(1) }
  return readFileSync(p, 'utf8')
}

const copywritingOverlay = loadSkill('copywriting-overlay.md')
const landingCopyOverlay = loadSkill('landing-copy-overlay.md')
const salesSkill = loadSkill('sales-skill.md')
const leadsSkill = loadSkill('leads-skill.md')

const COMMON_APPENDIX = `

---

# === COPYWRITING OVERLAY (áp dụng cho mọi output) ===

${copywritingOverlay}

---

# === LANDING COPY OVERLAY ===

${landingCopyOverlay}

---

# === RUNTIME QUY TẮC HTML OUTPUT (bắt buộc) ===

Bạn đang generate HTML cho 1 STEP của funnel (không phải cả funnel).
- Output PHẢI là HTML hoàn chỉnh: <!DOCTYPE html> + <head> + <body>
- Tailwind CSS qua CDN: <script src="https://cdn.tailwindcss.com"></script> trong <head>
- Font: Google Fonts (theo font pair từ style instructions bên dưới)
- Self-contained, không dùng framework khác
- Copy TIẾNG VIỆT — KHÔNG dùng "anh/chị", chỉ dùng "bạn/tôi"
- CTA button PHẢI có class \`data-cta="1"\` để portal tracking
- Nếu step có form: form PHẢI có \`action="/api/f/submit" method="POST" data-form="1"\` và inject hidden inputs \`funnel_id\` + \`step_id\` (portal sẽ populate values)
- Responsive mobile-first
- KHÔNG output markdown code fence — chỉ HTML thuần
`

const SALES_TYPE = {
  key: 'sales',
  name: 'Sales Funnel',
  description: 'Bán khoá học/sản phẩm digital với sales page + order + upsell + thank-you',
  icon: 'zap',
  color: '#B6FF00',
  is_builtin: true,
  is_active: true,
  sort_order: 10,
  system_prompt: salesSkill + COMMON_APPENDIX,
  suggested_steps: [
    { step_number: 1, slug: 'landing',   name: 'Sales Page',   page_type: 'landing',   has_form: false, form_mode: 'none',   form_success_step_slug: 'order' },
    { step_number: 2, slug: 'order',     name: 'Order Form',   page_type: 'order',     has_form: true,  form_mode: 'inline', form_success_step_slug: 'upsell',
      form_fields: [
        { name: 'name',  label: 'Họ tên',       type: 'text',  required: true },
        { name: 'email', label: 'Email',        type: 'email', required: true },
        { name: 'phone', label: 'Số điện thoại',type: 'tel',   required: true },
      ] },
    { step_number: 3, slug: 'upsell',    name: 'Upsell',       page_type: 'upsell',    has_form: false, form_mode: 'none',   form_success_step_slug: 'thank-you' },
    { step_number: 4, slug: 'thank-you', name: 'Thank You',    page_type: 'thank-you', has_form: false, form_mode: 'none' },
  ],
}

const LEADS_TYPE = {
  key: 'leads',
  name: 'Leads Funnel',
  description: 'Thu lead bằng lead magnet (ebook, checklist, mini-course...)',
  icon: 'target',
  color: '#00D9FF',
  is_builtin: true,
  is_active: true,
  sort_order: 20,
  system_prompt: leadsSkill + COMMON_APPENDIX,
  suggested_steps: [
    { step_number: 1, slug: 'landing',   name: 'Landing với form',    page_type: 'opt-in',    has_form: true, form_mode: 'inline', form_success_step_slug: 'thank-you',
      form_fields: [
        { name: 'name',  label: 'Họ tên', type: 'text',  required: true },
        { name: 'email', label: 'Email',  type: 'email', required: true },
      ] },
    { step_number: 2, slug: 'thank-you', name: 'Thank you + Delivery', page_type: 'thank-you', has_form: false, form_mode: 'none' },
  ],
}

async function upsertType(type) {
  // Check if exists (by key)
  const getRes = await fetch(`${SB_URL}/rest/v1/funnel_types?key=eq.${encodeURIComponent(type.key)}&select=id`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  const existing = await getRes.json()

  const payload = {
    key: type.key, name: type.name, description: type.description,
    icon: type.icon, color: type.color,
    system_prompt: type.system_prompt,
    suggested_steps: type.suggested_steps,
    is_builtin: type.is_builtin, is_active: type.is_active, sort_order: type.sort_order,
    updated_at: new Date().toISOString(),
  }

  if (existing.length > 0) {
    const patchRes = await fetch(`${SB_URL}/rest/v1/funnel_types?key=eq.${encodeURIComponent(type.key)}`, {
      method: 'PATCH',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    })
    if (!patchRes.ok) throw new Error(`PATCH ${type.key}: ${await patchRes.text()}`)
    ok(`Updated: ${type.key} (${type.system_prompt.length} chars, ${type.suggested_steps.length} steps)`)
  } else {
    const postRes = await fetch(`${SB_URL}/rest/v1/funnel_types`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    })
    if (!postRes.ok) throw new Error(`POST ${type.key}: ${await postRes.text()}`)
    ok(`Inserted: ${type.key} (${type.system_prompt.length} chars, ${type.suggested_steps.length} steps)`)
  }
}

console.log(`\n${c.bold}${c.cyan}Seeding funnel_types from ${SKILLS_DIR}${c.reset}\n`)

try {
  await upsertType(SALES_TYPE)
  await upsertType(LEADS_TYPE)
  console.log(`\n${c.green}✓ Done.${c.reset} Users can edit via Settings → Funnel Types.\n`)
} catch (e) {
  err(`Seed failed: ${e.message}`)
  process.exit(1)
}
