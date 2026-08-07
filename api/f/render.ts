// api/f/render.ts — Public renderer for /f/:funnel_slug/:step_slug
// GET /api/f/render?funnel=<slug>&step=<slug>&order_id=<uuid>
//   - order_id required when step.page_type = 'upsell' (to verify paid parent order).
//   - Otherwise: renders the step's AI-generated HTML with navigation/forms wired.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { parse as parseHtml } from 'node-html-parser'

/**
 * Wire funnel navigation into the AI-generated HTML.
 *
 * Convention (Option B, enforced by prompt):
 *   - Scroll links: plain <a href="#section-id">   (NO data-cta)
 *   - Primary CTA:  <a data-cta="1">              (NO href — portal injects)
 *   - Upsell YES:   <a|button data-cta="upsell-yes">   → JS modal handler
 *   - Upsell NO:    <a|button data-cta="upsell-no">    → href = success step
 *
 * Server-side rewrites (belt-and-suspenders — prompt may fail):
 *   - <form>: force action=/api/f/submit, method=POST, data-form="1",
 *     hidden inputs funnel_id + step_id (add or overwrite).
 *   - <a data-cta="1"> without real navigation href (fragment/empty/relative)
 *     → set href = next step URL.
 *   - <a data-cta="upsell-no"> without href → set href = upsell success step.
 *   - <button data-cta="1|upsell-yes|upsell-no"> is wired by delegated JS below.
 */
function wireFunnelNavigation(
  html: string,
  ctx: {
    funnelId: string
    stepId: string
    funnelSlug: string
    nextStepSlug?: string        // where primary CTA should go
    upsellSuccessSlug?: string    // where upsell NO should go (defaults to nextStepSlug)
  },
): string {
  const root = parseHtml(html, { comment: true, blockTextElements: { script: true, style: true, pre: true } })
  const nextUrl = ctx.nextStepSlug ? `/f/${ctx.funnelSlug}/${ctx.nextStepSlug}` : ''
  const upsellNoUrl = ctx.upsellSuccessSlug ? `/f/${ctx.funnelSlug}/${ctx.upsellSuccessSlug}` : nextUrl

  // ── Forms
  for (const form of root.querySelectorAll('form')) {
    form.setAttribute('action', '/api/f/submit')
    form.setAttribute('method', 'POST')
    if (!form.hasAttribute('data-form')) form.setAttribute('data-form', '1')

    const setHidden = (name: string, value: string) => {
      const existing = form.querySelector(`input[name="${name}"]`)
      if (existing) {
        existing.setAttribute('value', value)
        existing.setAttribute('type', 'hidden')
      } else {
        form.insertAdjacentHTML('afterbegin', `<input type="hidden" name="${name}" value="${value}">`)
      }
    }
    setHidden('funnel_id', ctx.funnelId)
    setHidden('step_id', ctx.stepId)
  }

  const isRealNav = (href: string) => /^(https?:|mailto:|tel:|\/)/i.test(href)

  // ── <a data-cta="upsell-no">: link to upsell success (thank-you)
  if (upsellNoUrl) {
    for (const a of root.querySelectorAll('a[data-cta="upsell-no"]')) {
      const href = (a.getAttribute('href') || '').trim()
      if (!isRealNav(href)) a.setAttribute('href', upsellNoUrl)
    }
  }

  // ── <a data-cta="upsell-yes">: no href needed (JS handler intercepts click)
  // Ensure href="#" so <a> is styled as a link and cursor is pointer.
  for (const a of root.querySelectorAll('a[data-cta="upsell-yes"]')) {
    if (!a.hasAttribute('href')) a.setAttribute('href', '#')
  }

  // ── <a data-cta="1"> (primary CTA): only rewrite non-navigation hrefs
  if (nextUrl) {
    for (const a of root.querySelectorAll('a[data-cta="1"], a[data-cta="next"]')) {
      const href = (a.getAttribute('href') || '').trim()
      if (!isRealNav(href)) a.setAttribute('href', nextUrl)
    }
  }

  return root.toString()
}

/**
 * Client-side handlers for all interactive CTAs the server can't rewrite in place:
 *   - <button data-cta="1"> outside form → navigate to next step
 *   - <a|button data-cta="upsell-no"> → navigate to success step (fallback if server didn't set href)
 *   - <a|button data-cta="upsell-yes"> → POST /api/f/upsell?action=accept → open modal with QR
 */
function funnelScripts(opts: {
  nextUrl: string
  upsellNoUrl: string
  funnelId: string
  stepId: string
  isUpsellPage: boolean
  parentOrderId?: string
}): string {
  return `
<script>
(function(){
  var NEXT = ${JSON.stringify(opts.nextUrl)};
  var UPSELL_NO_URL = ${JSON.stringify(opts.upsellNoUrl || opts.nextUrl)};
  var IS_UPSELL = ${JSON.stringify(opts.isUpsellPage)};
  var FUNNEL_ID = ${JSON.stringify(opts.funnelId)};
  var STEP_ID = ${JSON.stringify(opts.stepId)};
  var PARENT_ORDER_ID = ${JSON.stringify(opts.parentOrderId || '')};

  // Primary CTA <button data-cta="1"> outside form → navigate
  document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var btn = e.target.closest('button[data-cta="1"], button[data-cta="next"]');
    if (btn && !btn.closest('form') && btn.getAttribute('type') !== 'submit') {
      e.preventDefault();
      if (NEXT) window.location.href = NEXT;
    }
  }, false);

  // Upsell NO — either anchor or button
  document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('[data-cta="upsell-no"]');
    if (el) {
      e.preventDefault();
      window.location.href = UPSELL_NO_URL || '/';
    }
  }, false);

  // Upsell YES — open modal, POST to /api/f/upsell
  if (IS_UPSELL) {
    document.addEventListener('click', function(e){
      if (!e.target || !e.target.closest) return;
      var el = e.target.closest('[data-cta="upsell-yes"]');
      if (!el) return;
      e.preventDefault();
      if (!PARENT_ORDER_ID) { alert('Không xác định được đơn hàng gốc. Vui lòng quay lại.'); return; }
      openUpsellModal();
    }, false);
  }

  var _pollTimer = null;
  function openUpsellModal() {
    var modal = document.getElementById('upsell-modal');
    if (!modal) return alert('Modal thiếu.');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('upsell-modal-body').innerHTML =
      '<div class="text-center py-8"><div class="inline-block w-10 h-10 border-4 border-neutral-200 border-t-neutral-800 rounded-full animate-spin"></div><p class="mt-4 text-sm text-neutral-600">Đang tạo mã thanh toán…</p></div>';

    fetch('/api/f/upsell?action=accept', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ funnel_id: FUNNEL_ID, step_id: STEP_ID, parent_order_id: PARENT_ORDER_ID }),
    })
    .then(function(r){ return r.json().then(function(d){ return {ok: r.ok, data: d}; }); })
    .then(function(res){
      if (!res.ok) {
        document.getElementById('upsell-modal-body').innerHTML =
          '<div class="text-center py-8"><p class="text-red-600 font-semibold">Không tạo được đơn upsell</p><p class="text-xs text-neutral-500 mt-2">' + (res.data.error || '') + '</p><button onclick="document.getElementById(\\'upsell-modal\\').classList.add(\\'hidden\\');document.body.style.overflow=\\'\\';" class="mt-4 px-4 py-2 bg-neutral-200 rounded">Đóng</button></div>';
        return;
      }
      renderUpsellQr(res.data);
    })
    .catch(function(err){
      document.getElementById('upsell-modal-body').innerHTML =
        '<div class="text-center py-8"><p class="text-red-600">Lỗi kết nối: ' + err.message + '</p></div>';
    });
  }

  function fmtVND(n) { try { return new Intl.NumberFormat('vi-VN').format(n) + ' đ'; } catch(e){ return n + ' đ'; } }

  function renderUpsellQr(data) {
    var body = document.getElementById('upsell-modal-body');
    body.innerHTML =
      '<div class="text-center">' +
        '<h3 class="text-lg font-bold text-neutral-900 mb-1">Bổ sung — ' + fmtVND(data.amount) + '</h3>' +
        '<p class="text-xs text-neutral-500 mb-4">Quét QR bên dưới để thêm ưu đãi vào đơn hàng</p>' +
        '<img src="' + data.qr_url + '" alt="QR upsell" class="w-56 h-56 mx-auto rounded-lg border border-neutral-200 mb-3" />' +
        '<p class="text-xs text-neutral-500">Nội dung chuyển khoản</p>' +
        '<p class="font-mono font-semibold text-neutral-800 mb-4">' + data.reference_code + '</p>' +
        '<div id="upsell-status" class="text-sm text-amber-600 flex items-center justify-center gap-2">' +
          '<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> Đang chờ thanh toán…' +
        '</div>' +
        '<div class="mt-6 flex gap-3 justify-center">' +
          '<button id="upsell-skip" class="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded text-sm text-neutral-700">Bỏ qua, tiếp tục</button>' +
        '</div>' +
      '</div>';

    document.getElementById('upsell-skip').addEventListener('click', function(){
      if (_pollTimer) clearInterval(_pollTimer);
      window.location.href = UPSELL_NO_URL || '/';
    });

    _pollTimer = setInterval(function(){
      fetch('/api/f/order-status?order=' + encodeURIComponent(data.order_id), { cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d.status === 'paid') {
            clearInterval(_pollTimer);
            document.getElementById('upsell-status').innerHTML =
              '<span class="text-green-600 font-semibold">✓ Đã nhận thanh toán — đang chuyển…</span>';
            setTimeout(function(){
              var url = UPSELL_NO_URL || '/';
              window.location.href = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'upsell_taken=1';
            }, 1500);
          } else if (d.status === 'expired' || d.status === 'failed') {
            clearInterval(_pollTimer);
            document.getElementById('upsell-status').innerHTML =
              '<span class="text-red-600">Đơn hết hạn — bấm "Bỏ qua" để tiếp tục</span>';
          }
        }).catch(function(){});
    }, 3000);
  }
})();
</script>`.trim()
}

function upsellModalHtml(): string {
  return `
<div id="upsell-modal" class="hidden fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6" role="dialog" aria-modal="true" aria-labelledby="upsell-modal-title">
    <div id="upsell-modal-body"></div>
  </div>
</div>`.trim()
}

function trackingScript(funnelId: string, stepId: string, portalBase: string): string {
  return `
<script>
(function(){
  var FUNNEL_ID='${funnelId}', STEP_ID='${stepId}', TRACK_URL='${portalBase}/api/f/track';
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];

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
  const orderIdQuery = url.searchParams.get('order_id') || ''
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
    .select('id, html, name, page_type, form_success_step_slug, step_number, has_form, upsell_config')
    .eq('funnel_id', flow.id).eq('slug', targetSlug).maybeSingle()

  if (!step || !step.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(notFoundHtml('Step không tìm thấy hoặc chưa có nội dung.'))
  }

  const isUpsellPage = step.page_type === 'upsell'

  // Upsell eligibility gate: caller must present a paid parent order for THIS funnel.
  if (isUpsellPage) {
    if (!orderIdQuery) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(403).send(notFoundHtml('Trang này chỉ hiển thị cho khách đã thanh toán đơn gốc.'))
    }
    const { data: parent } = await admin.from('funnel_orders')
      .select('id, status, funnel_id, order_kind').eq('id', orderIdQuery).maybeSingle()
    if (!parent || parent.funnel_id !== flow.id || parent.status !== 'paid' || parent.order_kind !== 'base') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(403).send(notFoundHtml('Đơn hàng gốc không hợp lệ hoặc chưa thanh toán.'))
    }
  }

  // Resolve next step slug (form_success_step_slug > next step by number)
  let nextStepSlug: string | undefined = step.form_success_step_slug || undefined
  if (!nextStepSlug) {
    const { data: nextStep } = await admin.from('funnel_steps')
      .select('slug').eq('funnel_id', flow.id).gt('step_number', step.step_number)
      .order('step_number').limit(1).maybeSingle()
    nextStepSlug = nextStep?.slug || undefined
  }
  // Upsell page: NO button routes to upsell_config.success_step_slug || form_success_step_slug || nextStepSlug
  const upsellSuccessSlug = isUpsellPage
    ? ((step.upsell_config as any)?.success_step_slug || step.form_success_step_slug || nextStepSlug)
    : nextStepSlug

  const portalBase = process.env.CUSTOMER_PORTAL_URL || `${url.protocol}//${req.headers.host}`
  let html = step.html
  html = wireFunnelNavigation(html, {
    funnelId: flow.id,
    stepId: step.id,
    funnelSlug,
    nextStepSlug,
    upsellSuccessSlug,
  })

  const nextUrl = nextStepSlug ? `/f/${funnelSlug}/${nextStepSlug}` : ''
  const upsellNoUrl = upsellSuccessSlug ? `/f/${funnelSlug}/${upsellSuccessSlug}` : nextUrl

  const injections: string[] = []
  if (isUpsellPage) injections.push(upsellModalHtml())
  injections.push(funnelScripts({
    nextUrl, upsellNoUrl,
    funnelId: flow.id, stepId: step.id,
    isUpsellPage, parentOrderId: orderIdQuery,
  }))
  injections.push(trackingScript(flow.id, step.id, portalBase))

  const injected = injections.join('\n')
  html = html.includes('</body>') ? html.replace('</body>', `${injected}\n</body>`) : html + injected

  // Chat widget
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
  // Upsell page varies by ?order_id → never cache. Other pages: 60s.
  res.setHeader('Cache-Control', isUpsellPage ? 'no-store' : 'public, max-age=60')
  return res.status(200).send(html)
}
