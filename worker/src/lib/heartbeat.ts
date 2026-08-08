import os from 'node:os'
import { db } from './supabase.js'
import { createLogger } from './logger.js'

const log = createLogger('heartbeat')

export function startHeartbeat(channels: string[]) {
  const id = process.env.WORKER_ID || os.hostname()
  const interval = Number(process.env.HEARTBEAT_INTERVAL_MS || 15_000)

  const beat = async () => {
    try {
      await db().from('worker_heartbeats').upsert({
        id,
        hostname: os.hostname(),
        version: process.env.npm_package_version || '0.1.0',
        channels,
        last_beat_at: new Date().toISOString(),
        metadata: { pid: process.pid, uptime_s: Math.round(process.uptime()) },
      })
    } catch (e: any) {
      log.warn('heartbeat failed', e.message)
    }
  }

  void beat()
  const handle = setInterval(beat, interval)
  return () => clearInterval(handle)
}
