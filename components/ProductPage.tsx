import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Lock, Loader2, AlertCircle, ExternalLink, ArrowLeft, FileText, Layout, Wrench, Video, Package } from 'lucide-react'
import { supabase } from '../services/supabase'
import { fetchProductBySlug, checkProductAccess } from '../services/api'
import { Product } from '../types'
import { useConfig } from '../contexts/ConfigContext'

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; btnText: string }> = {
  ebook:    { label: 'Ebook',    icon: <FileText size={14} />,  btnText: 'Đọc ngay' },
  template: { label: 'Template', icon: <Layout size={14} />,    btnText: 'Dùng template' },
  toolkit:  { label: 'Toolkit',  icon: <Wrench size={14} />,    btnText: 'Mở toolkit' },
  video:    { label: 'Video',    icon: <Video size={14} />,      btnText: 'Xem ngay' },
  other:    { label: 'Tài liệu', icon: <Package size={14} />,   btnText: 'Truy cập' },
}

const ProductPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { settings } = useConfig()

  const [product, setProduct] = useState<Product | null>(null)
  const [allowed, setAllowed] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!slug) return
      setLoading(true)
      const p = await fetchProductBySlug(slug)
      setProduct(p)
      if (!p) { setLoading(false); return }

      const { data: { user } } = await supabase.auth.getUser()
      setIsLoggedIn(!!user)

      if (p.access_type === 'password') {
        const cached = localStorage.getItem(`product-unlocked-${p.id}`)
        if (cached === p.password) { setAllowed(true); setLoading(false); return }
      }

      const access = await checkProductAccess(p, user?.id)
      setAllowed(access.allowed)
      setReason(access.reason || null)
      setLoading(false)
    }
    load()
  }, [slug])

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!product) return
    if (passwordInput === product.password) {
      localStorage.setItem(`product-unlocked-${product.id}`, product.password || '')
      setAllowed(true)
    } else {
      setPasswordError('Mật khẩu không đúng')
    }
  }

  const appName = settings?.title || 'Portal'
  const logoUrl = settings?.logoUrl
  const meta = TYPE_META[product?.type || 'other'] || TYPE_META.other

  // ── Shared header ──────────────────────────────────────────
  const Header = () => (
    <header className="h-14 flex items-center justify-between px-6 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)', backgroundColor: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-center gap-2.5">
        {logoUrl ? (
          <img src={logoUrl} alt={appName} className="h-7 w-auto object-contain" />
        ) : (
          <div
            className="w-7 h-7 rounded-sm flex items-center justify-center text-black font-black text-sm"
            style={{ backgroundColor: 'var(--color-mission-accent, #6366f1)' }}
          >
            {appName[0].toUpperCase()}
          </div>
        )}
        <span className="font-semibold text-sm text-gray-800">{appName}</span>
      </div>
      {isLoggedIn && (
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={13} />
          Quay lại portal
        </button>
      )}
    </header>
  )

  // ── Loading ────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="animate-spin text-gray-400" size={28} />
    </div>
  )

  // ── Not found ──────────────────────────────────────────────
  if (!product) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3 text-center p-8">
      <AlertCircle size={32} className="text-gray-400" />
      <p className="text-gray-500 text-sm">Không tìm thấy sản phẩm</p>
    </div>
  )

  // ── Password gate ──────────────────────────────────────────
  if (product.access_type === 'password' && !allowed) return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] p-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-sm">
          {product.cover_image_url && (
            <img src={product.cover_image_url} alt={product.name}
              className="w-16 h-16 object-cover rounded-xl mb-5 mx-auto" />
          )}
          <div className="text-center mb-6">
            <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest font-semibold text-gray-400 mb-2">
              {meta.icon} {meta.label}
            </span>
            <h1 className="text-lg font-bold text-gray-900">{product.name}</h1>
            <p className="text-sm text-gray-500 mt-1">Nhập mật khẩu để truy cập</p>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <input
              type="password"
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setPasswordError('') }}
              placeholder="Mật khẩu"
              autoFocus
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{ '--tw-ring-color': 'var(--color-mission-accent, #6366f1)' } as any}
            />
            {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
            <button type="submit"
              className="w-full py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--color-mission-accent, #6366f1)', color: '#fff' }}>
              Mở khóa
            </button>
          </form>
        </div>
      </div>
    </div>
  )

  // ── Access denied ──────────────────────────────────────────
  if (!allowed) {
    const msg: Record<string, string> = {
      login_required: 'Vui lòng đăng nhập để xem nội dung này',
      course_not_enrolled: 'Bạn cần đăng ký khóa học để truy cập',
      not_assigned: 'Nội dung này chưa được chia sẻ với bạn',
    }
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] gap-4 text-center p-8">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <Lock size={22} className="text-gray-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-800 mb-1">{product.name}</h1>
            <p className="text-sm text-gray-500">{msg[reason || ''] || 'Không có quyền truy cập'}</p>
          </div>
          {reason === 'login_required' && (
            <a href="/"
              className="px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90"
              style={{ backgroundColor: 'var(--color-mission-accent, #6366f1)', color: '#fff' }}>
              Đăng nhập
            </a>
          )}
        </div>
      </div>
    )
  }

  // ── Product page ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-2xl mx-auto px-4 py-12">

        {/* Cover image */}
        {product.cover_image_url && (
          <img
            src={product.cover_image_url}
            alt={product.name}
            className="w-full aspect-[16/9] object-cover rounded-2xl mb-8 shadow-sm"
          />
        )}

        {/* Type badge */}
        <div className="flex items-center gap-1.5 mb-3">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full"
            style={{
              backgroundColor: 'rgba(var(--color-mission-accent-rgb,99,102,241),0.12)',
              color: 'var(--color-mission-accent, #6366f1)',
            }}
          >
            {meta.icon}
            {meta.label}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-900 mb-3 leading-tight">
          {product.name}
        </h1>

        {/* Description */}
        {product.description && (
          <p className="text-base text-gray-500 leading-relaxed mb-8">
            {product.description}
          </p>
        )}

        {/* CTA */}
        {product.delivery_url ? (
          <a
            href={product.delivery_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-xl text-base font-semibold shadow-sm hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-mission-accent, #6366f1)', color: product.type === 'ebook' ? '#fff' : '#000' }}
          >
            <ExternalLink size={16} />
            {meta.btnText}
          </a>
        ) : (
          <div className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-dashed border-gray-300 text-sm text-gray-400">
            <Package size={15} />
            Link chưa được cấu hình
          </div>
        )}

      </main>
    </div>
  )
}

export default ProductPage
