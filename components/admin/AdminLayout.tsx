import React, { useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { LayoutDashboard, Users, List, GitBranch, ShoppingCart, Package, Settings, LogOut, Terminal, GraduationCap, Share2, Sparkles } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { useConfig } from '../../contexts/ConfigContext'
import Dashboard from './Dashboard'
import StudentsView from './StudentsView'
import LeadsTable from './LeadsTable'
import LeadsPipeline from './LeadsPipeline'
import OrdersView from './OrdersView'
import ProductsLayout from './ProductsLayout'
import SettingsView from './SettingsView'
import AffiliatesView from './AffiliatesView'
const AIFunnelsView = React.lazy(() => import('./AIFunnelsView'))

const NAV_ITEMS = [
  { to: '/admin',          label: 'Tổng quan',      icon: LayoutDashboard, end: true },
  { to: '/admin/leads',    label: 'KHTN',           icon: List },
  { to: '/admin/pipeline', label: 'Quy trình sale', icon: GitBranch },
  { to: '/admin/orders',   label: 'Đơn hàng',       icon: ShoppingCart },
  { to: '/admin/students', label: 'Khách hàng',     icon: Users },
  { to: '/admin/products',   label: 'Sản phẩm',    icon: Package },
  { to: '/admin/affiliates', label: 'Affiliate',    icon: Share2 },
  { to: '/admin/ai-funnels', label: 'AI Funnels',   icon: Sparkles },
  { to: '/admin/settings', label: 'Cài đặt',        icon: Settings },
]

const AdminLayout: React.FC = () => {
  const navigate = useNavigate()
  const { settings, updateSettings } = useConfig()

  // Load app settings on mount để apply theme color
  useEffect(() => {
    supabase.from('app_settings').select('*').then(({ data }) => {
      if (!data) return
      const map: Record<string, any> = {}
      data.forEach((row: any) => { map[row.key] = row.value?.value ?? row.value })
      updateSettings({
        title:          map['title']        || 'MiniCRM',
        description:    map['description']  || '',
        primaryColor:   map['primaryColor'] || '#B6FF00',
        logoUrl:        map['logoUrl'],
        guideVideoUrl:  map['guideVideoUrl'],
        supportZaloLink: map['supportZaloLink'],
      })
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  // Inline style helpers dùng CSS variable
  const accentText  = { color: 'var(--color-mission-accent)' }
  const accentBg    = { backgroundColor: 'var(--color-mission-accent)', color: '#000' }
  const accentBgSoft = {
    backgroundColor: 'rgba(var(--color-mission-accent-rgb, 182, 255, 0), 0.12)',
    borderColor:     'rgba(var(--color-mission-accent-rgb, 182, 255, 0), 0.3)',
    color:           'var(--color-mission-accent)',
  }

  const appTitle = settings?.title || 'Admin'

  return (
    <div className="h-screen w-full bg-gray-950 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">

        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-gray-800">
          <div
            className="w-8 h-8 flex items-center justify-center font-bold text-sm"
            style={accentBg}
          >
            <Terminal size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white uppercase tracking-widest truncate">{appTitle}</p>
            <p className="text-[10px] text-gray-500">Portal Management</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
            >
              {({ isActive }) => (
                <div
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all cursor-pointer border"
                  style={isActive ? accentBgSoft : {
                    color: '#9ca3af',
                    borderColor: 'transparent',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.color = '#fff'
                      ;(e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.color = '#9ca3af'
                      ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-gray-800 space-y-1">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
          >
            <GraduationCap size={16} />
            Xem portal học viên
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-950/30 transition-all"
          >
            <LogOut size={16} />
            Đăng xuất
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="students"   element={<StudentsView />} />
          <Route path="leads"      element={<LeadsTable />} />
          <Route path="pipeline"   element={<LeadsPipeline />} />
          <Route path="orders"     element={<OrdersView />} />
          <Route path="products/*"  element={<ProductsLayout />} />
          <Route path="affiliates" element={<AffiliatesView />} />
          <Route path="ai-funnels" element={<AIFunnelsView />} />
          <Route path="settings"   element={<SettingsView />} />
          <Route path="*"          element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default AdminLayout
