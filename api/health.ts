// api/health.ts — Smoke test endpoint for /portal health command

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const checks: Record<string, string> = {}
  let allOk = true

  // Env vars presence
  checks.supabase_url = process.env.VITE_SUPABASE_URL ? 'set' : 'missing'
  checks.supabase_anon = process.env.VITE_SUPABASE_ANON_KEY ? 'set' : 'missing'
  checks.supabase_service = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'missing'
  checks.resend = process.env.RESEND_API_KEY ? 'set' : 'unset'

  // Supabase ping
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    try {
      const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
      const { error } = await db.from('app_settings').select('key').limit(1)
      checks.db = error ? `error: ${error.message}` : 'ok'
      if (error) allOk = false
    } catch (e: any) {
      checks.db = `exception: ${e.message}`
      allOk = false
    }
  } else {
    checks.db = 'skipped (env missing)'
    allOk = false
  }

  return res.status(200).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    checks,
  })
}
