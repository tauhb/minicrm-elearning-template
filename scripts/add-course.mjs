#!/usr/bin/env node
/**
 * add-course.mjs — Insert a new course + zones + quests via Supabase REST
 *
 * Usage:
 *   node scripts/add-course.mjs --from=course.json
 *   node scripts/add-course.mjs                       # Interactive (basic)
 *
 * course.json format:
 *   {
 *     "name": "AI Marketing 101",
 *     "slug": "ai-marketing-101",
 *     "description": "...",
 *     "layout_mode": "journey",
 *     "zones": [
 *       {
 *         "name": "Tuần 1",
 *         "quests": [
 *           {
 *             "name": "Bài 1",
 *             "day_number": 1,
 *             "xp_reward": 100,
 *             "tasks": ["Xem video intro", "Làm bài tập 1"],
 *             "videos": [{"url": "https://youtu.be/xxx", "title": "Intro"}],
 *             "resources": [{"url": "...", "title": "Worksheet", "type": "pdf"}]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const c = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', gray:'\x1b[90m' }
const pass = m => console.log(`  ${c.green}✓${c.reset} ${m}`)
const err  = m => console.log(`  ${c.red}✗${c.reset} ${m}`)
const info = m => console.log(`  ${c.cyan}→${c.reset} ${m}`)

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

async function sbPost(table, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${table} insert failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  })
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`)
  return res.json()
}

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const fromFlag = args.find(a => a.startsWith('--from='))

let course
if (fromFlag) {
  const path = fromFlag.slice(7)
  if (!existsSync(path)) { err(`File not found: ${path}`); process.exit(1) }
  try {
    course = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    err(`Invalid JSON: ${e.message}`); process.exit(1)
  }
} else {
  err('Interactive mode not yet implemented. Use --from=course.json')
  console.log(`\n  Example course.json:`)
  console.log(`  {`)
  console.log(`    "name": "AI Marketing 101",`)
  console.log(`    "slug": "ai-marketing-101",`)
  console.log(`    "layout_mode": "journey",`)
  console.log(`    "zones": [{ "name": "Tuần 1", "quests": [{"name":"Bài 1","day_number":1}] }]`)
  console.log(`  }\n`)
  process.exit(2)
}

// ── Validate ─────────────────────────────────────────────────────────────────
if (!course.name || !course.slug) { err('name and slug are required'); process.exit(1) }
if (!/^[a-z0-9-]+$/.test(course.slug)) { err('slug must be lowercase alphanumeric with hyphens'); process.exit(1) }
if (!Array.isArray(course.zones) || course.zones.length === 0) { err('zones array required'); process.exit(1) }

// Check slug not duplicate
console.log(`\n${c.bold}Adding course: ${course.name}${c.reset}\n`)
const existing = await sbGet(`/courses?slug=eq.${encodeURIComponent(course.slug)}&select=id`)
if (existing.length > 0) {
  err(`Slug "${course.slug}" already exists (course id: ${existing[0].id}). Use a different slug.`)
  process.exit(1)
}

// ── Insert course ────────────────────────────────────────────────────────────
let courseId
try {
  const [row] = await sbPost('courses', {
    name: course.name,
    slug: course.slug,
    description: course.description || '',
    layout_mode: course.layout_mode || 'journey'
  })
  courseId = row.id
  pass(`Course created: ${courseId}`)
} catch (e) {
  err(`Course insert failed: ${e.message}`); process.exit(1)
}

// ── Insert zones + quests ────────────────────────────────────────────────────
let totalZones = 0, totalQuests = 0, totalTasks = 0, totalVideos = 0, totalResources = 0

const cleanup = async () => {
  info(`Rolling back course ${courseId}...`)
  try {
    await fetch(`${SB_URL}/rest/v1/courses?id=eq.${courseId}`, {
      method: 'DELETE',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    })
    info('Rolled back.')
  } catch {}
}

try {
  for (let zi = 0; zi < course.zones.length; zi++) {
    const z = course.zones[zi]
    const [zone] = await sbPost('zones', {
      course_id: courseId,
      name: z.name,
      order_index: zi
    })
    totalZones++

    for (let qi = 0; qi < (z.quests || []).length; qi++) {
      const q = z.quests[qi]
      const [quest] = await sbPost('quests', {
        zone_id: zone.id,
        name: q.name,
        day_number: q.day_number ?? qi + 1,
        xp_reward: q.xp_reward ?? 100,
        order_index: qi,
        description: q.description || ''
      })
      totalQuests++

      // Tasks
      for (let ti = 0; ti < (q.tasks || []).length; ti++) {
        const t = q.tasks[ti]
        await sbPost('tasks', {
          quest_id: quest.id,
          text: typeof t === 'string' ? t : t.text,
          order_index: ti
        })
        totalTasks++
      }

      // Videos
      for (const v of (q.videos || [])) {
        await sbPost('videos', {
          quest_id: quest.id,
          url: v.url,
          title: v.title || ''
        })
        totalVideos++
      }

      // Resources
      for (const r of (q.resources || [])) {
        await sbPost('resources', {
          quest_id: quest.id,
          url: r.url,
          title: r.title || '',
          type: r.type || 'link'
        })
        totalResources++
      }
    }
  }
} catch (e) {
  err(`Insert failed midway: ${e.message}`)
  await cleanup()
  process.exit(1)
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log()
pass(`Course:    ${course.name} (${course.slug})`)
pass(`Zones:     ${totalZones}`)
pass(`Quests:    ${totalQuests}`)
pass(`Tasks:     ${totalTasks}`)
pass(`Videos:    ${totalVideos}`)
pass(`Resources: ${totalResources}`)
console.log()
info(`Course ID: ${c.cyan}${courseId}${c.reset}`)
if (env.CUSTOMER_PORTAL_URL) {
  info(`Admin view:   ${env.CUSTOMER_PORTAL_URL}/admin/courses/${courseId}`)
  info(`Student view: ${env.CUSTOMER_PORTAL_URL}/course/${course.slug}`)
}
console.log()
