const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof levels

const min = (process.env.LOG_LEVEL as Level) || 'info'

export function createLogger(scope: string) {
  const emit = (level: Level, msg: string, extra?: unknown) => {
    if (levels[level] < levels[min]) return
    const ts = new Date().toISOString()
    const suffix = extra !== undefined ? ' ' + JSON.stringify(extra) : ''
    console.log(`[${ts}] ${level.toUpperCase()} ${scope}: ${msg}${suffix}`)
  }
  return {
    debug: (m: string, x?: unknown) => emit('debug', m, x),
    info:  (m: string, x?: unknown) => emit('info',  m, x),
    warn:  (m: string, x?: unknown) => emit('warn',  m, x),
    error: (m: string, x?: unknown) => emit('error', m, x),
  }
}
