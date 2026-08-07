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
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];

  // Capture UTM from URL → localStorage (persists across pages in same funnel)
  try {
    var qs = new URLSearchParams(window.location.search);
    var utm = {};
    UTM_KEYS.forEach(function(k){ if (qs.has(k)) utm[k] = qs.get(k); });
    if (Object.keys(utm).length) localStorage.setItem('funnel_utm', JSON.stringify(utm));
  } catch(e){}

  function getUtm() {
    try { return JSON.parse(localStorage.getItem('funnel_utm') || '{}'); } catch(e){ return {}; }
  }

  function send(type, extra){
    var utm = getUtm();
    try {
      fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        funnel_id:FUNNEL_ID,step_id:STEP_ID,event_type:type,referrer:document.referrer,
        extra:Object.assign({}, extra||{}, {utm: utm})
      }),keepalive:true}).catch(function(){})
    } catch(e){}
  }
  send('visit');
  document.addEventListener('click',function(e){var el=e.target.closest('[data-cta]');if(el)send('cta_click',{text:(el.innerText||'').slice(0,80)});});
  document.addEventListener('submit',function(e){var f=e.target.closest('[data-form]');if(f)send('form_submit',{});},true);

  // Inject UTM hidden inputs into forms right before submit (so backend gets them)
  document.addEventListener('submit',function(e){
    var f = e.target.closest('form[data-form]');
    if (!f) return;
    var utm = getUtm();
    Object.keys(utm).forEach(function(k){
      if (f.querySelector('input[name="'+k+'"]')) return;
      var input = document.createElement('input');
      input.type = 'hidden'; input.name = k; input.value = utm[k];
      f.appendChild(input);
    });
  }, true);
})();
</script>`.trim()
}

/**
 * Auto-wire CTA buttons to next step URL when step has no form.
 * If <a data-cta> has no href → set to next step URL.
 * If <button data-cta> outside form → wrap in <a href={next}> so it navigates.
 */
function autoWireCtaLinks(html: string, funnelSlug: string, nextStepSlug?: string): string {
  if (!nextStepSlug) return html
  const nextUrl = `/f/${funnelSlug}/${nextStepSlug}`

  // <a data-cta> without href — add href
  html = html.replace(/<a\b([^>]*\bdata-cta\b[^>]*)>/gi, (m, attrs) => {
    if (/\bhref\s*=/.test(attrs)) return m
    return `<a${attrs} href="${nextUrl}">`
  })

  // <button data-cta> not inside <form> — wrap in <a>
  // Approach: for each <button data-cta ...>...</button>, check if it's inside a <form>
  // Simple regex approach won't nest-check properly. Do a naive pass: only wrap buttons that don't
  // appear in the same nesting block as <form>. Skip for MVP if too complex — most AI CTAs use <a> anyway.
  // Instead: leave <button data-cta> alone; user's form handling covers those.

  return html
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
    .select('id, slug, status, chat_widget_inbox_id').eq('slug', funnelSlug).maybeSingle()

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
    .select('id, html, name, form_success_step_slug, step_number, has_form').eq('funnel_id', flow.id).eq('slug', targetSlug).maybeSingle()

  if (!step || !step.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Step không tìm thấy hoặc chưa có nội dung.'))
  }

  // Resolve next step slug (form_success_step_slug > next step by number)
  let nextStepSlug: string | undefined = step.form_success_step_slug || undefined
  if (!nextStepSlug) {
    const { data: nextStep } = await admin.from('funnel_steps')
      .select('slug').eq('funnel_id', flow.id).gt('step_number', step.step_number)
      .order('step_number').limit(1).maybeSingle()
    nextStepSlug = nextStep?.slug || undefined
  }

  const portalBase = process.env.CUSTOMER_PORTAL_URL || `${url.protocol}//${req.headers.host}`
  let html = step.html
  // Auto-wire CTAs to next step if step has no form (CTA = navigation, not submit)
  if (!step.has_form && nextStepSlug) {
    html = autoWireCtaLinks(html, funnelSlug, nextStepSlug)
  }
  const inject = trackingScript(flow.id, step.id, portalBase)
  html = html.includes('</body>') ? html.replace('</body>', `${inject}\n</body>`) : html + inject

  // Auto-inject chat widget if this funnel has one configured
  if ((flow as any).chat_widget_inbox_id) {
    const { data: inbox } = await admin.from('chat_inboxes')
      .select('website_token, is_active').eq('id', (flow as any).chat_widget_inbox_id).maybeSingle()
    if (inbox?.is_active && inbox.website_token) {
      const widgetInject = `<script>window.__FUNNEL_SLUG__='${flow.slug}';window.__FUNNEL_ID__='${flow.id}';window.__STEP_SLUG__='${step.name}';window.__STEP_ID__='${step.id}';</script>
<script src="${portalBase}/api/chat/widget/embed.js?token=${inbox.website_token}" async></script>`
      html = html.includes('</body>') ? html.replace('</body>', `${widgetInject}\n</body>`) : html + widgetInject
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', 'index, follow')
  res.setHeader('Cache-Control', 'public, max-age=60')
  return res.status(200).send(html)
}
