// HTTP helper — talks to AgentCRM using AGENTCRM_URL + AGENTCRM_TOKEN.
// Handles auth header, retries on 5xx (up to 2), and shapes errors so
// scope failures come back as clear text the AI can act on.

export interface CallOptions {
  url: string           // AGENTCRM_URL base — e.g. https://portal.foo.com
  token: string         // raw acrm_... token
  timeoutMs?: number    // default 15_000
  retries?: number      // default 2 for GET, 0 for mutating verbs
}

export class CRMError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'CRMError'
    this.status = status
    this.body = body
  }
}

export function makeClient(opts: CallOptions) {
  const base = opts.url.replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? 15_000

  async function request(method: string, path: string, body?: unknown): Promise<any> {
    const url = base + (path.startsWith('/') ? path : `/${path}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const retriesAllowed = method === 'GET' ? (opts.retries ?? 2) : 0
    let lastErr: unknown

    for (let attempt = 0; attempt <= retriesAllowed; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${opts.token}`,
            'Content-Type': 'application/json',
            'User-Agent': '@rainmaker/agentcrm-mcp',
            'Accept': 'application/json',
          },
          body: body != null ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })
        clearTimeout(timer)

        const text = await res.text()
        let json: any
        try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }

        if (!res.ok) {
          if (res.status === 401) {
            throw new CRMError(401, 'Token invalid or revoked — check AGENTCRM_TOKEN or create a new one in Settings → API Tokens', json)
          }
          if (res.status === 403) {
            throw new CRMError(403, `Missing scope for ${method} ${path}. Grant the required scope in Settings → API Tokens.`, json)
          }
          if (res.status >= 500 && attempt < retriesAllowed) {
            lastErr = new CRMError(res.status, `${method} ${path} failed: ${res.status}`, json)
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
            continue
          }
          throw new CRMError(res.status, json?.error || `${method} ${path} failed: ${res.status}`, json)
        }
        return json
      } catch (err) {
        if (err instanceof CRMError) throw err
        if (attempt < retriesAllowed) { lastErr = err; continue }
        throw err
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastErr
  }

  return {
    get:    (path: string) => request('GET', path),
    post:   (path: string, body?: unknown) => request('POST', path, body),
    patch:  (path: string, body?: unknown) => request('PATCH', path, body),
    del:    (path: string) => request('DELETE', path),
  }
}

export function q(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}
