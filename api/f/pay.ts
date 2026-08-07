// api/f/pay.ts — Payment page renderer
// GET /api/f/pay?order=<order_id>  → HTML with QR + bank info + polling JS
// Route from vite proxy: /f/:slug/pay/:orderId

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function payPageHtml(order: any, portalBase: string): string {
  const bank = order.bank_snapshot || {}
  const cust = order.customer_snapshot || {}
  const amountFmt = new Intl.NumberFormat('vi-VN').format(order.amount || 0)
  const successUrl = `/f/${order.funnel_slug}${order.next_step_slug ? `/${order.next_step_slug}` : ''}`
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thanh toán đơn hàng ${order.reference_code}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Inter', system-ui, sans-serif; }
  .pulse-dot { animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
</head>
<body class="bg-neutral-50 min-h-screen">
  <div class="max-w-2xl mx-auto py-8 px-4">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold text-neutral-900">Thanh toán đơn hàng</h1>
      <p class="text-sm text-neutral-500 mt-1">Quét QR bằng app ngân hàng để thanh toán</p>
    </div>

    <div id="pay-card" class="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
      <div class="grid md:grid-cols-2 gap-6 p-6">
        <!-- QR side -->
        <div class="text-center">
          <div class="bg-neutral-50 rounded-lg p-4 mb-3 inline-block">
            <img src="${order.qr_url}" alt="VietQR" class="w-64 h-64 mx-auto" />
          </div>
          <p class="text-xs text-neutral-500">Quét mã để thanh toán</p>
        </div>
        <!-- Info side -->
        <div class="space-y-4 text-sm">
          <h2 class="font-semibold text-neutral-800">Thông tin chuyển khoản</h2>
          <div>
            <p class="text-xs text-neutral-500 uppercase tracking-wider mb-0.5">Ngân hàng</p>
            <p class="font-medium">${bank.bank_name || '-'}</p>
          </div>
          <div>
            <p class="text-xs text-neutral-500 uppercase tracking-wider mb-0.5">Số TK</p>
            <p class="font-mono font-medium">${bank.account_number || '-'}</p>
          </div>
          <div>
            <p class="text-xs text-neutral-500 uppercase tracking-wider mb-0.5">Chủ TK</p>
            <p class="font-medium">${bank.account_holder || '-'}</p>
          </div>
          <div>
            <p class="text-xs text-neutral-500 uppercase tracking-wider mb-0.5">Số tiền</p>
            <p class="text-2xl font-bold text-neutral-900">${amountFmt}<span class="text-sm font-normal ml-1">${order.currency}</span></p>
          </div>
          <div>
            <p class="text-xs text-neutral-500 uppercase tracking-wider mb-0.5">Nội dung chuyển khoản</p>
            <div class="flex items-center gap-2">
              <p class="font-mono font-medium text-primary">${order.reference_code}</p>
              <button onclick="navigator.clipboard.writeText('${order.reference_code}').then(()=>this.textContent='✓ Copied')"
                class="text-xs px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 rounded">Copy</button>
            </div>
            <p class="text-xs text-amber-600 mt-1">⚠ Vui lòng giữ nguyên nội dung để hệ thống xác nhận tự động</p>
          </div>
        </div>
      </div>

      <div id="status-bar" class="bg-neutral-50 border-t border-neutral-200 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-neutral-600">
          <span class="w-2 h-2 rounded-full bg-amber-500 pulse-dot"></span>
          <span id="status-text">Đang chờ thanh toán...</span>
        </div>
        <span class="text-xs text-neutral-500" id="expire-text"></span>
      </div>
    </div>

    <div id="paid-card" class="hidden bg-white rounded-xl border border-green-200 overflow-hidden shadow-sm mt-6">
      <div class="p-8 text-center">
        <div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 class="text-xl font-bold text-neutral-900">✓ Đã nhận thanh toán</h2>
        <p class="text-sm text-neutral-500 mt-1">Cảm ơn bạn. Đang chuyển sang trang tiếp theo...</p>
      </div>
    </div>

    <div class="mt-6 text-center text-xs text-neutral-500">
      Đơn hàng: <span class="font-mono">${order.reference_code}</span>
      · ${cust.email || ''}
    </div>
  </div>

<script>
(function(){
  var ORDER_ID = '${order.id}';
  var SUCCESS_URL = '${successUrl}';
  var EXPIRES_AT = ${JSON.stringify(order.expires_at)};
  var POLL_INTERVAL = 3000;
  var pollTimer = null, expireTimer = null;

  function updateExpire() {
    if (!EXPIRES_AT) return;
    var remain = Math.max(0, Math.floor((new Date(EXPIRES_AT).getTime() - Date.now()) / 1000));
    if (remain === 0) {
      document.getElementById('expire-text').textContent = 'Hết hạn';
      document.getElementById('status-text').textContent = 'Đơn hàng hết hạn';
      clearInterval(pollTimer);
      return;
    }
    var m = Math.floor(remain / 60), s = remain % 60;
    document.getElementById('expire-text').textContent = 'Hết hạn sau ' + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function poll() {
    fetch('/api/f/order-status?order=' + ORDER_ID, { cache: 'no-store' })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data.status === 'paid') {
          clearInterval(pollTimer);
          document.getElementById('pay-card').style.opacity = '0.4';
          document.getElementById('paid-card').classList.remove('hidden');
          setTimeout(function(){ window.location.href = SUCCESS_URL; }, 2000);
        } else if (data.status === 'expired' || data.status === 'failed') {
          document.getElementById('status-text').textContent = 'Đơn hàng ' + data.status;
          clearInterval(pollTimer);
        }
      })
      .catch(function(){});
  }

  updateExpire();
  expireTimer = setInterval(updateExpire, 1000);
  pollTimer = setInterval(poll, POLL_INTERVAL);
  poll();
})();
</script>
</body>
</html>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const url = new URL(req.url || '', 'http://localhost')
  const orderId = url.searchParams.get('order')
  if (!orderId) return res.status(400).send('order required')

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: order } = await admin.from('funnel_orders')
    .select('*, funnel_flows!inner(slug)')
    .eq('id', orderId).maybeSingle()

  if (!order) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send('<!DOCTYPE html><body style="font-family:system-ui;padding:40px">Đơn hàng không tồn tại.</body>')
  }

  // Get next step slug (from the payment step's form_success_step_slug)
  const { data: step } = await admin.from('funnel_steps')
    .select('form_success_step_slug, form_success_url').eq('id', order.step_id).maybeSingle()

  const enriched = {
    ...order,
    funnel_slug: (order.funnel_flows as any)?.slug,
    next_step_slug: step?.form_success_step_slug,
  }

  const portalBase = process.env.CUSTOMER_PORTAL_URL || `${url.protocol}//${req.headers.host}`
  const html = payPageHtml(enriched, portalBase)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(html)
}
