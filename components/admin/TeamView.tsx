import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  UserPlus, X, MoreHorizontal, Shield, Check, RefreshCw, PauseCircle,
  PlayCircle, ChevronDown, ChevronRight, History, Loader2, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../../services/supabase'
import type { CustomerRole, CustomerStatus } from '../../types'

// ─── Types & constants ──────────────────────────────────────────────────────

type TeamRole = 'owner' | 'admin' | 'sales' | 'support'

interface TeamMember {
  id: string
  email: string
  display_name: string
  role: TeamRole
  status: CustomerStatus | null
  phone: string | null
  created_at: string
  updated_at: string
}

interface AuditEntry {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  changes: any
  created_at: string
}

const ROLE_LABELS: Record<CustomerRole, string> = {
  owner:     'Chủ',
  admin:     'Quản trị',
  sales:     'Sales',
  support:   'Hỗ trợ',
  student:   'Học viên',
  affiliate: 'Affiliate',
}

const ROLE_COLORS: Record<TeamRole, { bg: string; text: string; border: string }> = {
  owner:   { bg: 'rgba(251,146,60,0.12)',  text: '#fdba74', border: 'rgba(251,146,60,0.3)' },
  admin:   { bg: 'rgba(129,140,248,0.12)', text: '#a5b4fc', border: 'rgba(129,140,248,0.3)' },
  sales:   { bg: 'rgba(52,211,153,0.12)',  text: '#6ee7b7', border: 'rgba(52,211,153,0.3)' },
  support: { bg: 'rgba(148,163,184,0.12)', text: '#cbd5e1', border: 'rgba(148,163,184,0.3)' },
}

const ASSIGNABLE_ROLES: TeamRole[] = ['admin', 'sales', 'support']

// Actions → human labels for audit log
const ACTION_LABELS: Record<string, string> = {
  'team.invite':            'Mời thành viên',
  'team.change_role':       'Đổi vai trò',
  'team.deactivate':        'Ngừng hoạt động',
  'team.activate':          'Kích hoạt',
  'team.resend_magic_link': 'Gửi lại magic link',
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m} phút trước`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} giờ trước`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} ngày trước`
  return new Date(iso).toLocaleDateString('vi-VN')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

async function callTeam(path: string, init?: RequestInit): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Phiên đăng nhập đã hết hạn')
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`)
  return data
}

// ─── Main view ──────────────────────────────────────────────────────────────

const TeamView: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [audit, setAudit]     = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string>('')
  const [currentUserId, setCurrentUserId] = useState<string>('')

  const [showInvite, setShowInvite]         = useState(false)
  const [changeRoleFor, setChangeRoleFor]   = useState<TeamMember | null>(null)
  const [confirmAction, setConfirmAction]   = useState<{ member: TeamMember; type: 'deactivate' | 'activate' } | null>(null)
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({})   // memberId → busy label
  const [showAudit, setShowAudit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await callTeam('/api/team')
      setMembers(data.members || [])
      setAudit(data.audit || [])
    } catch (e: any) {
      setError(e?.message || 'Không tải được danh sách')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || ''))
    load()
  }, [load])

  const setBusy = (id: string, label: string) => setRowBusy(m => ({ ...m, [id]: label }))
  const clearBusy = (id: string) => setRowBusy(m => { const { [id]: _, ...rest } = m; return rest })

  const doResendMagicLink = async (member: TeamMember) => {
    setBusy(member.id, 'sending')
    try {
      const result = await callTeam(`/api/team?action=resend-magic-link&id=${member.id}`, { method: 'POST' })
      if (result.email_sent) alert(`Đã gửi magic link tới ${member.email}`)
      else alert(`Đã gửi (fallback Supabase SMTP): ${member.email}`)
    } catch (e: any) {
      alert(`Lỗi: ${e?.message || e}`)
    } finally {
      clearBusy(member.id)
    }
  }

  const doSetStatus = async (member: TeamMember, next: 'active' | 'deactivated') => {
    setBusy(member.id, 'status')
    try {
      await callTeam(`/api/team?action=${next === 'active' ? 'activate' : 'deactivate'}&id=${member.id}`, {
        method: 'POST',
      })
      await load()
    } catch (e: any) {
      alert(`Lỗi: ${e?.message || e}`)
    } finally {
      clearBusy(member.id)
      setConfirmAction(null)
    }
  }

  const ownerCount = useMemo(
    () => members.filter(m => m.role === 'owner' && (m.status || 'active') === 'active').length,
    [members]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shield size={15} style={{ color: 'var(--color-mission-accent)' }} />
            <h2 className="text-sm font-semibold text-white">Đội ngũ</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">{members.length} thành viên · {ownerCount} owner đang hoạt động</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          <UserPlus size={14} />
          Mời thành viên
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Members table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/60">
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Thành viên</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Vai trò</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Trạng thái</th>
              <th className="text-left text-xs text-gray-500 uppercase tracking-widest px-5 py-3">Tham gia</th>
              <th className="px-5 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-gray-800 last:border-0">
                  {[...Array(5)].map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-4 bg-gray-800 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-600 py-12 text-sm">Chưa có thành viên nào</td>
              </tr>
            ) : members.map(member => (
              <TeamRow
                key={member.id}
                member={member}
                isCurrentUser={member.id === currentUserId}
                ownerCount={ownerCount}
                busyLabel={rowBusy[member.id]}
                onChangeRole={() => setChangeRoleFor(member)}
                onDeactivate={() => setConfirmAction({ member, type: 'deactivate' })}
                onActivate={() => setConfirmAction({ member, type: 'activate' })}
                onResend={() => doResendMagicLink(member)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit log */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAudit(s => !s)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-900/70 transition-colors"
        >
          <div className="flex items-center gap-2">
            <History size={14} style={{ color: 'var(--color-mission-accent)' }} />
            <span className="text-sm font-semibold text-white">Lịch sử thao tác</span>
            <span className="text-xs text-gray-600">({audit.length})</span>
          </div>
          {showAudit
            ? <ChevronDown size={14} className="text-gray-500" />
            : <ChevronRight size={14} className="text-gray-500" />}
        </button>
        {showAudit && (
          <div className="border-t border-gray-800">
            {audit.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-6">Chưa có thao tác nào</p>
            ) : (
              <div>
                {audit.map(entry => <AuditRow key={entry.id} entry={entry} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onSuccess={async () => { setShowInvite(false); await load() }}
        />
      )}
      {changeRoleFor && (
        <ChangeRoleModal
          member={changeRoleFor}
          ownerCount={ownerCount}
          onClose={() => setChangeRoleFor(null)}
          onSuccess={async () => { setChangeRoleFor(null); await load() }}
        />
      )}
      {confirmAction && (
        <ConfirmStatusModal
          member={confirmAction.member}
          type={confirmAction.type}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => doSetStatus(confirmAction.member, confirmAction.type === 'deactivate' ? 'deactivated' : 'active')}
        />
      )}
    </div>
  )
}

export default TeamView

// ─── Row component ──────────────────────────────────────────────────────────

const TeamRow: React.FC<{
  member: TeamMember
  isCurrentUser: boolean
  ownerCount: number
  busyLabel?: string
  onChangeRole: () => void
  onDeactivate: () => void
  onActivate: () => void
  onResend: () => void
}> = ({ member, isCurrentUser, ownerCount, busyLabel, onChangeRole, onDeactivate, onActivate, onResend }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isActive = (member.status || 'active') === 'active'
  const roleColor = ROLE_COLORS[member.role]
  const isLastOwner = member.role === 'owner' && ownerCount <= 1

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <tr className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 transition-colors">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full border flex items-center justify-center text-sm font-bold shrink-0"
            style={{ backgroundColor: roleColor.bg, borderColor: roleColor.border, color: roleColor.text }}
          >
            {(member.display_name || member.email)[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-white flex items-center gap-2">
              {member.display_name || member.email.split('@')[0]}
              {isCurrentUser && <span className="text-[10px] text-gray-500 uppercase tracking-widest">(bạn)</span>}
            </p>
            <p className="text-xs text-gray-500">{member.email}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium"
          style={{ backgroundColor: roleColor.bg, borderColor: roleColor.border, color: roleColor.text }}
        >
          {ROLE_LABELS[member.role]}
        </span>
      </td>
      <td className="px-5 py-4">
        {isActive ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Đang hoạt động
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> Ngừng hoạt động
          </span>
        )}
      </td>
      <td className="px-5 py-4">
        <p className="text-xs text-gray-400">{formatDate(member.created_at)}</p>
      </td>
      <td className="px-5 py-4 text-right relative">
        <div ref={menuRef} className="relative inline-block">
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={!!busyLabel}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            {busyLabel ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={16} />}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-gray-900 border border-gray-800 rounded-lg shadow-xl overflow-hidden">
              <MenuItem
                icon={<Shield size={13} />}
                label="Đổi vai trò"
                onClick={() => { setMenuOpen(false); onChangeRole() }}
                disabled={isLastOwner}
                hint={isLastOwner ? 'Owner cuối cùng' : undefined}
              />
              {isActive ? (
                <>
                  <MenuItem
                    icon={<RefreshCw size={13} />}
                    label="Gửi lại magic link"
                    onClick={() => { setMenuOpen(false); onResend() }}
                  />
                  <MenuItem
                    icon={<PauseCircle size={13} />}
                    label="Ngừng hoạt động"
                    onClick={() => { setMenuOpen(false); onDeactivate() }}
                    disabled={isCurrentUser || isLastOwner}
                    hint={isCurrentUser ? 'Không tự ngừng chính mình' : isLastOwner ? 'Owner cuối cùng' : undefined}
                    danger
                  />
                </>
              ) : (
                <MenuItem
                  icon={<PlayCircle size={13} />}
                  label="Kích hoạt"
                  onClick={() => { setMenuOpen(false); onActivate() }}
                />
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

const MenuItem: React.FC<{
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}> = ({ icon, label, onClick, disabled, danger, hint }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={hint}
    className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
      ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-800'}
      ${danger ? 'text-red-400' : 'text-gray-300'}`}
  >
    {icon}
    <span className="flex-1">{label}</span>
    {hint && <span className="text-[10px] text-gray-600 truncate max-w-[80px]">{hint}</span>}
  </button>
)

// ─── Invite modal ───────────────────────────────────────────────────────────

const InviteModal: React.FC<{ onClose: () => void; onSuccess: () => void | Promise<void> }> = ({ onClose, onSuccess }) => {
  const [email, setEmail] = useState('')
  const [name, setName]   = useState('')
  const [role, setRole]   = useState<TeamRole>('sales')
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const result = await callTeam('/api/team?action=invite', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), display_name: name.trim(), role }),
      })
      if (!result.success) throw new Error(result.error || 'Mời thất bại')
      await onSuccess()
    } catch (e: any) {
      setErr(e?.message || 'Lỗi không xác định')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title="Mời thành viên">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            placeholder="teammate@company.com"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Họ tên</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Để trống → dùng phần trước @"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Vai trò</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value as TeamRole)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          >
            {ASSIGNABLE_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-600 mt-1">
            Owner chỉ được gán bởi một owner khác qua "Đổi vai trò".
          </p>
        </div>

        {err && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Huỷ
          </button>
          <button
            type="submit"
            disabled={busy || !email}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {busy ? 'Đang gửi...' : 'Gửi lời mời'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Change-role modal ──────────────────────────────────────────────────────

const ChangeRoleModal: React.FC<{
  member: TeamMember
  ownerCount: number
  onClose: () => void
  onSuccess: () => void | Promise<void>
}> = ({ member, ownerCount, onClose, onSuccess }) => {
  const [role, setRole] = useState<TeamRole>(member.role)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const isLastOwner = member.role === 'owner' && ownerCount <= 1

  const submit = async () => {
    if (role === member.role) { onClose(); return }
    setBusy(true)
    setErr('')
    try {
      await callTeam(`/api/team?action=change-role&id=${member.id}`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      })
      await onSuccess()
    } catch (e: any) {
      setErr(e?.message || 'Lỗi không xác định')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Đổi vai trò · ${member.display_name || member.email}`}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Vai trò mới</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value as TeamRole)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="owner">{ROLE_LABELS.owner}</option>
            {ASSIGNABLE_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-600 mt-1">
            Chỉ owner mới được thao tác với vai trò owner.
          </p>
          {isLastOwner && role !== 'owner' && (
            <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle size={11} /> Đây là owner cuối cùng — server sẽ từ chối thao tác này.
            </p>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Huỷ
          </button>
          <button
            onClick={submit}
            disabled={busy || role === member.role}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {busy ? 'Đang lưu...' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── Confirm status modal ───────────────────────────────────────────────────

const ConfirmStatusModal: React.FC<{
  member: TeamMember
  type: 'deactivate' | 'activate'
  onCancel: () => void
  onConfirm: () => void
}> = ({ member, type, onCancel, onConfirm }) => {
  const title = type === 'deactivate' ? 'Ngừng hoạt động' : 'Kích hoạt lại'
  const desc  = type === 'deactivate'
    ? `Tài khoản ${member.email} sẽ không thể đăng nhập cho đến khi được kích hoạt lại. Dữ liệu vẫn được giữ nguyên.`
    : `Tài khoản ${member.email} sẽ được kích hoạt lại và có thể đăng nhập bình thường.`

  return (
    <ModalShell onClose={onCancel} title={`${title} · ${member.display_name || member.email}`}>
      <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Huỷ
        </button>
        <button
          onClick={onConfirm}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 ${
            type === 'deactivate' ? 'bg-red-500 text-white' : ''
          }`}
          style={type === 'activate' ? { backgroundColor: 'var(--color-mission-accent)', color: '#000' } : undefined}
        >
          {type === 'deactivate' ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
          {title}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Modal shell + audit row ────────────────────────────────────────────────

const ModalShell: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
  <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-md overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <X size={16} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
)

const AuditRow: React.FC<{ entry: AuditEntry }> = ({ entry }) => {
  const label = ACTION_LABELS[entry.action] || entry.action
  const changes = entry.changes || {}
  const summary = buildAuditSummary(entry.action, changes)

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 last:border-0 text-xs">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-mission-accent)' }} />
      <span className="font-medium text-gray-300 shrink-0 w-32 truncate">{label}</span>
      <span className="text-gray-500 flex-1 truncate">{summary}</span>
      <span className="text-gray-600 shrink-0">{entry.actor_email || '—'}</span>
      <span className="text-gray-700 shrink-0" title={new Date(entry.created_at).toLocaleString('vi-VN')}>
        {timeAgo(entry.created_at)}
      </span>
    </div>
  )
}

function buildAuditSummary(action: string, changes: any): string {
  if (!changes || typeof changes !== 'object') return ''
  switch (action) {
    case 'team.invite':
      return `${changes.email || ''} · ${ROLE_LABELS[changes.role as CustomerRole] || changes.role || ''}${changes.created === false ? ' (đã có)' : ''}`
    case 'team.change_role':
      return `${changes.email || ''} · ${ROLE_LABELS[changes.from_role as CustomerRole] || changes.from_role} → ${ROLE_LABELS[changes.to_role as CustomerRole] || changes.to_role}`
    case 'team.deactivate':
    case 'team.activate':
      return `${changes.email || ''} · ${ROLE_LABELS[changes.role as CustomerRole] || changes.role || ''}`
    case 'team.resend_magic_link':
      return `${changes.email || ''}${changes.email_sent === false ? ' (fallback SMTP)' : ''}`
    default:
      return JSON.stringify(changes).slice(0, 80)
  }
}
