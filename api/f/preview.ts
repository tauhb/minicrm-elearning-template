// api/f/preview.ts — Render step HTML for admin preview (works with draft/unpublished funnels)
// GET /api/f/preview?funnel=<id-or-slug>&step=<slug>
// Requires admin auth (unlike /api/f/render which is public but only for published)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function notFoundHtml(msg: string): string {
  return `<!DOCTYPE html><meta charset=utf-8><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#fff;min-height:100vh"><h1>Preview error</h1><p>${msg}</p></body>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const url = new URL(req.url || '', 'http://localhost')
  const funnelKey = url.searchParams.get('funnel')
  const stepSlug = url.searchParams.get('step')
  if (!funnelKey) return res.status(400).send(notFoundHtml('funnel required'))

  // Admin auth (Bearer token required — modal fetches then srcDoc iframe)
  const authHeader = req.headers.authorization as string | undefined
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Bearer token required' })
  }

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(401).send(notFoundHtml('Token không hợp lệ'))
  }
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (!['owner','admin'].includes(caller?.role || '')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(403).send(notFoundHtml('Admin only'))
  }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Fetch flow by id OR slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(funnelKey)
  const { data: flow } = await admin.from('funnel_flows')
    .select('id, slug, status')
    [isUuid ? 'eq' : 'eq'](isUuid ? 'id' : 'slug', funnelKey)
    .maybeSingle()

  if (!flow) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Funnel không tồn tại'))
  }

  // Get target step (default: first)
  let step
  if (stepSlug) {
    const { data } = await admin.from('funnel_steps')
      .select('id, html, name, slug').eq('funnel_id', flow.id).eq('slug', stepSlug).maybeSingle()
    step = data
  } else {
    const { data } = await admin.from('funnel_steps')
      .select('id, html, name, slug').eq('funnel_id', flow.id).order('step_number').limit(1).maybeSingle()
    step = data
  }

  if (!step || !step.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Step chưa có HTML (draft copy → approve trước)'))
  }

  // Inject preview banner + click-to-next hint (no actual tracking, no form submit)
  const banner = `<div id="__preview_banner" style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#B6FF00;color:#000;padding:6px 12px;font-family:system-ui;font-size:12px;font-weight:600;text-align:center">
🔍 PREVIEW MODE — form submits sẽ không lưu · funnel status: ${flow.status}
</div><style>body{padding-top:32px}</style>`

  // Intercept forms to prevent actual submission — instead simulate go-to-next
  const interceptScript = `<script>
(function(){
  document.addEventListener('submit', function(e){
    e.preventDefault();
    var f = e.target.closest('form');
    if (f && f.action && f.action.indexOf('/api/f/submit') !== -1) {
      window.parent && window.parent.postMessage({ type: 'preview:form_submit', form_id: f.id || '' }, '*');
    }
  }, true);
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-cta]');
    if (el) {
      window.parent && window.parent.postMessage({ type: 'preview:cta_click', text: (el.innerText||'').slice(0,80) }, '*');
    }
  });
})();
</script>`

  let html = step.html
  html = html.includes('</body>') ? html.replace('</body>', `${interceptScript}\n</body>`) : html + interceptScript
  html = html.includes('<body') ? html.replace(/<body([^>]*)>/, `<body$1>${banner}`) : banner + html

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(html)
}

