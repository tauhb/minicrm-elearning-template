// api/f/render.ts — Public renderer for /f/:funnel_slug/:step_slug
// GET /api/f/render?funnel=<slug>&step=<slug>
// If step omitted, redirect to first step.
// Only serves if funnel_flows.status = 'published'.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function trackingScript(funnelId: string, stepId: string, portalBase: string): string {
  return `
<script>
(function(){
  var FUNNEL_ID='${funnelId}', STEP_ID='${stepId}', TRACK_URL='${portalBase}/api/f/track';
  function send(type, extra){
    try {
      fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({funnel_id:FUNNEL_ID,step_id:STEP_ID,event_type:type,referrer:document.referrer,extra:extra||{}}),keepalive:true}).catch(function(){})
    } catch(e){}
  }
  send('visit');
  document.addEventListener('click',function(e){var el=e.target.closest('[data-cta]');if(el)send('cta_click',{text:(el.innerText||'').slice(0,80)});});
  document.addEventListener('submit',function(e){var f=e.target.closest('[data-form]');if(f)send('form_submit',{});},true);
})();
</script>`.trim()
}

function notFoundHtml(msg: string): string {
  return `<!DOCTYPE html><meta charset=utf-8><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#fff;min-height:100vh"><h1>404</h1><p>${msg}</p></body>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const url = new URL(req.url || '', 'http://localhost')
  const funnelSlug = url.searchParams.get('funnel')
  const stepSlug = url.searchParams.get('step')
  if (!funnelSlug) return res.status(400).send('funnel required')

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: flow } = await admin.from('funnel_flows')
    .select('id, status').eq('slug', funnelSlug).maybeSingle()

  if (!flow) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Funnel không tìm thấy.'))
  }
  if (flow.status !== 'published') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Funnel chưa được publish.'))
  }

  // If no step slug → find first step by number
  let targetSlug = stepSlug
  if (!targetSlug) {
    const { data: first } = await admin.from('funnel_steps')
      .select('slug').eq('funnel_id', flow.id).order('step_number').limit(1).maybeSingle()
    if (!first) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(404).send(notFoundHtml('Funnel chưa có step nào.'))
    }
    targetSlug = first.slug
  }

  const { data: step } = await admin.from('funnel_steps')
    .select('id, html, name').eq('funnel_id', flow.id).eq('slug', targetSlug).maybeSingle()

  if (!step || !step.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Step không tìm thấy hoặc chưa có nội dung.'))
  }

  const portalBase = process.env.CUSTOMER_PORTAL_URL || `${url.protocol}//${req.headers.host}`
  let html = step.html
  const inject = trackingScript(flow.id, step.id, portalBase)
  html = html.includes('</body>') ? html.replace('</body>', `${inject}\n</body>`) : html + inject

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', 'index, follow')
  res.setHeader('Cache-Control', 'public, max-age=60')
  return res.status(200).send(html)
}
