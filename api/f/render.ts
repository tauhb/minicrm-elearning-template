// api/f/render.ts — Public renderer for /f/:funnel_slug/:step_slug
// GET /api/f/render?funnel=<slug>&step=<slug>
// If step omitted, redirect to first step.
// Only serves if funnel_flows.status = 'published'.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { parse as parseHtml } from 'node-html-parser'

/**
 * Guarantee funnel navigation works regardless of what AI generated:
 *   - Every <form>: force action="/api/f/submit", method="POST", data-form="1",
 *     and hidden inputs funnel_id + step_id (add or overwrite value if present).
 *   - Every <a data-cta> without href → href = next step URL (skip when no next step).
 *   - <button data-cta> outside a form → wire via delegated JS (injected below).
 */
function wireFunnelNavigation(
  html: string,
  funnelId: string,
  stepId: string,
  funnelSlug: string,
  nextStepSlug?: string,
): string {
  const root = parseHtml(html, { comment: true, blockTextElements: { script: true, style: true, pre: true } })
  const nextUrl = nextStepSlug ? `/f/${funnelSlug}/${nextStepSlug}` : ''

  // ── Forms
  const forms = root.querySelectorAll('form')
  for (const form of forms) {
    form.setAttribute('action', '/api/f/submit')
    form.setAttribute('method', 'POST')
    if (!form.hasAttribute('data-form')) form.setAttribute('data-form', '1')

    const setHidden = (name: string, value: string) => {
      const existing = form.querySelector(`input[name="${name}"]`)
      if (existing) {
        existing.setAttribute('value', value)
        existing.setAttribute('type', 'hidden')
      } else {
        // Prepend so hidden fields don't get lost after visible inputs
        form.insertAdjacentHTML('afterbegin', `<input type="hidden" name="${name}" value="${value}">`)
      }
    }
    setHidden('funnel_id', funnelId)
    setHidden('step_id', stepId)
  }

  // ── <a data-cta>: overwrite unless href is real navigation (absolute URL or /path).
  // Fragments ('#', '#foo'), empty, or relative → replace with next step URL.
  // AI often emits href="#order" intending in-page scroll, which does nothing when the
  // target id doesn't exist — CTAs must always advance the funnel.
  if (nextUrl) {
    for (const a of root.querySelectorAll('a[data-cta]')) {
      const href = (a.getAttribute('href') || '').trim()
      const isRealNav = /^(https?:|mailto:|tel:|\/)/i.test(href)
      if (!isRealNav) a.setAttribute('href', nextUrl)
    }
  }

  return root.toString()
}

/**
 * Client-side helper: wire <button data-cta> outside a form to nextUrl,
 * and ensure forms submit even if browser autofill stripped hidden values.
 */
function navigationScript(nextUrl: string): string {
  if (!nextUrl) return ''
  return `
<script>
(function(){
  var NEXT = ${JSON.stringify(nextUrl)};
  document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest && e.target.closest('button[data-cta]');
    if (!btn) return;
    if (btn.closest('form')) return;                   // submit button → let form handle
    if (btn.getAttribute('type') === 'submit') return; // extra safety
    e.preventDefault();
    window.location.href = NEXT;
  }, false);
})();
</script>`.trim()
}

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
  // Guarantee navigation regardless of what AI generated (forms + CTAs)
  html = wireFunnelNavigation(html, flow.id, step.id, funnelSlug, nextStepSlug)
  const nextUrl = nextStepSlug ? `/f/${funnelSlug}/${nextStepSlug}` : ''
  const inject = navigationScript(nextUrl) + '\n' + trackingScript(flow.id, step.id, portalBase)
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
