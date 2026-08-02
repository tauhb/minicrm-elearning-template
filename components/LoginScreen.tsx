import React, { useState, useEffect } from 'react'
import { Terminal, Lock, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../services/supabase'
import { Profile } from '../types'

interface LoginScreenProps {
  onLoginSuccess: (profile: Profile) => void
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [appTitle, setAppTitle] = useState('MiniCRM')

  // Lấy app title từ DB (cho phép custom branding ở login screen)
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'title').maybeSingle()
      .then(({ data }) => {
        const t = data?.value?.value
        if (t) setAppTitle(t)
      })
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      console.log('[LOGIN] Step 1: signInWithPassword...')
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) {
        console.error('[LOGIN] Auth error:', authError)
        if (authError.message?.toLowerCase().includes('invalid')) {
          setError('Email hoặc mật khẩu không đúng.')
        } else {
          setError(`Lỗi đăng nhập: ${authError.message}`)
        }
        return
      }
      if (!data.user) {
        setError('Không nhận được thông tin user. Vui lòng thử lại.')
        return
      }
      console.log('[LOGIN] Step 2: fetching customer profile for', data.user.id)
      const { data: profileData, error: profileErr } = await supabase
        .from('customers')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle()
      if (profileErr) {
        console.error('[LOGIN] Profile error:', profileErr)
        setError(`Lỗi tải profile: ${profileErr.message}`)
        return
      }
      if (!profileData) {
        setError('Tài khoản chưa có profile. Liên hệ admin để được hỗ trợ.')
        return
      }
      console.log('[LOGIN] Success, profile:', profileData)
      onLoginSuccess(profileData)
    } catch (err: any) {
      console.error('[LOGIN] Unexpected error:', err)
      setError(`Lỗi mạng: ${err?.message || 'Không xác định'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-black text-gray-200 font-mono flex items-center justify-center p-4 grid-bg relative overflow-hidden">
      <div className="scanlines"></div>

      {/* Container */}
      <div className="w-full max-w-md bg-neutral-900/80 border border-mission-accent/30 shadow-[0_0_50px_rgba(182,255,0,0.1)] backdrop-blur-sm relative z-10">

        {/* Header */}
        <div className="bg-neutral-900 border-b border-mission-accent/30 p-4 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
          <span className="ml-auto text-[10px] text-neutral-500 uppercase">v3.0</span>
        </div>

        {/* Content */}
        <div className="p-8">
          <div className="mb-8 text-center">
            <div className="w-16 h-16 bg-mission-accent/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-mission-accent/50 animate-pulse">
              <Terminal size={32} className="text-mission-accent" />
            </div>
            <h1 className="text-xl font-bold text-white uppercase tracking-widest mb-2">{appTitle}</h1>
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Vui lòng xác thực danh tính</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-mission-accent font-bold">Email</label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black border border-neutral-700 p-3 pl-10 text-white focus:border-mission-accent focus:outline-none focus:ring-1 focus:ring-mission-accent transition-all font-mono"
                  placeholder="email@domain.com"
                />
                <ChevronRight size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-mission-accent font-bold">Mật Khẩu</label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black border border-neutral-700 p-3 pl-10 text-white focus:border-mission-accent focus:outline-none focus:ring-1 focus:ring-mission-accent transition-all font-mono"
                  placeholder="******"
                />
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 p-3 border border-red-500/20">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className={`w-full py-4 text-xs font-bold uppercase tracking-widest transition-all
                ${isLoading || !email || !password
                  ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                  : 'bg-mission-accent text-black hover:bg-[#a3e600] shadow-[0_0_20px_rgba(182,255,0,0.3)]'
                }
              `}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> ĐANG KẾT NỐI...
                </span>
              ) : (
                '>> TRUY CẬP HỆ THỐNG'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
