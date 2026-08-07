import React, { useState, useEffect } from 'react'
import { X, Save, CreditCard, Loader2, ExternalLink, Copy, Check } from 'lucide-react'
import { supabase } from '../../../services/supabase'

export interface PaymentConfig {
  provider?: 'sepay'
  bank_name?: string
  bank_bin?: string
  account_number?: string
  account_holder?: string
  qr_template?: 'compact' | 'qronly'
  amount_mode?: 'fixed' | 'from_form'
  fixed_amount?: number
  amount_form_field?: string
  webhook_secret?: string             // plaintext when user edits — encrypted server-side
  webhook_secret_encrypted?: string   // opaque, returned by server after save
  order_prefix?: string
}

const BANK_LIST = [
  'Vietcombank', 'VietinBank', 'BIDV', 'Techcombank', 'MB', 'ACB',
  'VPBank', 'Sacombank', 'TPBank', 'HDBank', 'SHB', 'VIB', 'OCB',
  'Eximbank', 'MSB', 'SeABank', 'Nam A Bank', 'ABBank', 'Bac A Bank',
  'PVcomBank', 'LienVietPostBank', 'DongA Bank', 'Kienlongbank', 'Saigonbank',
  'PGBank', 'BaoVietBank', 'VietBank', 'Public Bank Vietnam',
  'Agribank',
]

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export function PaymentConfigDrawer({
  funnelId, funnelSlug, initialConfig, paymentMode, onClose, onSaved,
}: {
  funnelId: string
  funnelSlug: string
  initialConfig: PaymentConfig
  paymentMode: string
  onClose: () => void
  onSaved: () => void
}) {
  const [cfg, setCfg] = useState<PaymentConfig>({
    provider: 'sepay',
    qr_template: 'compact',
    amount_mode: 'fixed',
    order_prefix: 'FN',
    ...initialConfig,
    webhook_secret: '',   // never prefill
  })
  const [mode, setMode] = useState(paymentMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const set = <K extends keyof PaymentConfig>(k: K, v: PaymentConfig[K]) => setCfg(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    setError(null); setSaving(true)
    try {
      const body: any = {
        id: funnelId,
        payment_mode: mode,
        payment_config: cfg,
      }
      // fetch flow to get name (required by API — we don't have name here)
      // Simpler: use PATCH-like approach — the API only updates fields present
      // But current API requires name — fetch existing first
      const existing = await api<{ name: string; type_key: string }>(`/api/funnel-flows?id=${funnelId}`)
      body.name = existing.name
      body.type_key = existing.type_key
      await api('/api/funnel-flows', { method: 'POST', body: JSON.stringify(body) })
      onSaved()
      onClose()
    } catch (e: any) { setError(e.message); setSaving(false) }
  }

  const webhookUrl = `${window.location.origin}/api/f/sepay-webhook`
  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasSecret = !!cfg.webhook_secret_encrypted && !cfg.webhook_secret

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-2xl w-full my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" style={{ color: 'var(--color-mission-accent)' }} />
            <h2 className="text-lg font-semibold">Payment Settings — {funnelSlug}</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Payment mode */}
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-2">Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm">
              <option value="collect_only">Collect info only — redirect next step (no payment)</option>
              <option value="inline_qr">Inline VietQR (SePay) — show QR after form submit</option>
              <option value="external_checkout">External checkout URL</option>
            </select>
          </div>

          {mode === 'inline_qr' && (
            <>
              <div className="border-t border-neutral-800 pt-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-neutral-800 flex items-center justify-center text-[10px] font-mono">1</span>
                  Thông tin ngân hàng
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Ngân hàng *</label>
                    <input list="bank-list" value={cfg.bank_name || ''} onChange={e => set('bank_name', e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm"
                      placeholder="VD: Vietcombank" />
                    <datalist id="bank-list">{BANK_LIST.map(b => <option key={b} value={b} />)}</datalist>
                    <p className="text-[10px] text-neutral-500 mt-1">Tên bank theo danh sách SePay hỗ trợ</p>
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Bank BIN (optional)</label>
                    <input value={cfg.bank_bin || ''} onChange={e => set('bank_bin', e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                      placeholder="VD: 970436" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Số tài khoản *</label>
                    <input value={cfg.account_number || ''} onChange={e => set('account_number', e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                      placeholder="0123456789" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Chủ tài khoản</label>
                    <input value={cfg.account_holder || ''} onChange={e => set('account_holder', e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm"
                      placeholder="NGUYEN VAN A" />
                  </div>
                </div>
              </div>

              <div className="border-t border-neutral-800 pt-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-neutral-800 flex items-center justify-center text-[10px] font-mono">2</span>
                  Số tiền
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Amount mode</label>
                    <select value={cfg.amount_mode || 'fixed'} onChange={e => set('amount_mode', e.target.value as any)}
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm">
                      <option value="fixed">Fixed — cố định số tiền</option>
                      <option value="from_form">From form field</option>
                    </select>
                  </div>
                  {cfg.amount_mode === 'fixed' ? (
                    <div>
                      <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Fixed amount (VND) *</label>
                      <input type="number" value={cfg.fixed_amount || ''} onChange={e => set('fixed_amount', Number(e.target.value))}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                        placeholder="1997000" />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Form field name</label>
                      <input value={cfg.amount_form_field || 'amount'} onChange={e => set('amount_form_field', e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                        placeholder="amount" />
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-neutral-800 pt-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-neutral-800 flex items-center justify-center text-[10px] font-mono">3</span>
                  Webhook SePay
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Webhook URL (config vào SePay)</label>
                    <div className="flex gap-2">
                      <input readOnly value={webhookUrl}
                        className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-xs font-mono text-neutral-400" />
                      <button onClick={copyWebhook} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg">
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-1">
                      Copy URL này, vào <a href="https://my.sepay.vn" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">SePay dashboard <ExternalLink className="w-2.5 h-2.5" /></a> → Webhook → paste vào.
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Webhook secret (Authorization Apikey)</label>
                    <input type="password" value={cfg.webhook_secret || ''} onChange={e => set('webhook_secret', e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                      placeholder={hasSecret ? '••••••••••• (đã lưu, để trống nếu không đổi)' : 'Paste secret từ SePay'} />
                    <p className="text-[10px] text-neutral-500 mt-1">
                      Trong SePay dashboard: Webhook Authorization = "Apikey &lt;secret&gt;". Portal verify secret này khi nhận callback.
                      Encrypted server-side (AES-256-GCM).
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Order prefix</label>
                      <input value={cfg.order_prefix || 'FN'} onChange={e => set('order_prefix', e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                        placeholder="FN" />
                      <p className="text-[10px] text-neutral-500 mt-1">Reference code: {cfg.order_prefix || 'FN'}XXXXXXXX</p>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">QR template</label>
                      <select value={cfg.qr_template || 'compact'} onChange={e => set('qr_template', e.target.value as any)}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm">
                        <option value="compact">Compact — có thông tin</option>
                        <option value="qronly">QR only — chỉ mã</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {error && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          <button onClick={onClose} className="text-sm text-neutral-500 hover:text-white px-3">Huỷ</button>
          <button onClick={save} disabled={saving}
            style={{ background: 'var(--color-mission-accent)', color: '#000' }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
