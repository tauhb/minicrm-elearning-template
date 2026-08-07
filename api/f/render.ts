// api/f/render.ts — Public renderer for /f/:slug
// GET /api/f/render?slug=xxx → returns full HTML of published funnel

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { injectTrackingPixel } from '../../services/funnel-generator'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const url = new URL(req.url || '', 'http://localhost')
  const slug = url.searchParams.get('slug')
  if (!slug) return res.status(400).send('slug required')

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: funnel } = await admin.from('generated_funnels')
    .select('id, html, status, name')
    .eq('slug', slug)
    .maybeSingle()

  if (!funnel) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send('<!DOCTYPE html><meta charset=utf-8><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#fff"><h1>404</h1><p>Funnel không tìm thấy.</p></body>')
  }

  if (funnel.status !== 'published') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send('<!DOCTYPE html><meta charset=utf-8><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#fff"><h1>404</h1><p>Funnel này chưa được publish.</p></body>')
  }

  if (!funnel.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(500).send('<!DOCTYPE html><meta charset=utf-8><body>Funnel chưa có nội dung.</body>')
  }

  // Inject tracking
  const portalBase = process.env.CUSTOMER_PORTAL_URL || `${url.protocol}//${req.headers.host}`
  const html = injectTrackingPixel(funnel.html, funnel.id, portalBase)

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', 'index, follow')
  res.setHeader('Cache-Control', 'public, max-age=60')  // 1 min cache
  return res.status(200).send(html)
}
