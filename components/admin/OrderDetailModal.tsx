import React, { useEffect, useState } from 'react'
import { X, RefreshCw, XCircle, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../services/supabase'
import { useDialog } from '../../contexts/DialogContext'

// A single unified order row — feed either a payments row or a funnel_orders row.
// `source` disambiguates behavior for actions + rendering.
export type UnifiedOrder = {
  source: 'payment' | 'funnel_order'
  id: string
  reference: string          // gateway_ref or reference_code
  amount: number
  currency: string
  status: string             // 'completed' | 'pending' | 'refunded' | 'failed' | 'paid' | 'expired' | 'cancelled'
  gateway?: string           // sepay / manual / etc.
  created_at: string
  paid_at?: string | null
  expires_at?: string | null
  // Denormalised customer info (from customer_snapshot on funnel_orders, or joined customers on payments)
  customer_name?: string
  customer_email?: string
  customer_phone?: string
  // Optional links
  funnel_id?: string | null
  step_id?: string | null
  submission_id?: string | null
  order_id?: string | null   // payments.order_id → funnel_orders.id
  qr_url?: string | null
  note?: string | null
  raw: any                   // Original row for debug / advanced view
}

interface Props {
  order: UnifiedOrder
  onClose: () => void
  onChanged: () => void      // Called after refund/cancel so parent can reload
}

const VND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0)

const STATUS_TONE: Record<string, string> = {
  completed: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  paid:      'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  pending:   'text-amber-400 bg-amber-400/10 border-amber-400/30',
  refunded:  'text-red-400 bg-red-400/10 border-red-400/30',
  failed:    'text-gray-400 bg-gray-700 border-gray-600',
  expired:   'text-gray-400 bg-gray-700 border-gray-600',
  cancelled: 'text-gray-400 bg-gray-700 border-gray-600',
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Đã thanh toán',
  paid:      'Đã thanh toán',
  pending:   'Đang chờ QR',
  refunded:  'Đã hoàn tiền',
  failed:    'Thất bại',
  expired:   'Đã hết hạn',
  cancelled: 'Đã huỷ',
}

const OrderDetailModal: React.FC<Props> = ({ order, onClose, onChanged }) => {
  const { confirm } = useDialog()
  const [funnel, setFunnel] = useState<any>(null)
  const [step, setStep] = useState<any>(null)
  const [submission, setSubmission] = useState<any>(null)
  const [webhookEvents, setWebhookEvents] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [linkedFunnelOrder, setLinkedFunnelOrder] = useState<any>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // If this is a payments row, try to hydrate the linked funnel_order (order.order_id)
      let funnelOrderRow: any = null
      if (order.source === 'payment' && order.order_id) {
        const { data } = await supabase.from('funnel_orders')
          .select('*').eq('id', order.order_id).maybeSingle()
        funnelOrderRow = data
        if (alive) setLinkedFunnelOrder(data)
      }

      // Effective funnel/step/submission ids from either source
      const funnelId = order.funnel_id || funnelOrderRow?.funnel_id
      const stepId   = order.step_id   || funnelOrderRow?.step_id
      const submId   = order.submission_id || funnelOrderRow?.submission_id

      if (funnelId) {
        const { data } = await supabase.from('funnel_flows')
          .select('id, name, slug, type_key').eq('id', funnelId).maybeSingle()
        if (alive) setFunnel(data)
      }
      if (stepId) {
        const { data } = await supabase.from('funnel_steps')
          .select('id, name, slug, page_type, step_number').eq('id', stepId).maybeSingle()
        if (alive) setStep(data)
      }
      if (submId) {
        const { data } = await supabase.from('funnel_form_submissions')
          .select('id, data, created_at, synced_lead_id').eq('id', submId).maybeSingle()
        if (alive) setSubmission(data)
      }

      // Related webhook events (best-effort match on reference)
      if (order.reference) {
        const { data } = await supabase.from('webhook_events')
          .select('id, source, processed, error, created_at, payload')
          .order('created_at', { ascending: false })
          .limit(50)
        // Filter client-side by referenceCode/content match (webhook_events isn't indexed by ref)
        if (alive && data) {
          const ref = order.reference.toUpperCase()
          setWebhookEvents(data.filter((ev: any) => {
            const s = JSON.stringify(ev.payload || {}).toUpperCase()
            return s.includes(ref)
          }))
        }
      }
    })()
    return () => { alive = false }
  }, [order])

  const handleRefund = async () => {
    const ok = await confirm({
      title: 'Hoàn tiền',
      message: 'Đánh dấu đơn này là đã hoàn tiền? Hành động này không xoá bản ghi.',
      variant: 'warning',
      confirmText: 'Hoàn tiền',
    })
    if (!ok) return
    setBusy(true)
    try {
      // Only payments rows can be refunded (funnel_orders don't have a refunded status)
      if (order.source === 'payment') {
        await supabase.from('payments').update({ status: 'refunded' }).eq('id', order.id)
      }
      onChanged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleCancelPending = async () => {
    const ok = await confirm({
      title: 'Huỷ đơn chờ',
      message: 'Huỷ đơn này? Reference sẽ được giải phóng, người mua không thể quét QR nữa.',
      variant: 'warning',
      confirmText: 'Huỷ đơn',
    })
    if (!ok) return
    setBusy(true)
    try {
      if (order.source === 'funnel_order') {
        await supabase.from('funnel_orders').update({ status: 'cancelled' }).eq('id', order.id)
      }
      onChanged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const canRefund = order.source === 'payment' && (order.status === 'completed' || order.status === 'paid')
  const canCancel = order.source === 'funnel_order' && order.status === 'pending'
  const qrToShow  = order.qr_url || linkedFunnelOrder?.qr_url || null

  const submissionData = submission?.data || {}
  const submissionFields = Object.entries(submissionData).filter(([k]) => !['_meta', '_ts'].includes(k))

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-white">Chi tiết đơn hàng</h3>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_TONE[order.status] || ''}`}>
                {STATUS_LABEL[order.status] || order.status}
              </span>
              <span className="text-xs text-gray-500 uppercase tracking-widest">
                {order.source === 'funnel_order' ? 'Funnel · chờ QR' : 'CRM · đã ghi nhận'}
              </span>
            </div>
            <p className="text-xs font-mono text-gray-500">{order.reference}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-4">
            <SummaryTile label="Số tiền" value={VND(order.amount)} big />
            <SummaryTile label="Cổng thanh toán" value={order.gateway || '—'} />
            <SummaryTile label="Tạo lúc" value={format(new Date(order.created_at), 'dd/MM/yyyy HH:mm')} />
            {order.paid_at
              ? <SummaryTile label="Thanh toán lúc" value={format(new Date(order.paid_at), 'dd/MM/yyyy HH:mm')} />
              : order.expires_at
                ? <SummaryTile label="Hết hạn lúc" value={format(new Date(order.expires_at), 'dd/MM/yyyy HH:mm')} />
                : <SummaryTile label="—" value="—" />
            }
          </div>

          {/* Customer */}
          {(order.customer_name || order.customer_email || order.customer_phone) && (
            <Section title="Khách hàng">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <Field label="Tên" value={order.customer_name || '—'} />
                <Field label="Email" value={order.customer_email || '—'} />
                <Field label="SĐT" value={order.customer_phone || '—'} />
              </div>
            </Section>
          )}

          {/* Funnel context */}
          {(funnel || step) && (
            <Section title="Nguồn từ funnel">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Field label="Funnel" value={funnel?.name ? `${funnel.name} (${funnel.slug})` : '—'} />
                <Field label="Bước" value={step ? `${step.step_number}. ${step.name} — ${step.page_type}` : '—'} />
              </div>
            </Section>
          )}

          {/* QR image (pending funnel orders) */}
          {qrToShow && (order.status === 'pending' || order.source === 'funnel_order') && (
            <Section title="Mã QR SePay">
              <div className="flex items-start gap-4">
                <img src={qrToShow} alt="QR" className="w-56 h-56 bg-white rounded-lg border border-gray-800" />
                <div className="text-xs text-gray-400 space-y-1">
                  <p>Reference: <code className="text-emerald-400">{order.reference}</code></p>
                  <p>Số tiền: <span className="text-white">{VND(order.amount)}</span></p>
                  <p className="text-gray-500 pt-2">
                    Khách hàng quét QR bằng bất kỳ app ngân hàng nào có VietQR. SePay sẽ gọi
                    webhook <code>/api/f/sepay-webhook</code> khi ghi nhận thanh toán.
                  </p>
                  <a
                    href={qrToShow}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-gray-500 hover:text-white pt-2"
                  >
                    Mở ảnh QR <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </Section>
          )}

          {/* Submission data */}
          {submissionFields.length > 0 && (
            <Section title="Dữ liệu form">
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs">
                <dl className="space-y-1.5">
                  {submissionFields.map(([k, v]) => (
                    <div key={k} className="flex gap-3">
                      <dt className="text-gray-500 uppercase tracking-widest w-32 shrink-0">{k}</dt>
                      <dd className="text-gray-200 break-all">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Section>
          )}

          {/* Webhook history */}
          {webhookEvents.length > 0 && (
            <Section title={`Lịch sử webhook (${webhookEvents.length})`}>
              <div className="space-y-2">
                {webhookEvents.map(ev => (
                  <div key={ev.id} className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-400">
                        <span className="text-gray-500">{ev.source}</span> ·{' '}
                        {format(new Date(ev.created_at), 'dd/MM HH:mm:ss')}
                      </span>
                      {ev.error
                        ? <span className="text-red-400">Lỗi: {ev.error}</span>
                        : ev.processed
                          ? <span className="text-emerald-400">Đã xử lý</span>
                          : <span className="text-amber-400">Chờ xử lý</span>
                      }
                    </div>
                    <details>
                      <summary className="text-gray-500 cursor-pointer hover:text-gray-300">payload</summary>
                      <pre className="text-[10px] text-gray-500 mt-1 overflow-x-auto">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Note */}
          {order.note && (
            <Section title="Ghi chú">
              <p className="text-sm text-gray-300">{order.note}</p>
            </Section>
          )}
        </div>

        {/* Footer / actions */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {order.source === 'funnel_order' ? 'Funnel order' : 'Payment record'} · ID{' '}
            <code className="font-mono">{order.id.slice(0, 8)}</code>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white transition-colors"
            >
              Đóng
            </button>
            {canCancel && (
              <button
                disabled={busy}
                onClick={handleCancelPending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-300 border border-red-800/60 rounded-lg hover:bg-red-950/40 transition-colors disabled:opacity-50"
              >
                <XCircle size={14} /> Huỷ đơn chờ
              </button>
            )}
            {canRefund && (
              <button
                disabled={busy}
                onClick={handleRefund}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-300 border border-red-800/60 rounded-lg hover:bg-red-950/40 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} /> Hoàn tiền
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="text-xs text-gray-500 uppercase tracking-widest mb-2">{title}</h4>
    {children}
  </div>
)

const SummaryTile: React.FC<{ label: string; value: string; big?: boolean }> = ({ label, value, big }) => (
  <div className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3">
    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</p>
    <p className={big ? 'text-lg font-semibold text-white' : 'text-sm text-gray-200'}>{value}</p>
  </div>
)

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">{label}</p>
    <p className="text-gray-200 break-all">{value}</p>
  </div>
)

export default OrderDetailModal
