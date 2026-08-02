import React, { useEffect, useState } from 'react'
import { Copy, Check, Webhook, Mail, Zap, Info } from 'lucide-react'

const DeliverSettings: React.FC = () => {
  const [copied, setCopied] = useState(false)
  const [supabaseUrl, setSupabaseUrl] = useState('')
  const [welcomeEmailEnabled, setWelcomeEmailEnabled] = useState(true)
  const [autoProvision, setAutoProvision] = useState(true)
  const [defaultCohort, setDefaultCohort] = useState('K1')
  const [startDateOffset, setStartDateOffset] = useState(0)

  useEffect(() => {
    setSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || '')
  }, [])

  const webhookUrl = supabaseUrl
    ? `${supabaseUrl}/functions/v1/webhook-sepay`
    : 'https://your-project.supabase.co/functions/v1/webhook-sepay'

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-indigo-600' : 'bg-gray-700'}`}
    >
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${value ? 'left-6' : 'left-1'}`} />
    </button>
  )

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Deliver Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Configure automatic student provisioning</p>
      </div>

      <div className="space-y-6">
        {/* SePay Webhook */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Webhook size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">SePay Webhook</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Configure this URL in your SePay dashboard. When a payment is received, SePay will POST to this endpoint and automatically create a student account.
          </p>

          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1.5">Webhook URL</label>
            <div className="flex gap-2">
              <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-xs text-emerald-400 font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                {webhookUrl}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div className="bg-indigo-950/30 border border-indigo-800/30 rounded-lg p-3">
            <div className="flex gap-2">
              <Info size={14} className="text-indigo-400 shrink-0 mt-0.5" />
              <div className="text-xs text-indigo-300 space-y-1">
                <p><strong>Payment description format:</strong> <code className="bg-indigo-950 px-1 rounded">THANHTOAN-K1 student@email.com</code></p>
                <p>Replace <code className="bg-indigo-950 px-1 rounded">K1</code> with the cohort code. The email will be used to create the student account.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Auto-Provision Rules */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Auto-Provision Rules</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Auto-provision on payment</p>
                <p className="text-xs text-gray-500">Create student account when webhook received</p>
              </div>
              <Toggle value={autoProvision} onChange={setAutoProvision} />
            </div>

            <div className="border-t border-gray-800 pt-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Default Cohort (if not in description)</label>
                <input
                  value={defaultCohort}
                  onChange={e => setDefaultCohort(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-32 focus:outline-none focus:border-indigo-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Start date offset (days from payment)</label>
                <input
                  type="number"
                  value={startDateOffset}
                  onChange={e => setStartDateOffset(Number(e.target.value))}
                  min={0}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-32 focus:outline-none focus:border-indigo-600"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Email Settings */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Mail size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Email Templates</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Welcome email</p>
                <p className="text-xs text-gray-500">Send magic link to new students on provisioning</p>
              </div>
              <Toggle value={welcomeEmailEnabled} onChange={setWelcomeEmailEnabled} />
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-widest">Email Preview</p>
              <p className="text-sm text-white font-medium mb-1">Chào mừng bạn đến với {'{Course Name}'}!</p>
              <p className="text-xs text-gray-400">Click vào link dưới để truy cập khóa học và đặt mật khẩu cho tài khoản của bạn.</p>
              <p className="text-xs text-gray-600 mt-2 italic">
                Email template được cấu hình trong Supabase Dashboard → Authentication → Email Templates
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DeliverSettings
