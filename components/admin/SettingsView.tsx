import React, { useEffect, useState } from 'react'
import { Copy, Check, Webhook, Mail, Zap, Info, Sliders, ExternalLink, KeyRound, Palette, Activity, Sparkles, Layers, PenLine, Users, MessageSquare } from 'lucide-react'
import type { PortalTheme } from '../../types'
import { supabase } from '../../services/supabase'
import { useConfig } from '../../contexts/ConfigContext'
import AISettingsView from './AISettingsView'
import AIProvidersView from './AIProvidersView'
import FunnelTypesView from './FunnelTypesView'
import CopyFormulasView from './CopyFormulasView'
import HealthCheckTab from './HealthCheckTab'
import TeamView from './TeamView'
import ChatSnippetsView from './ChatSnippetsView'
import APITokensView from './APITokensView'

type Tab = 'team' | 'chat-snippets' | 'webhook' | 'email' | 'ai' | 'funnel-types' | 'copy-formulas' | 'health' | 'api-tokens' | 'general'

const THEMES: Array<{
  id: PortalTheme; name: string
  previewBg: string; previewPattern: string
  accent: string; labelBg: string; labelColor: string
  defaultAccent: string   // auto-apply khi chọn theme
}> = [
  {
    id: 'cyberpunk', name: 'Cyberpunk',
    previewBg: 'radial-gradient(ellipse at -10% 120%, rgba(182,255,0,0.25) 0%, #050508 60%)',
    previewPattern: 'repeating-linear-gradient(0deg,rgba(182,255,0,0.06) 0px,rgba(182,255,0,0.06) 1px,transparent 1px,transparent 32px),repeating-linear-gradient(90deg,rgba(182,255,0,0.06) 0px,rgba(182,255,0,0.06) 1px,transparent 1px,transparent 32px)',
    accent: '#B6FF00', labelBg: '#050508', labelColor: '#B6FF00',
    defaultAccent: '#B6FF00',
  },
  {
    id: 'aurora', name: 'Aurora',
    previewBg: 'linear-gradient(135deg,#0d0f20 0%,#0c0a1e 50%,#120818 100%)',
    previewPattern: 'radial-gradient(ellipse at 20% 0%,rgba(99,102,241,0.35) 0%,transparent 60%),radial-gradient(ellipse at 80% 100%,rgba(168,85,247,0.25) 0%,transparent 50%)',
    accent: '#818cf8', labelBg: '#0c0a1e', labelColor: '#a5b4fc',
    defaultAccent: '#818cf8',
  },
  {
    id: 'carbon', name: 'Carbon',
    previewBg: '#0f1115',
    previewPattern: 'radial-gradient(circle,rgba(255,255,255,0.07) 1px,transparent 1px) 0 0/20px 20px',
    accent: '#94a3b8', labelBg: '#13161b', labelColor: '#9ca3af',
    defaultAccent: '#94a3b8',
  },
  {
    id: 'paper', name: 'Paper',
    previewBg: 'linear-gradient(180deg,#f0efe9 0%,#fafaf8 100%)',
    previewPattern: 'repeating-linear-gradient(0deg,rgba(0,0,0,0.05) 0px,rgba(0,0,0,0.05) 1px,transparent 1px,transparent 36px),repeating-linear-gradient(90deg,rgba(0,0,0,0.05) 0px,rgba(0,0,0,0.05) 1px,transparent 1px,transparent 36px)',
    accent: '#6366f1', labelBg: '#ece9e0', labelColor: '#374151',
    defaultAccent: '#6366f1',
  },
  {
    id: 'solar', name: 'Solar',
    previewBg: 'radial-gradient(ellipse at 50% 120%, rgba(251,146,60,0.3) 0%, #0e0c08 55%)',
    previewPattern: 'radial-gradient(circle,rgba(251,146,60,0.08) 1px,transparent 1px) 0 0/24px 24px',
    accent: '#f97316', labelBg: '#0e0c08', labelColor: '#fb923c',
    defaultAccent: '#f97316',
  },
]

const VALID_TABS: Tab[] = ['team', 'chat-snippets', 'webhook', 'email', 'ai', 'funnel-types', 'copy-formulas', 'health', 'api-tokens', 'general']

const readTabFromHash = (): Tab | null => {
  if (typeof window === 'undefined') return null
  const h = window.location.hash.replace(/^#/, '') as Tab
  return VALID_TABS.includes(h) ? h : null
}

const SettingsView: React.FC = () => {
  const { settings, updateSettings } = useConfig()
  const [activeTab, setActiveTab] = useState<Tab>(() => readTabFromHash() || 'team')

  // Sync with URL hash so external links (e.g. onboarding checklist) can deep-link
  useEffect(() => {
    const onHash = () => {
      const t = readTabFromHash()
      if (t) setActiveTab(t)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Webhook state
  const [webhookSecret, setWebhookSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [secretSaving, setSecretSaving] = useState(false)
  const [secretSaved, setSecretSaved] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [webhookEvents, setWebhookEvents] = useState<any[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [docTab, setDocTab] = useState<'lead' | 'provision'>('lead')
  const [refCourses, setRefCourses] = useState<Array<{ id: string; title: string; price: number | null }>>([])
  const [refProducts, setRefProducts] = useState<Array<{ id: string; name: string; type: string; price: number | null }>>([])
  const [refLoading, setRefLoading] = useState(false)

  // Email / Resend state
  const [resendKey, setResendKey] = useState('')
  const [resendKeySaved, setResendKeySaved] = useState(false)
  const [resendKeySaving, setResendKeySaving] = useState(false)
  const [smtpCopied, setSmtpCopied] = useState<string | null>(null)

  // General state
  const [appTitle, setAppTitle] = useState('')
  const [appLogoUrl, setAppLogoUrl] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#6366f1')
  const [selectedTheme, setSelectedTheme] = useState<PortalTheme>('cyberpunk')
  const [generalSaving, setGeneralSaving] = useState(false)
  const [generalSaved, setGeneralSaved] = useState(false)

  useEffect(() => {
    supabase.from('app_settings').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, any> = {}
        data.forEach((row: any) => { map[row.key] = row.value })
        if (map['title']?.value) setAppTitle(map['title'].value)
        if (map['logoUrl']?.value) setAppLogoUrl(map['logoUrl'].value)
        if (map['primaryColor']?.value) setPrimaryColor(map['primaryColor'].value)
        if (map['resend_api_key']?.value) setResendKey(map['resend_api_key'].value)
        if (map['theme']?.value) setSelectedTheme(map['theme'].value as PortalTheme)
        if (map['webhook_secret']?.value) setWebhookSecret(map['webhook_secret'].value)
      }
    })
  }, [])

  const handleSaveResendKey = async () => {
    setResendKeySaving(true)
    await supabase.from('app_settings').upsert([
      { key: 'resend_api_key', value: { value: resendKey.trim() } },
    ])
    setResendKeySaving(false)
    setResendKeySaved(true)
    setTimeout(() => setResendKeySaved(false), 2000)
  }

  const copySMTP = (val: string, key: string) => {
    navigator.clipboard.writeText(val)
    setSmtpCopied(key)
    setTimeout(() => setSmtpCopied(null), 2000)
  }

  const baseUrl = window.location.origin
  const webhookLeadUrl = `${baseUrl}/api/webhook/lead`
  const webhookProvisionUrl = `${baseUrl}/api/webhook/provision`

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const generateSecret = async () => {
    const arr = new Uint8Array(24)
    window.crypto.getRandomValues(arr)
    const secret = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
    setWebhookSecret(secret)
    setShowSecret(true)
    setSecretSaving(true)
    await supabase.from('app_settings').upsert([{ key: 'webhook_secret', value: { value: secret } }])
    setSecretSaving(false)
    setSecretSaved(true)
    setTimeout(() => setSecretSaved(false), 2000)
  }

  const saveSecret = async () => {
    if (!webhookSecret.trim()) return
    setSecretSaving(true)
    await supabase.from('app_settings').upsert([{ key: 'webhook_secret', value: { value: webhookSecret.trim() } }])
    setSecretSaving(false)
    setSecretSaved(true)
    setTimeout(() => setSecretSaved(false), 2000)
  }

  const loadWebhookEvents = async () => {
    setEventsLoading(true)
    const { data } = await supabase
      .from('webhook_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setWebhookEvents(data || [])
    setEventsLoading(false)
  }

  useEffect(() => {
    if (activeTab !== 'webhook') return
    setRefLoading(true)
    Promise.all([
      supabase.from('courses').select('id, title, price').order('created_at', { ascending: false }),
      supabase.from('products').select('id, name, type, price').eq('status', 'active').order('created_at', { ascending: false }),
    ]).then(([c, p]) => {
      setRefCourses((c.data || []) as any)
      setRefProducts((p.data || []) as any)
      setRefLoading(false)
    })
    loadWebhookEvents()
  }, [activeTab])

  const handleSaveGeneral = async () => {
    setGeneralSaving(true)
    const { error } = await supabase.from('app_settings').upsert([
      { key: 'title', value: { value: appTitle } },
      { key: 'logoUrl', value: { value: appLogoUrl } },
      { key: 'primaryColor', value: { value: primaryColor } },
      { key: 'theme', value: { value: selectedTheme } },
    ])
    if (error) {
      console.error('Save settings error:', error)
      setGeneralSaving(false)
      alert(`Lưu thất bại: ${error.message}`)
      return
    }
    updateSettings({
      title:           appTitle,
      description:     settings?.description || '',
      primaryColor:    primaryColor,
      logoUrl:         appLogoUrl,
      guideVideoUrl:   settings?.guideVideoUrl,
      supportZaloLink: settings?.supportZaloLink,
      theme:           selectedTheme,
    })
    setGeneralSaving(false)
    setGeneralSaved(true)
    setTimeout(() => setGeneralSaved(false), 2000)
  }

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? '' : 'bg-gray-700'}`}
      style={value ? { backgroundColor: 'var(--color-mission-accent)' } : undefined}
    >
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${value ? 'left-6' : 'left-1'}`} />
    </button>
  )

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Cài đặt</h1>
        <p className="text-gray-500 text-sm mt-1">Cấu hình cổng học viên</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {([
          { key: 'team', label: 'Đội ngũ', icon: Users },
          { key: 'chat-snippets', label: 'Chat snippets', icon: MessageSquare },
          { key: 'webhook', label: 'Webhook & Delivery', icon: Webhook },
          { key: 'email', label: 'Email', icon: Mail },
          { key: 'ai', label: 'AI Providers', icon: Sparkles },
          { key: 'funnel-types', label: 'Funnel Types', icon: Layers },
          { key: 'copy-formulas', label: 'Copy Formulas', icon: PenLine },
          { key: 'health', label: 'Health check', icon: Activity },
          { key: 'api-tokens', label: 'API Tokens', icon: KeyRound },
          { key: 'general', label: 'Chung', icon: Sliders },
        ] as { key: Tab; label: string; icon: React.FC<any> }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key)
              if (typeof window !== 'undefined') {
                history.replaceState(null, '', `#${tab.key}`)
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 transition-all -mb-px ${activeTab === tab.key ? '' : 'border-transparent text-gray-500 hover:text-white'}`}
            style={activeTab === tab.key ? {
              borderColor: 'var(--color-mission-accent)',
              color: 'var(--color-mission-accent)',
            } : undefined}
          >
            <tab.icon size={14} />{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'team' && <TeamView />}
      {activeTab === 'chat-snippets' && <ChatSnippetsView />}

      {activeTab === 'webhook' && (
        <div className="space-y-6">

          {/* Endpoints */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Webhook size={15} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-sm font-semibold text-white">Webhook Endpoints</h2>
            </div>
            <p className="text-xs text-gray-500 mb-5">
              Dùng các URL này để đẩy dữ liệu từ landing page, phễu bán hàng hoặc bất kỳ hệ thống ngoài nào vào MiniCRM.
            </p>

            {[
              { key: 'lead', label: 'Capture Lead', url: webhookLeadUrl, desc: 'Nhận opt-in / quan tâm — tạo lead, không tạo tài khoản' },
              { key: 'provision', label: 'Provision', url: webhookProvisionUrl, desc: 'Thanh toán / đăng ký xong — tạo KH + enroll + ghi đơn' },
            ].map(ep => (
              <div key={ep.key} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-white">{ep.label}</span>
                  <span className="text-xs text-gray-600">—</span>
                  <span className="text-xs text-gray-500">{ep.desc}</span>
                </div>
                <div className="flex gap-2">
                  <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: 'var(--color-mission-accent)' }}>
                    {ep.url}
                  </code>
                  <button onClick={() => copyText(ep.url, ep.key)} className="px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors">
                    {copiedKey === ep.key ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Secret */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={15} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-sm font-semibold text-white">Webhook Secret</h2>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Mọi request phải có header <code className="bg-gray-800 px-1 rounded text-gray-300">X-Webhook-Secret: &lt;secret&gt;</code>. Request thiếu hoặc sai secret sẽ bị từ chối (401).
            </p>
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={webhookSecret}
                  onChange={e => setWebhookSecret(e.target.value)}
                  placeholder="Chưa có secret — nhấn Tạo mới"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none font-mono pr-20"
                />
                <button
                  onClick={() => setShowSecret(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-white transition-colors"
                >
                  {showSecret ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
              <button onClick={() => copyText(webhookSecret, 'secret')} disabled={!webhookSecret} className="px-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors disabled:opacity-40">
                {copiedKey === 'secret' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={generateSecret}
                className="text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                Tạo secret mới
              </button>
              <button
                onClick={saveSecret}
                disabled={!webhookSecret.trim() || secretSaving}
                className="text-xs px-3 py-2 rounded-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
              >
                {secretSaved ? '✓ Đã lưu' : secretSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>

          {/* API Reference + Templates */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-6 pt-5 pb-0">
              <Sliders size={15} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-sm font-semibold text-white flex-1">Tài liệu API &amp; Template</h2>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                {(['lead', 'provision'] as const).map(t => (
                  <button key={t} onClick={() => setDocTab(t)}
                    className="px-3 py-1.5 transition-colors"
                    style={docTab === t
                      ? { background: 'var(--color-mission-accent)', color: '#000', fontWeight: 600 }
                      : { background: 'transparent', color: '#9ca3af' }}
                  >
                    {t === 'lead' ? 'Capture Lead' : 'Provision'}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 space-y-5">
              {docTab === 'lead' && (
                <>
                  {/* Lead description */}
                  <div className="rounded-lg border border-gray-800 p-3 text-xs text-gray-400 leading-relaxed">
                    <span className="font-semibold text-white">POST</span>{' '}
                    <code className="font-mono" style={{ color: 'var(--color-mission-accent)' }}>{webhookLeadUrl}</code>
                    <p className="mt-1.5">Dùng khi visitor điền form opt-in / quan tâm. Tạo lead trong pipeline — <strong>không</strong> tạo tài khoản đăng nhập.</p>
                  </div>

                  {/* Lead field table */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Các trường dữ liệu</p>
                    <div className="rounded-lg border border-gray-800 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/50">
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Trường</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Kiểu</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Bắt buộc</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Mô tả</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {[
                            { f: 'email',        t: 'string',   r: true,  d: 'Email lead' },
                            { f: 'name',         t: 'string',   r: false, d: 'Họ tên (mặc định: phần trước @)' },
                            { f: 'phone',        t: 'string',   r: false, d: 'Số điện thoại' },
                            { f: 'source',       t: 'string',   r: false, d: 'landing_page | facebook_ad | referral | organic' },
                            { f: 'utm_source',   t: 'string',   r: false, d: 'UTM source parameter' },
                            { f: 'utm_campaign', t: 'string',   r: false, d: 'UTM campaign parameter' },
                            { f: 'utm_medium',   t: 'string',   r: false, d: 'UTM medium parameter' },
                            { f: 'utm_term',     t: 'string',   r: false, d: 'UTM term parameter' },
                            { f: 'utm_content',  t: 'string',   r: false, d: 'UTM content parameter' },
                            { f: 'tags',         t: 'string[]', r: false, d: 'Tags gắn vào lead, VD: ["hot","k3"]' },
                            { f: 'notes',        t: 'string',   r: false, d: 'Ghi chú thêm' },
                            { f: 'page_url',     t: 'string',   r: false, d: 'URL trang visitor điền form' },
                          ].map(row => (
                            <tr key={row.f}>
                              <td className="px-3 py-2 font-mono text-gray-300">{row.f}</td>
                              <td className="px-3 py-2 text-gray-600 font-mono">{row.t}</td>
                              <td className="px-3 py-2">{row.r ? <span className="text-red-400 font-semibold">✓</span> : <span className="text-gray-700">—</span>}</td>
                              <td className="px-3 py-2 text-gray-500">{row.d}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Lead template */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Template — Landing page</p>
                    <div className="relative">
                      <pre className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-xs text-gray-300 font-mono overflow-x-auto leading-relaxed">{
`// Dán vào handler submit form của landing page
const secret = '${webhookSecret || 'YOUR_WEBHOOK_SECRET'}'

async function submitLead(formData) {
  const params = new URLSearchParams(location.search)
  const res = await fetch('${webhookLeadUrl}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': secret,
    },
    body: JSON.stringify({
      name:         formData.name,
      email:        formData.email,
      phone:        formData.phone,
      source:       'landing_page',
      utm_source:   params.get('utm_source'),
      utm_campaign: params.get('utm_campaign'),
      utm_medium:   params.get('utm_medium'),
      tags:         ['k3'],       // tuỳ chỉnh theo chiến dịch
      page_url:     location.href,
    }),
  })
  const data = await res.json()
  if (data.success) {
    // Chuyển trang thank-you hoặc hiển thị thông báo
    console.log('Lead captured:', data.lead_id)
  }
}`}</pre>
                      <button onClick={() => copyText(
                        `const secret = '${webhookSecret || 'YOUR_WEBHOOK_SECRET'}'\n\nasync function submitLead(formData) {\n  const params = new URLSearchParams(location.search)\n  const res = await fetch('${webhookLeadUrl}', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },\n    body: JSON.stringify({\n      name: formData.name, email: formData.email, phone: formData.phone,\n      source: 'landing_page',\n      utm_source: params.get('utm_source'), utm_campaign: params.get('utm_campaign'),\n      page_url: location.href,\n    }),\n  })\n  return res.json()\n}`,
                        'tpl-lead'
                      )} className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-500 hover:text-white transition-colors">
                        {copiedKey === 'tpl-lead' ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {docTab === 'provision' && (
                <>
                  {/* Provision description */}
                  <div className="rounded-lg border border-gray-800 p-3 text-xs text-gray-400 leading-relaxed">
                    <span className="font-semibold text-white">POST</span>{' '}
                    <code className="font-mono" style={{ color: 'var(--color-mission-accent)' }}>{webhookProvisionUrl}</code>
                    <p className="mt-1.5">Dùng khi thanh toán thành công hoặc cần cấp quyền truy cập. Tự tạo tài khoản nếu chưa có, enroll khoá học / grant sản phẩm, ghi đơn hàng và gửi email.</p>
                  </div>

                  {/* Provision field table */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Các trường dữ liệu</p>
                    <div className="rounded-lg border border-gray-800 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/50">
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Trường</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Kiểu</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Bắt buộc</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Mô tả</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {[
                            { f: 'email',            t: 'string',  r: true,  d: 'Email khách hàng' },
                            { f: 'name',             t: 'string',  r: false, d: 'Họ tên (mặc định: phần trước @)' },
                            { f: 'course_id',        t: 'string',  r: false, d: 'UUID khoá học để enroll — xem bảng ID bên dưới' },
                            { f: 'cohort',           t: 'string',  r: false, d: 'Khoá học: K1, K2, K3...' },
                            { f: 'start_date',       t: 'string',  r: false, d: 'Ngày bắt đầu YYYY-MM-DD' },
                            { f: 'product_id',       t: 'string',  r: false, d: 'UUID sản phẩm số để grant — xem bảng ID bên dưới' },
                            { f: 'amount',           t: 'number',  r: false, d: 'Số tiền (VND) — nếu có sẽ tạo đơn hàng' },
                            { f: 'currency',         t: 'string',  r: false, d: 'Mặc định: VND' },
                            { f: 'gateway_ref',      t: 'string',  r: false, d: 'Mã giao dịch — tránh tạo trùng (idempotency)' },
                            { f: 'send_magic_link',  t: 'boolean', r: false, d: 'Gửi email magic link (mặc định: true)' },
                          ].map(row => (
                            <tr key={row.f}>
                              <td className="px-3 py-2 font-mono text-gray-300">{row.f}</td>
                              <td className="px-3 py-2 text-gray-600 font-mono">{row.t}</td>
                              <td className="px-3 py-2">{row.r ? <span className="text-red-400 font-semibold">✓</span> : <span className="text-gray-700">—</span>}</td>
                              <td className="px-3 py-2 text-gray-500">{row.d}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Course + Product ID reference */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">ID Khoá học</p>
                      <div className="rounded-lg border border-gray-800 overflow-hidden">
                        {refLoading ? (
                          <div className="p-4 text-xs text-gray-600">Đang tải...</div>
                        ) : refCourses.length === 0 ? (
                          <div className="p-4 text-xs text-gray-600 italic">Chưa có khoá học nào</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-800 bg-gray-800/50">
                                <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Tên khoá học</th>
                                <th className="text-left px-3 py-1.5 text-gray-500 font-medium">course_id</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {refCourses.map(c => (
                                <tr key={c.id} className="group">
                                  <td className="px-3 py-2 text-gray-300 truncate max-w-[120px]">{c.title}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <code className="text-gray-600 font-mono text-[10px] truncate max-w-[80px]">{c.id}</code>
                                      <button onClick={() => copyText(c.id, `course-${c.id}`)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-white">
                                        {copiedKey === `course-${c.id}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">ID Sản phẩm số</p>
                      <div className="rounded-lg border border-gray-800 overflow-hidden">
                        {refLoading ? (
                          <div className="p-4 text-xs text-gray-600">Đang tải...</div>
                        ) : refProducts.length === 0 ? (
                          <div className="p-4 text-xs text-gray-600 italic">Chưa có sản phẩm nào</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-800 bg-gray-800/50">
                                <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Tên sản phẩm</th>
                                <th className="text-left px-3 py-1.5 text-gray-500 font-medium">product_id</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {refProducts.map(p => (
                                <tr key={p.id} className="group">
                                  <td className="px-3 py-2 text-gray-300 truncate max-w-[120px]">
                                    <span className="text-gray-600 mr-1">[{p.type}]</span>{p.name}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <code className="text-gray-600 font-mono text-[10px] truncate max-w-[80px]">{p.id}</code>
                                      <button onClick={() => copyText(p.id, `product-${p.id}`)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-white">
                                        {copiedKey === `product-${p.id}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Provision template */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Template — Sau thanh toán (SePay / Stripe)</p>
                    <div className="relative">
                      <pre className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-xs text-gray-300 font-mono overflow-x-auto leading-relaxed">{
`// Gọi từ webhook handler của cổng thanh toán (server-side)
// hoặc từ trang thank-you sau khi thanh toán thành công

const secret = '${webhookSecret || 'YOUR_WEBHOOK_SECRET'}'

async function provisionAfterPayment(payment) {
  const res = await fetch('${webhookProvisionUrl}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': secret,
    },
    body: JSON.stringify({
      email:           payment.customerEmail,
      name:            payment.customerName,
      course_id:       'PASTE_COURSE_ID_HERE',   // copy từ bảng ID bên trên
      cohort:          'K3',
      start_date:      '2026-06-01',
      amount:          payment.amount,            // VND
      gateway_ref:     payment.transactionId,     // tránh tạo trùng
      send_magic_link: true,
    }),
  })
  const data = await res.json()
  console.log('Provisioned:', data)
}`}</pre>
                      <button onClick={() => copyText(
                        `const secret = '${webhookSecret || 'YOUR_WEBHOOK_SECRET'}'\n\nasync function provisionAfterPayment(payment) {\n  const res = await fetch('${webhookProvisionUrl}', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },\n    body: JSON.stringify({\n      email: payment.customerEmail, name: payment.customerName,\n      course_id: 'PASTE_COURSE_ID_HERE', cohort: 'K3',\n      amount: payment.amount, gateway_ref: payment.transactionId,\n      send_magic_link: true,\n    }),\n  })\n  return res.json()\n}`,
                        'tpl-provision'
                      )} className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-500 hover:text-white transition-colors">
                        {copiedKey === 'tpl-provision' ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Webhook events log */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={15} style={{ color: 'var(--color-mission-accent)' }} />
                <h2 className="text-sm font-semibold text-white">Lịch sử gần đây</h2>
              </div>
              <button onClick={loadWebhookEvents} className="text-xs text-gray-500 hover:text-white transition-colors">
                {eventsLoading ? 'Đang tải...' : 'Tải lại'}
              </button>
            </div>
            {webhookEvents.length === 0 ? (
              <p className="text-xs text-gray-600 py-4 text-center">Chưa có webhook nào được gọi — nhấn "Tải lại" để kiểm tra</p>
            ) : (
              <div className="space-y-1.5">
                {webhookEvents.map(ev => (
                  <div key={ev.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.processed ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-xs font-mono text-gray-400 shrink-0">{ev.source}</span>
                    <span className="text-xs text-gray-600 flex-1 truncate">
                      {ev.payload?.email || ev.payload?.name || '—'}
                    </span>
                    {ev.error && <span className="text-xs text-red-500 shrink-0 truncate max-w-[120px]">{ev.error}</span>}
                    <span className="text-xs text-gray-700 shrink-0">
                      {new Date(ev.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {activeTab === 'email' && (
        <div className="space-y-6">

          {/* Resend API Key */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <KeyRound size={16} style={{ color: 'var(--color-mission-accent)' }} />
                <h2 className="text-sm font-semibold text-white">Resend API Key</h2>
              </div>
              <a
                href="https://resend.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
              >
                Tạo tài khoản miễn phí <ExternalLink size={11} />
              </a>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Dùng để gửi email chào mừng có thương hiệu khi tạo khách hàng theo mode "Đặt mật khẩu". Free 3,000 email/tháng.
            </p>

            <div className="space-y-3">
              <input
                type="password"
                value={resendKey}
                onChange={e => setResendKey(e.target.value)}
                placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />

              {resendKey && (
                <div className="rounded-lg p-3 text-xs" style={{
                  backgroundColor: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.06)',
                  border: '1px solid rgba(var(--color-mission-accent-rgb,182,255,0),0.2)',
                  color: 'var(--color-mission-accent)',
                }}>
                  Email sẽ được gửi từ: <strong>{settings?.title || 'App'} &lt;onboarding@resend.dev&gt;</strong>
                  <br />
                  <span className="opacity-70">Để dùng domain riêng, verify domain tại resend.com → Domains</span>
                </div>
              )}

              <button
                onClick={handleSaveResendKey}
                disabled={resendKeySaving || !resendKey}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
              >
                {resendKeySaved ? <Check size={13} /> : null}
                {resendKeySaving ? 'Đang lưu...' : resendKeySaved ? 'Đã lưu!' : 'Lưu API Key'}
              </button>
            </div>
          </div>

          {/* Supabase SMTP Guide */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Mail size={16} className="text-blue-400" />
              <h2 className="text-sm font-semibold text-white">Supabase Custom SMTP</h2>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Cấu hình để tất cả email auth của Supabase (magic link, reset password) cũng gửi từ tên app của bạn thay vì "Supabase". Copy-paste các giá trị sau vào{' '}
              <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                Supabase Dashboard
              </a>{' '}
              → Project Settings → Authentication → SMTP Settings.
            </p>

            {[
              { label: 'Host', value: 'smtp.resend.com' },
              { label: 'Port', value: '465' },
              { label: 'Username', value: 'resend' },
              { label: 'Password', value: resendKey || 're_your_api_key_here' },
              { label: 'Sender name', value: settings?.title || 'Tên app của bạn' },
              { label: 'Sender email', value: 'onboarding@resend.dev' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3 py-2.5 border-b border-gray-800 last:border-0">
                <span className="text-xs text-gray-500 w-28 shrink-0">{row.label}</span>
                <code className="flex-1 text-xs text-white font-mono truncate">{row.value}</code>
                <button
                  onClick={() => copySMTP(row.value, row.label)}
                  className="shrink-0 text-gray-600 hover:text-white transition-colors"
                >
                  {smtpCopied === row.label ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
              </div>
            ))}
          </div>

        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-8">
          <AIProvidersView />
          <div className="border-t border-gray-800 pt-6">
            <h3 className="text-sm font-semibold text-white mb-1">OAuth (ChatGPT Codex)</h3>
            <p className="text-xs text-gray-500 mb-4">Kết nối bằng tài khoản ChatGPT của bạn (dùng subscription, không tính API cost).</p>
            <AISettingsView />
          </div>
        </div>
      )}
      {activeTab === 'funnel-types' && <FunnelTypesView />}
      {activeTab === 'copy-formulas' && <CopyFormulasView />}
      {activeTab === 'health' && <HealthCheckTab />}
      {activeTab === 'api-tokens' && <APITokensView />}

      {activeTab === 'general' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sliders size={16} style={{ color: 'var(--color-mission-accent)' }} />
              <h2 className="text-sm font-semibold text-white">App Settings</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tên ứng dụng</label>
                <input
                  value={appTitle}
                  onChange={e => setAppTitle(e.target.value)}
                  placeholder="MiniCRM"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Logo URL</label>
                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <input
                      value={appLogoUrl}
                      onChange={e => setAppLogoUrl(e.target.value)}
                      placeholder="https://... (PNG, SVG, JPG)"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                    />
                    <p className="text-[11px] text-gray-600 mt-1">Để trống → hiện chữ cái đầu của tên app</p>
                  </div>
                  {appLogoUrl && (
                    <img
                      src={appLogoUrl}
                      alt="Logo preview"
                      className="w-10 h-10 rounded-lg object-contain bg-gray-800 border border-gray-700 shrink-0"
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Màu chính</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={e => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5"
                  />
                  <input
                    value={primaryColor}
                    onChange={e => setPrimaryColor(e.target.value)}
                    placeholder="#6366f1"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Theme picker */}
              <div>
                <label className="block text-xs text-gray-500 mb-3 flex items-center gap-1.5">
                  <Palette size={12} /> Theme portal
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {(THEMES).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setSelectedTheme(t.id)
                        setPrimaryColor(t.defaultAccent)
                        document.body.dataset.theme = t.id
                        // Live preview accent
                        const hex = t.defaultAccent.replace('#', '')
                        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16)
                        document.documentElement.style.setProperty('--color-mission-accent', t.defaultAccent)
                        if (!isNaN(r)) document.documentElement.style.setProperty('--color-mission-accent-rgb', `${r},${g},${b}`)
                      }}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all group ${
                        selectedTheme === t.id ? 'border-white scale-105' : 'border-transparent hover:border-gray-600'
                      }`}
                    >
                      {/* Mini preview */}
                      <div
                        className="h-14 w-full relative"
                        style={{ background: t.previewBg }}
                      >
                        {/* Pattern overlay */}
                        <div className="absolute inset-0" style={{ background: t.previewPattern, opacity: 0.6 }} />
                        {/* Accent dot */}
                        <div className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: t.accent }} />
                        {/* Selected check */}
                        {selectedTheme === t.id && (
                          <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white flex items-center justify-center">
                            <Check size={10} className="text-black" />
                          </div>
                        )}
                      </div>
                      <div
                        className="text-[10px] font-medium py-1 text-center"
                        style={{ background: t.labelBg, color: t.labelColor }}
                      >
                        {t.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSaveGeneral}
                  disabled={generalSaving}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >
                  {generalSaved ? <Check size={14} className="text-emerald-400" /> : null}
                  {generalSaving ? 'Đang lưu...' : generalSaved ? 'Đã lưu!' : 'Lưu cài đặt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export default SettingsView
