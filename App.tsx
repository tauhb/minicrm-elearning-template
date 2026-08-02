import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useProgress } from './hooks/useProgress'
import { GameMap } from './components/GameMap'
import { QuestView } from './components/QuestView'
import { LoginScreen } from './components/LoginScreen'
import { SideMenu } from './components/SideMenu'
import { CourseBuilder } from './components/CourseBuilder'
import CourseHub from './components/CourseHub'
import ModuleView from './components/ModuleView'
import { LeaderboardView } from './components/LeaderboardView'
import { Quest, Zone, Profile, Student, CustomerCourse } from './types'
import { fetchGameData, calculateMaxAllowedDay, processGoogleDriveUrl, fetchPrimaryEnrollment, fetchEnrollmentsByCustomer, fetchProductsAssignedTo, fetchCourseLayout } from './services/api'
import { Loader2, RotateCcw, Zap, LogOut, Flame, Menu, Trophy, HelpCircle, X, MessageCircle, LayoutDashboard, BookOpen, Share2 } from 'lucide-react'
import { playSound } from './services/sound'
import { addDays, format } from 'date-fns'
import { ConfigProvider, useConfig } from './contexts/ConfigContext'
import { DialogProvider, useDialog } from './contexts/DialogContext'
import { supabase } from './services/supabase'
import { ErrorBoundary } from './components/ErrorBoundary'
import ProductPage from './components/ProductPage'
import { PoweredBy } from './components/ui/PoweredBy'

// Lazy import AdminPanel
const AdminPanel = React.lazy(() => import('./components/admin/AdminLayout'))
const AffiliatePortal = React.lazy(() => import('./components/AffiliatePortal'))

// Helper: convert Profile + Enrollment to Student-compatible shape for legacy components
const profileToStudent = (profile: Profile, enrollment: CustomerCourse | null): Student => ({
  student_code: profile.id,
  display_name: profile.display_name,
  start_date: enrollment?.start_date || '',
  khoa: enrollment?.cohort || ''
})

const StudentPortal = () => {
  const { profile, settings, updateSettings } = useConfig()
  const { confirm: showConfirm, alert: showAlert } = useDialog()
  const navigate = useNavigate()
  const [quests, setQuests] = useState<Quest[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [isDataLoaded, setIsDataLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [maxAllowedDay, setMaxAllowedDay] = useState(1)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null)
  const [primaryEnrollment, setPrimaryEnrollment] = useState<CustomerCourse | null>(null)
  const [showHub, setShowHub] = useState(false)   // true = CourseHub, false = game map
  const [totalEnrollments, setTotalEnrollments] = useState(0)
  const [totalProducts, setTotalProducts] = useState(0)
  const [layoutMode, setLayoutMode] = useState<'journey' | 'module'>('journey')
  const [isAffiliate, setIsAffiliate] = useState(false)

  const { progress, isLoaded: isProgressLoaded, completeTask, completeQuest, toggleVideoWatched, addSubmission } = useProgress()

  // Check affiliate status on mount
  useEffect(() => {
    if (!profile) return
    supabase
      .from('affiliates')
      .select('id, status')
      .eq('customer_id', profile.id)
      .eq('status', 'approved')
      .maybeSingle()
      .then(({ data }) => setIsAffiliate(!!data))
  }, [profile?.id])

  useEffect(() => {
    if (!profile) return
    setIsDataLoaded(false)

    // Kiểm tra số lượng khoá + sản phẩm để quyết định có hiện Hub không
    Promise.all([
      fetchEnrollmentsByCustomer(profile.id),
      fetchProductsAssignedTo(profile.id),
    ]).then(([enrs, prods]) => {
      setTotalEnrollments(enrs.length)
      setTotalProducts(prods.length)

      const needsHub = enrs.length > 1 || prods.length > 0
      if (needsHub) {
        // Có nhiều khoá / sản phẩm → hiện hub trước
        setShowHub(true)
        // Vẫn load khoá đầu tiên (primary) làm nền
        const primary = enrs.find(e => e.status === 'active') || enrs[0] || null
        setPrimaryEnrollment(primary)
        if (primary?.start_date) setMaxAllowedDay(calculateMaxAllowedDay(primary.start_date))
        return fetchGameData(profile.id, primary?.cohort || undefined)
      } else {
        // Chỉ có 1 khoá → vào thẳng game map
        setShowHub(false)
        const primary = enrs[0] || null
        setPrimaryEnrollment(primary)
        if (primary?.start_date) setMaxAllowedDay(calculateMaxAllowedDay(primary.start_date))
        return fetchGameData(profile.id, primary?.cohort || undefined)
      }
    }).then(async data => {
      if (!data) return
      setZones(data.zones)
      setQuests(data.quests)
      updateSettings(data.settings)
      // Fetch layout cho khoá học đang active
      const activeEnr = await fetchPrimaryEnrollment(profile!.id)
      if (activeEnr?.course_id) {
        const mode = await fetchCourseLayout(activeEnr.course_id)
        setLayoutMode(mode)
      }
      setIsDataLoaded(true)
    }).catch(err => {
      console.error(err)
      setLoadError('Lỗi tải dữ liệu. Vui lòng tải lại trang.')
      setIsDataLoaded(true)
    })
  }, [profile])

  const handleSelectCourse = async (enrollment: CustomerCourse) => {
    setIsDataLoaded(false)
    setPrimaryEnrollment(enrollment)
    if (enrollment.start_date) setMaxAllowedDay(calculateMaxAllowedDay(enrollment.start_date))
    const [data, mode] = await Promise.all([
      fetchGameData(profile!.id, enrollment.cohort || undefined),
      enrollment.course_id ? fetchCourseLayout(enrollment.course_id) : Promise.resolve('journey' as const),
    ])
    setZones(data.zones)
    setQuests(data.quests)
    setLayoutMode(mode)
    setShowHub(false)
    setIsDataLoaded(true)
  }

  const handleLogout = async () => {
    playSound('CLICK')
    const ok = await showConfirm({
      title: 'Đăng xuất',
      message: 'Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?',
      confirmText: 'Đăng xuất',
    })
    if (ok) {
      await supabase.auth.signOut()
      localStorage.clear()
    }
  }

  const handleQuestSelect = (quest: Quest) => {
    const isAdmin = profile?.role === 'admin'
    const isUnlockedByProgress = quest.id <= progress.currentDay
    const isUnlockedByTime = quest.id <= maxAllowedDay
    const isCompleted = progress.completedQuests.includes(quest.id)

    if (isAdmin || isCompleted || (isUnlockedByProgress && isUnlockedByTime)) {
      playSound('OPEN')
      setSelectedQuest(quest)
    } else {
      playSound('CLICK')
      if (!isUnlockedByTime && primaryEnrollment?.start_date) {
        try {
          const unlockDate = addDays(new Date(primaryEnrollment.start_date), quest.id - 1)
          showAlert({
            title: `Ngày ${quest.id} — Chưa mở`,
            message: `Bài học này sẽ mở khoá vào ngày\n${format(unlockDate, 'dd/MM/yyyy')}`,
            variant: 'warning',
          })
        } catch {
          showAlert({
            title: `Ngày ${quest.id} — Chưa mở`,
            message: `Nội dung sẽ mở vào ngày thứ ${quest.id} tính từ ngày bắt đầu khoá học.`,
            variant: 'warning',
          })
        }
      } else {
        showAlert({
          title: 'Chưa đến lượt',
          message: 'Vui lòng hoàn thành các bài học trước để mở khoá bài này.',
          variant: 'warning',
        })
      }
    }
  }

  const handleReset = async () => {
    playSound('CLICK')
    const ok = await showConfirm({
      title: 'Reset tiến độ',
      message: 'Hành động này sẽ xoá toàn bộ tiến độ học tập của bạn và không thể hoàn tác.',
      variant: 'danger',
      confirmText: 'Xoá tiến độ',
    })
    if (ok) {
      localStorage.clear()
      window.location.reload()
    }
  }

  if (!isDataLoaded || !isProgressLoaded) {
    return (
      <div className="flex flex-col h-screen w-full items-center justify-center text-mission-accent gap-4">
        <Loader2 className="w-10 h-10 animate-spin" />
        <div className="text-center">
          <p className="font-mono text-sm uppercase tracking-widest mb-2">ĐANG ĐỒNG BỘ DỮ LIỆU...</p>
          <p className="text-xs text-neutral-500 font-mono">Xin chào, {profile?.display_name}</p>
        </div>
        {loadError && <p className="text-red-500 text-xs font-mono mt-4">{loadError}</p>}
      </div>
    )
  }

  const totalQuests = quests.length
  const completedCount = progress.completedQuests.length
  const percentComplete = totalQuests > 0 ? Math.round((completedCount / totalQuests) * 100) : 0
  const actualCurrentDay = Math.min(progress.currentDay, maxAllowedDay)
  const currentQuestData = quests.find(q => q.id === actualCurrentDay)
  const streak = progress.streak || 0
  const isAdmin = profile?.role === 'admin'

  // Build legacy-compatible Student shape for child components
  const student: Student = profile ? profileToStudent(profile, primaryEnrollment) : {
    student_code: '',
    display_name: '',
    start_date: '',
    khoa: ''
  }

  return (
    <div className="portal-bg h-screen w-full flex justify-center selection:bg-mission-accent selection:text-black overflow-hidden">
      <div className="w-full max-w-[1920px] flex flex-col h-full border-x border-white/5 relative shadow-[0_0_100px_rgba(0,0,0,0.5)]">

        {/* Top Navigation Bar / HUD */}
        <header className="portal-header h-16 shrink-0 border-b px-4 md:px-8 flex items-center justify-between z-30 relative shadow-md">
          <div className="flex items-center gap-3">
            {/* Smart Logo: image nếu có, fallback về initials */}
            {settings?.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.title || 'Logo'}
                className="w-8 h-8 object-contain rounded-sm"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <div
                className="w-8 h-8 flex items-center justify-center text-black font-black text-base rounded-sm shadow-[0_0_15px_rgba(var(--color-mission-accent-rgb,182,255,0),0.4)]"
                style={{ backgroundColor: 'var(--color-mission-accent)' }}
              >
                {(settings?.title || 'M')[0].toUpperCase()}
              </div>
            )}

            <div className="flex flex-col">
              <h1 className="font-bold tracking-widest font-mono hidden md:block uppercase text-sm leading-none mb-1 t-text">
                {settings?.title || 'MiniCRM'}
              </h1>
              <span className="text-[10px] font-mono hidden md:block uppercase t-text-muted">
                {profile?.display_name}{primaryEnrollment?.start_date ? ` · Từ ${new Date(primaryEnrollment.start_date).toLocaleDateString('vi-VN')}` : ''}
              </span>
            </div>
          </div>

          {/* Progress Display */}
          <div className="flex items-center gap-4">

            {/* MENU BUTTON (Side Panel) */}
            <button
              onClick={() => {
                playSound('CLICK')
                setIsMenuOpen(true)
              }}
              className="flex items-center justify-center p-2 text-neutral-400 hover:text-white hover:bg-white/10 transition-all border border-transparent hover:border-white/10 rounded-sm"
            >
              <Menu size={20} />
            </button>

            <div className="h-8 w-px bg-white/10 hidden md:block" />

            {/* LEADERBOARD BUTTON */}
            <button
              onClick={() => {
                playSound('CLICK')
                setIsLeaderboardOpen(true)
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/20 hover:border-yellow-500/50 transition-all group"
              title="Bảng Xếp Hạng"
            >
              <Trophy size={16} className="text-yellow-500 group-hover:animate-bounce-gentle" />
              <span className="text-[10px] font-mono font-bold text-yellow-500 uppercase hidden md:inline">Top Rank</span>
            </button>

            {/* STREAK COUNTER */}
            <div className={`
              flex items-center gap-2 px-3 py-1.5 border transition-all duration-300
              ${streak > 0
                ? 'bg-orange-950/30 border-orange-500/30'
                : 'bg-white/5 border-white/5 opacity-50'}
            `}>
              <Flame
                size={16}
                className={`transition-all ${streak > 0 ? 'text-orange-500 fill-orange-500 animate-pulse' : 'text-neutral-600'}`}
              />
              <div className="flex flex-col leading-none">
                <span className={`text-sm font-bold font-mono ${streak > 0 ? 'text-orange-400' : 'text-neutral-500'}`}>
                  {streak}
                </span>
              </div>
              <span className="text-[10px] font-mono uppercase text-neutral-500 hidden md:inline">Streak</span>
            </div>

            <div className="h-8 w-px bg-white/10 mx-1 hidden md:block" />

            {/* PERCENTAGE BAR */}
            <div className="hidden md:flex flex-col md:flex-row md:items-center md:gap-3 bg-white/5 rounded-sm px-4 py-1.5 border border-white/5">
              <span className="text-[10px] md:text-xs font-bold font-mono text-neutral-500 uppercase tracking-widest">Tiến độ</span>
              <div className="flex items-center gap-2">
                <div className="w-24 md:w-32 h-1.5 bg-neutral-800 rounded-none overflow-hidden">
                  <div
                    className="h-full bg-mission-accent shadow-[0_0_8px_rgba(182,255,0,0.8)] transition-all duration-700"
                    style={{ width: `${percentComplete}%` }}
                  />
                </div>
                <span className="text-xs font-mono font-bold text-mission-accent">{percentComplete}%</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* HELP BUTTON */}
            <button
              onClick={() => {
                playSound('OPEN')
                setIsHelpOpen(true)
              }}
              className="p-2 text-neutral-500 hover:text-mission-accent hover:bg-white/10 rounded-none transition-colors"
              title="Hướng Dẫn Sử Dụng"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-white/10 mx-1"></div>

            {(totalEnrollments > 1 || totalProducts > 0) && !showHub && (
              <button
                onClick={() => setShowHub(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 transition-all"
                title="Tất cả khoá học"
              >
                <BookOpen size={13} />
                <span className="hidden md:inline">Khoá học</span>
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 transition-all"
                title="Trang quản lý"
              >
                <LayoutDashboard size={13} />
                <span className="hidden md:inline">Quản lý</span>
              </button>
            )}
            {isAffiliate && (
              <button
                onClick={() => navigate('/affiliate')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border transition-all"
                style={{
                  borderColor: 'rgba(182,255,0,0.3)',
                  color: 'var(--color-mission-accent)',
                }}
                title="Affiliate Dashboard"
              >
                <Share2 size={13} />
                <span className="hidden md:inline">Affiliate</span>
              </button>
            )}
            <button
              onClick={handleReset}
              className="p-2 text-neutral-600 hover:text-red-500 hover:bg-red-950/30 rounded-none transition-colors"
              title="Reset Tiến Độ"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 text-neutral-600 hover:text-white hover:bg-white/10 rounded-none transition-colors"
              title="Đăng Xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative flex flex-col overflow-hidden">
          {showHub ? (
            <CourseHub
              customerId={profile!.id}
              onSelectCourse={handleSelectCourse}
            />
          ) : layoutMode === 'module' ? (
            <ModuleView
              zones={zones}
              quests={quests}
              progress={progress}
              currentDay={actualCurrentDay}
              maxAllowedDay={maxAllowedDay}
              startDate={primaryEnrollment?.start_date || ''}
              isAdmin={isAdmin}
              onQuestSelect={handleQuestSelect}
            />
          ) : (
            <GameMap
              quests={quests}
              zones={zones}
              currentDay={actualCurrentDay}
              completedQuests={progress.completedQuests}
              onQuestSelect={handleQuestSelect}
              startDate={primaryEnrollment?.start_date || ''}
            />
          )}

          {/* Floating "Next Action" Card (High Contrast) */}
          {currentQuestData && !selectedQuest && !showHub && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-8 md:bottom-28 z-[35] w-[90%] md:w-80 animate-bounce-gentle">
              <div
                onClick={() => handleQuestSelect(currentQuestData)}
                className="bg-black p-0 border border-mission-accent shadow-[0_0_20px_rgba(182,255,0,0.2)] cursor-pointer hover:-translate-y-1 transition-transform group"
              >
                <div className="bg-mission-accent px-3 py-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono text-black uppercase tracking-widest">NHIỆM VỤ HIỆN TẠI</span>
                  <Zap size={12} className="text-black fill-black animate-pulse" />
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2 text-mission-accent/70 font-mono text-xs">
                    <span>&gt;&gt; NGÀY {currentQuestData.id}</span>
                  </div>
                  <h3 className="font-bold text-white text-sm leading-tight uppercase group-hover:text-mission-accent transition-colors">
                    {currentQuestData.title}
                  </h3>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Side Menu Component */}
        <SideMenu
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onSelectQuest={handleQuestSelect}
          zones={zones}
          quests={quests}
          progress={progress}
        />

        {/* Course Builder Modal */}
        {isBuilderOpen && (
          <CourseBuilder
            initialQuests={quests}
            initialZones={zones}
            onClose={() => setIsBuilderOpen(false)}
          />
        )}

        {/* Leaderboard Modal */}
        {isLeaderboardOpen && (
          <LeaderboardView
            student={student}
            progress={progress}
            onClose={() => {
              playSound('CLICK')
              setIsLeaderboardOpen(false)
            }}
          />
        )}

        {/* Help / Settings Modal */}
        {isHelpOpen && (
          <div className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 overflow-y-auto">
            <div className="w-full max-w-4xl bg-neutral-900 border border-white/10 shadow-2xl flex flex-col relative overflow-hidden max-h-[90vh]">

              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black">
                <div className="flex items-center gap-2">
                  <HelpCircle className="text-mission-accent" size={20} />
                  <h2 className="text-sm font-bold font-mono text-white uppercase tracking-widest">HƯỚNG DẪN SỬ DỤNG HỆ THỐNG</h2>
                </div>
                <button
                  onClick={() => {
                    playSound('CLICK')
                    setIsHelpOpen(false)
                  }}
                  className="p-1 hover:bg-white/10 rounded-sm transition-colors text-white"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 bg-black/50 overflow-y-auto">

                {/* Video Section */}
                <div className="w-full aspect-video bg-black border border-neutral-800 flex items-center justify-center relative mb-6">
                  {settings?.guideVideoUrl ? (
                    <iframe
                      src={processGoogleDriveUrl(settings.guideVideoUrl)}
                      className="w-full h-full"
                      allow="autoplay; fullscreen"
                      title="User Guide"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-neutral-600">
                      <HelpCircle size={48} className="opacity-20" />
                      <p className="text-xs font-mono uppercase tracking-widest">CHƯA CÓ VIDEO HƯỚNG DẪN</p>
                    </div>
                  )}
                </div>

                {/* Footer / Support */}
                {settings?.supportZaloLink && (
                  <div className="flex items-center justify-center border-t border-white/5 pt-6">
                    <a
                      href={settings.supportZaloLink}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-6 py-3 bg-blue-600/10 border border-blue-500/30 hover:bg-blue-600/20 hover:border-blue-500 text-blue-400 hover:text-white transition-all rounded-sm group"
                    >
                      <MessageCircle size={18} className="group-hover:animate-bounce-gentle" />
                      <div className="flex flex-col items-start">
                        <span className="text-[10px] font-mono uppercase opacity-70">Gặp khó khăn?</span>
                        <span className="text-xs font-bold uppercase tracking-wide">Liên hệ Zalo Hỗ Trợ Kỹ Thuật</span>
                      </div>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quest Modal */}
        {selectedQuest && (
          <QuestView
            student={student}
            quest={selectedQuest}
            progress={progress}
            onClose={() => {
              playSound('CLICK')
              setSelectedQuest(null)
            }}
            onCompleteTask={(qid, tid, chk) => {
              if (chk) playSound('TASK_CHECK')
              completeTask(qid, tid, chk)
            }}
            onCompleteQuest={completeQuest}
            onToggleVideoWatched={toggleVideoWatched}
            onAddSubmission={addSubmission}
          />
        )}
      </div>
    </div>
  )
}

const AuthenticatedApp = () => {
  const { profile, isLoading, setProfile } = useConfig()

  if (isLoading) {
    return (
      <div className="h-screen w-full bg-black flex items-center justify-center text-mission-accent">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return <LoginScreen onLoginSuccess={setProfile} />
  }

  const isAdmin = profile.role === 'admin' || profile.role === 'sales'
  const isAffiliateOnly = profile.role === 'affiliate'

  // Affiliate-only users: chỉ có quyền vào /affiliate dashboard
  if (isAffiliateOnly) {
    return (
      <React.Suspense fallback={<div className="h-screen bg-black flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>}>
        <Routes>
          <Route path="/affiliate" element={<AffiliatePortal />} />
          <Route path="*" element={<Navigate to="/affiliate" replace />} />
        </Routes>
      </React.Suspense>
    )
  }

  if (isAdmin) {
    return (
      <ErrorBoundary>
        <React.Suspense fallback={<div className="h-screen bg-gray-950 flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>}>
          <Routes>
            <Route path="/admin/*" element={<AdminPanel />} />
            {/* Admin cũng có thể vào student portal để xem trải nghiệm học viên */}
            <Route path="/" element={<StudentPortal />} />
            {/* Admin xem trước dashboard của affiliate — dùng ?preview=<affiliate_id> */}
            <Route path="/affiliate" element={<AffiliatePortal />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </React.Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <React.Suspense fallback={<div className="h-screen bg-black flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>}>
      <Routes>
        <Route path="/" element={<StudentPortal />} />
        <Route path="/affiliate" element={<AffiliatePortal />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  )
}

const AppRouter = () => {
  return (
    <Routes>
      <Route path="/p/:slug" element={<ProductPage />} />
      <Route path="/*" element={<AuthenticatedApp />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ConfigProvider>
          <DialogProvider>
            <AppRouter />
            <PoweredBy />
          </DialogProvider>
        </ConfigProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
