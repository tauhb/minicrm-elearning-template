#!/usr/bin/env node
/**
 * generate-sounds.mjs — Generate SFX bằng ElevenLabs Sound Generation API
 *
 * Chạy: node scripts/generate-sounds.mjs
 *
 * Đọc ELEVENLABS_API_KEY từ root .env (../../.env) hoặc apps/customer-portal/.env.local
 * Sinh 8 SFX vào public/sounds/. Idempotent — file đã tồn tại sẽ skip.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname }       from 'path'
import { fileURLToPath }       from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_ENV  = join(__dirname, '..', '..', '..', '.env')
const LOCAL_ENV = join(__dirname, '..', '.env.local')
const OUT_DIR   = join(__dirname, '..', 'public', 'sounds')

// ── Đọc API key ──────────────────────────────────────────────────────────────
function loadKey() {
  for (const path of [ROOT_ENV, LOCAL_ENV]) {
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf8')
    const match = content.match(/ELEVENLABS_API_KEY=(.+)/)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return process.env.ELEVENLABS_API_KEY || null
}

const apiKey = loadKey()
if (!apiKey) {
  console.error('❌ Không tìm thấy ELEVENLABS_API_KEY trong .env (root) hoặc .env.local')
  process.exit(1)
}

// ── SFX library ──────────────────────────────────────────────────────────────
// ElevenLabs min duration = 0.5s
const SFX = [
  { file: 'hover.mp3',      prompt: 'very short subtle UI hover blip, soft tick',              duration: 0.5 },
  { file: 'click.mp3',      prompt: 'crisp sci-fi UI click, short mechanical engage',          duration: 0.5 },
  { file: 'task-check.mp3', prompt: 'soft confirmation beep, short success tone',              duration: 0.5 },
  { file: 'success.mp3',    prompt: 'short level up success chime, uplifting cinematic',       duration: 0.8 },
  { file: 'open.mp3',       prompt: 'sci-fi modal open whoosh, futuristic interface sound',    duration: 0.5 },
  { file: 'notify.mp3',     prompt: 'soft notification ping, gentle alert tone',               duration: 0.5 },
  { file: 'error.mp3',      prompt: 'low error buzz, negative feedback tone',                  duration: 0.5 },
  { file: 'scan.mp3',       prompt: 'quick radar scan sweep, sci-fi searching sound',          duration: 0.6 },
]

// ── Output dir ──────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

// ── Generate ─────────────────────────────────────────────────────────────────
console.log(`🎵 Generating ${SFX.length} SFX qua ElevenLabs Sound Generation...\n`)

let made = 0, skipped = 0, failed = 0

for (const sfx of SFX) {
  const out = join(OUT_DIR, sfx.file)
  if (existsSync(out)) {
    console.log(`  ⏭  ${sfx.file} đã tồn tại, skip`)
    skipped++
    continue
  }

  process.stdout.write(`  ⏳ ${sfx.file} (${sfx.prompt.slice(0, 40)}...) `)
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: sfx.prompt,
        duration_seconds: sfx.duration,
        prompt_influence: 0.3,
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.log(`❌ ${res.status}: ${errBody.slice(0, 100)}`)
      failed++
      continue
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    writeFileSync(out, buffer)
    console.log(`✅ ${(buffer.length/1024).toFixed(1)}KB`)
    made++
  } catch (e) {
    console.log(`❌ ${e.message}`)
    failed++
  }
}

console.log(`\n📦 Done: ${made} created, ${skipped} skipped, ${failed} failed`)
console.log(`📁 Output: ${OUT_DIR}`)
