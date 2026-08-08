#!/usr/bin/env node
/**
 * regenerate-seed-migration.mjs — Rewrite migration 025 from live DB data.
 *
 * Use when you edit scripts/seed-funnel-types.mjs or seed-copy-formulas.mjs
 * (or manually edit types/formulas in Settings and want to bake into baseline).
 *
 *   node scripts/seed-funnel-types.mjs
 *   node scripts/seed-copy-formulas.mjs
 *   node scripts/regenerate-seed-migration.mjs
 *
 * Uses dollar-quoted string literals ($SEED$...$SEED$) so markdown content with
 * newlines / quotes / backslashes needs no escaping. COPY doesn't work through
 * Supabase's migration runner (protocol sync issue), which is why we use INSERT.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

for (const f of ['.env', '.env.local']) {
  try {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    })
  } catch {}
}

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function dqString(s) {
  let tag = 'SEED'
  while (s.includes('$' + tag + '$')) tag += 'X'
  return '$' + tag + '$' + s + '$' + tag + '$'
}
function dq(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  if (typeof val === 'number') return String(val)
  if (Array.isArray(val)) {
    if (val.length === 0) return "'{}'"
    const allStrings = val.every(v => typeof v === 'string')
    if (allStrings) {
      // text[] — SQL array literal
      return 'ARRAY[' + val.map(v => dqString(v)).join(',') + ']'
    }
    // Array of objects / mixed → JSONB array (Postgres jsonb column stores JSON directly)
    return dqString(JSON.stringify(val)) + '::jsonb'
  }
  if (typeof val === 'object') {
    // Plain object → jsonb
    return dqString(JSON.stringify(val)) + '::jsonb'
  }
  return dqString(String(val))
}

const ft = (await admin.from('funnel_types').select('*').order('sort_order')).data
const cf = (await admin.from('copy_formulas').select('*').order('sort_order')).data

const ftCols = Object.keys(ft[0])
const cfCols = Object.keys(cf[0])

const lines = [
  '-- 025_seed_funnel_types_and_copy_formulas.sql',
  '-- Baseline CRM data. Regenerate: node scripts/regenerate-seed-migration.mjs',
  '-- Idempotent via ON CONFLICT (key) DO NOTHING.',
  '',
  '-- funnel_types (' + ft.length + ' rows)',
  ...ft.map(r => `INSERT INTO funnel_types (${ftCols.join(', ')}) VALUES (${ftCols.map(c => dq(r[c])).join(', ')}) ON CONFLICT (key) DO NOTHING;`),
  '',
  '-- copy_formulas (' + cf.length + ' rows)',
  ...cf.map(r => `INSERT INTO copy_formulas (${cfCols.join(', ')}) VALUES (${cfCols.map(c => dq(r[c])).join(', ')}) ON CONFLICT (key) DO NOTHING;`),
  '',
]

const dbPath = join(ROOT, 'database/migrations/025_seed_funnel_types_and_copy_formulas.sql')
const supaPath = join(ROOT, 'supabase/migrations/20260808060000_seed_funnel_types_and_copy_formulas.sql')
writeFileSync(dbPath, lines.join('\n'))
writeFileSync(supaPath, lines.join('\n'))
console.log(`✓ Wrote ${ft.length} funnel_types + ${cf.length} copy_formulas to both migration paths`)
