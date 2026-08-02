import React, { createContext, useContext, useState, useEffect } from 'react'
import { CourseSettings, Profile, PortalTheme } from '../types'
import { supabase } from '../services/supabase'

const THEME_DEFAULT: PortalTheme = 'cyberpunk'

function applyTheme(theme: PortalTheme | undefined) {
  document.body.dataset.theme = theme || THEME_DEFAULT
}

// Legacy config shape — kept for backward compatibility with CourseBuilder, LeaderboardView
interface LegacyConfig {
  apiEndpoint: string
  mode: 'LEARNER' | 'ADMIN' | 'SETUP'
}

interface ConfigContextType {
  profile: Profile | null
  settings: CourseSettings | null
  isLoading: boolean
  updateSettings: (settings: CourseSettings) => void
  setProfile: (profile: Profile | null) => void
  // Legacy fields for backward compat
  config: LegacyConfig | null
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined)

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<CourseSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Apply default theme immediately (overridden after DB loads)
  useEffect(() => { applyTheme(THEME_DEFAULT) }, [])

  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 8000)
    let currentProfileId: string | null = null

    // Helper: fetch profile NHẸ NHÀNG — không signOut nếu fail
    const fetchProfile = async (userId: string) => {
      try {
        const { data } = await supabase.from('customers').select('*').eq('id', userId).maybeSingle()
        if (data) {
          currentProfileId = data.id
          setProfile(data)
        } else {
          console.warn('[Config] No customer row for user', userId, '— session valid nhưng chưa có profile')
          // KHÔNG signOut — có thể profile chưa được tạo, hoặc temporary RLS issue
        }
      } catch (e) {
        console.warn('[Config] Profile fetch error (giữ session):', e)
        // KHÔNG signOut, KHÔNG clear profile — giữ state cũ
      }
    }

    // Load app_settings (title, primaryColor, theme) sớm — trước cả auth
    supabase.from('app_settings').select('key, value').then(({ data }) => {
      if (!data) return
      const map: Record<string, any> = {}
      data.forEach((r: any) => { map[r.key] = r.value })
      const loaded: CourseSettings = {
        title: map['title']?.value || 'MiniCRM',
        description: map['description']?.value || '',
        primaryColor: map['primaryColor']?.value || '#B6FF00',
        logoUrl: map['logoUrl']?.value || '',
        guideVideoUrl: map['guideVideoUrl']?.value || '',
        supportZaloLink: map['supportZaloLink']?.value || '',
        theme: (map['theme']?.value as PortalTheme) || THEME_DEFAULT,
      }
      setSettings(loaded)
      // Apply primary color
      const hex = loaded.primaryColor.replace('#', '')
      const r = parseInt(hex.slice(0,2), 16), g = parseInt(hex.slice(2,4), 16), b = parseInt(hex.slice(4,6), 16)
      document.documentElement.style.setProperty('--color-mission-accent', loaded.primaryColor)
      if (!isNaN(r)) document.documentElement.style.setProperty('--color-mission-accent-rgb', `${r},${g},${b}`)
      // Apply theme
      applyTheme(loaded.theme)
    })

    // 1. Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) await fetchProfile(session.user.id)
      clearTimeout(timeout)
      setIsLoading(false)
    }).catch(() => { clearTimeout(timeout); setIsLoading(false) })

    // 2. Auth state listener — CHỈ xử lý events QUAN TRỌNG
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // ❌ INITIAL_SESSION: đã handle ở trên
      // ❌ TOKEN_REFRESHED: chỉ refresh token, profile KHÔNG đổi — đừng query lại
      // ❌ USER_UPDATED: user metadata đổi, không cần re-fetch profile
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return

      if (event === 'SIGNED_OUT' || !session?.user) {
        currentProfileId = null
        setProfile(null)
        return
      }

      if (event === 'SIGNED_IN') {
        // Tránh re-fetch nếu cùng user (StrictMode hoặc duplicate event)
        if (session.user.id === currentProfileId) return
        fetchProfile(session.user.id)
      }
    })

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  const updateSettings = (newSettings: CourseSettings) => {
    setSettings(newSettings)
    if (newSettings.primaryColor) {
      const hex = newSettings.primaryColor.replace('#', '')
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      document.documentElement.style.setProperty('--color-mission-accent', newSettings.primaryColor)
      if (!isNaN(r)) {
        document.documentElement.style.setProperty('--color-mission-accent-rgb', `${r}, ${g}, ${b}`)
      }
    }
    if (newSettings.theme) applyTheme(newSettings.theme)
  }

  // Legacy config: always null in Supabase mode (no apiEndpoint needed)
  const config: LegacyConfig | null = null

  return (
    <ConfigContext.Provider value={{ profile, settings, isLoading, updateSettings, setProfile, config }}>
      {children}
    </ConfigContext.Provider>
  )
}

export const useConfig = () => {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider')
  return ctx
}
