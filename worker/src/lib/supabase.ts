import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (cached) return cached
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('worker: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  })
  return cached
}
