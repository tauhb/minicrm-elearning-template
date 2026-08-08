import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Plus, Download, ExternalLink, Phone, MessageCircle, Bookmark, X, Share2, Copy, Check } from 'lucide-react'
import { fetchLeads, fetchPipelineStages, updateLead, createLead, addCareHistory } from '../../services/api'
import { supabase } from '../../services/supabase'
import { Lead, PipelineStage } from '../../types'
import LeadDetail from './LeadDetail'
import EmptyState from './EmptyState'
import { format } from 'date-fns'

const SMARTLIST_KEY = 'khtn-smartlists'

interface SmartList {
  id: string
  name: string
  search: string
  sourceFilter: string
  stageFilter: string
  tagFilter: string[]
}

const loadSmartLists = (): SmartList[] => {
  try { return JSON.parse(localStorage.getItem(SMARTLIST_KEY) || '[]') } catch { return [] }
}
const saveSmartLists = (lists: SmartList[]) =>
  localStorage.setItem(SMARTLIST_KEY, JSON.stringify(lists))

const SOURCE_COLORS: Record<string, string> = {
  landing_page: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  facebook_ad: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  referral: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  organic: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
}
const SOURCE_LABELS: Record<string, string> = {
  landing_page: 'Trang đích',
  facebook_ad: 'Quảng cáo FB',
  referral: 'Giới thiệu',
  organic: 'Tự nhiên',
}

const RESULT_OPTIONS = [
  { value: 'interested', label: 'Quan tâm' },
  { value: 'no_answer', label: 'Không bắt máy' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'success', label: 'Thành công' },
]

const LeadsTable: React.FC = () => {
  const [leads, setLeads] = useState<Lead[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [smartLists, setSmartLists] = useState<SmartList[]>(loadSmartLists)
  const [savingName, setSavingName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [activeSmartList, setActiveSmartList] = useState<string | null>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', email: '', phone: '', source: 'landing_page' })
  const [addLoading, setAddLoading] = useState(false)

  // Affiliate state
  const [affiliateLeadIds, setAffiliateLeadIds] = useState<Set<string>>(new Set())
  const [invitingAffiliate, setInvitingAffiliate] = useState<string | null>(null) // lead id đang processing
  const [copiedRefcode, setCopiedRefcode] = useState<string | null>(null)

  // Quick action state
  const [quickAction, setQuickAction] = useState<{ lead: Lead; type: 'call' | 'zalo' } | null>(null)
  const [qaContent, setQaContent] = useState('')
  const [qaResult, setQaResult] = useState('')
  const [qaFollowUp, setQaFollowUp] = useState('')
  const [qaLoading, setQaLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const [l, s] = await Promise.all([fetchLeads(), fetchPipelineStages()])
    setLeads(l); setStages(s); setLoading(false)

    // Load affiliate status cho leads
    const { data: affiliates } = await supabase
      .from('affiliates')
      .select('lead_id')
      .not('lead_id', 'is', null)
    if (affiliates) {
      setAffiliateLeadIds(new Set(affiliates.map((a: any) => a.lead_id)))
    }
  }

  // Invite lead làm affiliate
  const handleInviteAffiliate = async (lead: Lead) => {
    setInvitingAffiliate(lead.id)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch('/api/admin/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      const json = await res.json()
      if (res.ok) {
        setAffiliateLeadIds(prev => new Set([...prev, lead.id]))
      } else {
        if (json.error?.includes('đã là affiliate')) {
          setAffiliateLeadIds(prev => new Set([...prev, lead.id]))
        }
        console.error(json.error)
      }
    } catch (e) {
      console.error(e)
    }
    setInvitingAffiliate(null)
  }

  // Copy refcode link
  const handleCopyRefcode = (refcode: string) => {
    const url = `${window.location.origin}/?ref=${refcode}`
    navigator.clipboard.writeText(url)
    setCopiedRefcode(refcode)
    setTimeout(() => setCopiedRefcode(null), 2000)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id || null))
  }, [])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    leads.forEach(l => (l.tags || []).forEach(t => s.add(t)))
    return Array.from(s).sort()
  }, [leads])

  const toggleTag = (tag: string) => {
    setActiveSmartList(null)
    setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const hasActiveFilter = !!(search || sourceFilter || stageFilter || tagFilter.length)

  const commitSave = () => {
    const name = savingName.trim()
    if (!name) return
    const list: SmartList = {
      id: Date.now().toString(),
      name,
      search, sourceFilter, stageFilter, tagFilter,
    }
    const next = [...smartLists, list]
    setSmartLists(next)
    saveSmartLists(next)
    setActiveSmartList(list.id)
    setSavingName('')
    setShowSaveInput(false)
  }

  const applySmartList = (list: SmartList) => {
    setSearch(list.search)
    setSourceFilter(list.sourceFilter)
    setStageFilter(list.stageFilter)
    setTagFilter(list.tagFilter)
    setActiveSmartList(list.id)
  }

  const deleteSmartList = (id: string) => {
    const next = smartLists.filter(l => l.id !== id)
    setSmartLists(next)
    saveSmartLists(next)
    if (activeSmartList === id) setActiveSmartList(null)
  }

  const resetFilters = () => {
    setSearch(''); setSourceFilter(''); setStageFilter(''); setTagFilter([])
    setActiveSmartList(null)
  }

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    const matchSearch = !search
      || l.name.toLowerCase().includes(q)
      || l.email.toLowerCase().includes(q)
      || (l.phone?.replace(/\s/g, '').includes(search.replace(/\s/g, '')) ?? false)
    const matchSource = !sourceFilter || l.source === sourceFilter
    const matchStage  = !stageFilter  || l.pipeline_stage_id === stageFilter
    const matchTag    = tagFilter.length === 0 || tagFilter.every(t => (l.tags || []).includes(t))
    return matchSearch && matchSource && matchStage && matchTag
  })

  const handleStageChange = async (lead: Lead, stageId: string) => {
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, pipeline_stage_id: stageId } : l))
    await updateLead(lead.id, { pipeline_stage_id: stageId })
  }

  const exportCSV = () => {
    const headers = ['Name', 'Email', 'Phone', 'Source', 'Stage', 'Score', 'Created']
    const rows = filtered.map(l => [
      l.name, l.email, l.phone || '', l.source || '',
      stages.find(s => s.id === l.pipeline_stage_id)?.name || '',
      l.score, format(new Date(l.created_at), 'dd/MM/yyyy')
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'leads.csv'; a.click()
  }

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault(); setAddLoading(true)
    const firstStage = stages[0]
    const created = await createLead({ ...newLead, pipeline_stage_id: firstStage?.id || null })
    if (created) { setLeads(prev => [created, ...prev]); setShowAdd(false); setNewLead({ name: '', email: '', phone: '', source: 'landing_page' }) }
    setAddLoading(false)
  }

  const openQuickAction = (lead: Lead, type: 'call' | 'zalo') => {
    setQuickAction({ lead, type })
    setQaContent('')
    setQaResult('')
    setQaFollowUp('')
  }

  const closeQuickAction = () => {
    setQuickAction(null)
    setQaContent('')
    setQaResult('')
    setQaFollowUp('')
  }

  const handleQuickActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickAction || !currentUserId) return
    setQaLoading(true)
    await addCareHistory({
      lead_id: quickAction.lead.id,
      type: quickAction.type === 'call' ? 'call' : 'zalo',
      content: qaContent,
      result: qaResult as Parameters<typeof addCareHistory>[0]['result'] || undefined,
      next_follow_up_date: qaFollowUp || undefined,
      created_by: currentUserId,
    })
    setQaLoading(false)
    closeQuickAction()
    setToast('Đã ghi lịch sử chăm sóc')
    setTimeout(() => setToast(null), 2500)
  }

  const buildUtmTooltip = (lead: Lead): string => {
    const parts: string[] = []
    if (lead.utm_source) parts.push(`source: ${lead.utm_source}`)
    if (lead.utm_medium) parts.push(`medium: ${lead.utm_medium}`)
    if (lead.utm_campaign) parts.push(`campaign: ${lead.utm_campaign}`)
    if (lead.utm_term) parts.push(`term: ${lead.utm_term}`)
    if (lead.utm_content) parts.push(`content: ${lead.utm_content}`)
    return parts.join(' | ')
  }

  return (
    <div className="p-8">
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
        >
          ✓ {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Khách hàng tiềm năng</h1>
          <p className="text-gray-500 text-sm mt-1">{filtered.length} lead{search || sourceFilter || stageFilter ? ' (đã lọc)' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg text-sm transition-colors">
            <Download size={14} />Xuất CSV
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Plus size={16} />Thêm lead
          </button>
        </div>
      </div>

      {/* SmartLists */}
      {(smartLists.length > 0 || hasActiveFilter) && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {smartLists.map(list => {
            const active = activeSmartList === list.id
            return (
              <div key={list.id} className="flex items-center rounded-lg border overflow-hidden"
                style={active ? {
                  borderColor: 'var(--color-mission-accent)',
                  background: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.1)',
                } : { borderColor: 'rgba(255,255,255,0.1)', background: 'transparent' }}
              >
                <button
                  onClick={() => applySmartList(list)}
                  className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 text-xs font-medium transition-colors"
                  style={{ color: active ? 'var(--color-mission-accent)' : '#9ca3af' }}
                >
                  <Bookmark size={11} />
                  {list.name}
                </button>
                <button
                  onClick={() => deleteSmartList(list.id)}
                  className="px-1.5 py-1.5 text-gray-600 hover:text-red-400 transition-colors border-l border-gray-800"
                >
                  <X size={10} />
                </button>
              </div>
            )
          })}

          {/* Save input */}
          {showSaveInput ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={saveInputRef}
                autoFocus
                value={savingName}
                onChange={e => setSavingName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitSave()
                  if (e.key === 'Escape') { setShowSaveInput(false); setSavingName('') }
                }}
                placeholder="Tên bộ lọc..."
                className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none w-36"
              />
              <button
                onClick={commitSave}
                disabled={!savingName.trim()}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
                style={{ background: 'var(--color-mission-accent)', color: '#000' }}
              >
                Lưu
              </button>
              <button
                onClick={() => { setShowSaveInput(false); setSavingName('') }}
                className="text-xs text-gray-500 hover:text-white transition-colors px-1"
              >
                <X size={14} />
              </button>
            </div>
          ) : hasActiveFilter && (
            <button
              onClick={() => setShowSaveInput(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-dashed transition-colors"
              style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#6b7280' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6b7280' }}
            >
              <Bookmark size={11} />
              Lưu bộ lọc này
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => { setSearch(e.target.value); setActiveSmartList(null) }} placeholder="Tên, email hoặc số điện thoại..." className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
        </div>
        <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setActiveSmartList(null) }} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none">
          <option value="">Tất cả nguồn</option>
          <option value="landing_page">Trang đích</option>
          <option value="facebook_ad">Quảng cáo FB</option>
          <option value="referral">Giới thiệu</option>
          <option value="organic">Tự nhiên</option>
        </select>
        <select value={stageFilter} onChange={e => { setStageFilter(e.target.value); setActiveSmartList(null) }} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none">
          <option value="">Tất cả giai đoạn</option>
          {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Tag filter — always visible */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <span className="text-xs text-gray-500 shrink-0">Tag:</span>
        {allTags.length === 0 ? (
          <span className="text-xs text-gray-700 italic">Gắn tag cho lead để lọc</span>
        ) : (
          allTags.map(tag => {
            const active = tagFilter.includes(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="text-xs px-2.5 py-1 rounded-full border transition-all"
                style={active ? {
                  backgroundColor: 'var(--color-mission-accent)',
                  borderColor: 'var(--color-mission-accent)',
                  color: '#000',
                  fontWeight: 600,
                } : {
                  backgroundColor: 'transparent',
                  borderColor: 'rgba(255,255,255,0.15)',
                  color: '#9ca3af',
                }}
              >
                {tag}
              </button>
            )
          })
        )}
        {hasActiveFilter && (
          <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-white transition-colors ml-1">
            Xóa lọc
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              {['Thông tin', 'Điện thoại', 'Nguồn', 'UTM', 'Giai đoạn', 'Điểm', 'Ngày tạo', ''].map(h => (
                <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-widest px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => (
              <tr key={i} className="border-b border-gray-800">
                {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-800 rounded animate-pulse" /></td>)}
              </tr>
            )) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6">
                  <EmptyState
                    title={hasActiveFilter ? 'Không tìm thấy lead phù hợp' : 'Chưa có lead nào'}
                    description={hasActiveFilter ? 'Thử bỏ bộ lọc hoặc mở rộng phạm vi tìm kiếm.' : 'Thêm lead thủ công hoặc bật form opt-in trên trang đích.'}
                    cta={hasActiveFilter
                      ? { label: 'Xóa bộ lọc', onClick: resetFilters }
                      : { label: 'Thêm lead', icon: Plus, onClick: () => setShowAdd(true) }}
                  />
                </td>
              </tr>
            ) : filtered.map(lead => (
              <tr
                key={lead.id}
                className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors cursor-pointer"
                onClick={() => setSelectedLead(lead)}
              >
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-white">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.email}</p>
                  {lead.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {lead.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-400">
                          {tag}
                        </span>
                      ))}
                      {lead.tags.length > 3 && (
                        <span className="text-[10px] text-gray-600">+{lead.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">{lead.phone || '—'}</td>
                <td className="px-4 py-3">
                  {lead.source ? (
                    <span className={`text-xs px-2 py-0.5 rounded border ${SOURCE_COLORS[lead.source] || 'text-gray-400 bg-gray-700 border-gray-600'}`}>
                      {SOURCE_LABELS[lead.source] || lead.source.replace('_', ' ')}
                    </span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                {/* UTM column */}
                <td className="px-4 py-3">
                  {lead.utm_source ? (
                    <span
                      className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 cursor-default"
                      title={buildUtmTooltip(lead)}
                    >
                      {lead.utm_source}
                    </span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={lead.pipeline_stage_id || ''}
                    onChange={e => handleStageChange(lead, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none cursor-pointer"
                  >
                    <option value="">Chưa phân loại</option>
                    {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${lead.score}%`, backgroundColor: 'var(--color-mission-accent)' }} />
                    </div>
                    <span className="text-xs text-gray-500">{lead.score}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{format(new Date(lead.created_at), 'dd/MM/yy')}</td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openQuickAction(lead, 'call')}
                      title="Ghi nhanh - Gọi điện"
                      className="p-1.5 text-gray-500 hover:text-emerald-400 hover:bg-gray-700 rounded transition-colors"
                    >
                      <Phone size={14} />
                    </button>
                    <button
                      onClick={() => openQuickAction(lead, 'zalo')}
                      title="Ghi nhanh - Zalo"
                      className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
                    >
                      <MessageCircle size={14} />
                    </button>
                    <button
                      onClick={() => setSelectedLead(lead)}
                      title="Xem chi tiết"
                      className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    >
                      <ExternalLink size={14} />
                    </button>

                    {/* Affiliate actions */}
                    {affiliateLeadIds.has(lead.id) ? (
                      // Đã là affiliate — show copy refcode link
                      (lead as any).refcode && (
                        <button
                          onClick={() => handleCopyRefcode((lead as any).refcode)}
                          title={`Copy link: /?ref=${(lead as any).refcode}`}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                          style={copiedRefcode === (lead as any).refcode
                            ? { background: 'rgba(182,255,0,0.15)', color: 'var(--color-mission-accent)', border: '1px solid rgba(182,255,0,0.3)' }
                            : { background: 'rgba(182,255,0,0.08)', color: 'var(--color-mission-accent)', border: '1px solid rgba(182,255,0,0.2)' }}
                        >
                          {copiedRefcode === (lead as any).refcode ? <Check size={12} /> : <Copy size={12} />}
                          <span className="font-mono">{(lead as any).refcode}</span>
                        </button>
                      )
                    ) : (
                      // Chưa là affiliate — show "Duyệt Aff" button
                      <button
                        onClick={() => handleInviteAffiliate(lead)}
                        disabled={invitingAffiliate === lead.id}
                        title="Duyệt làm Affiliate — tạo account + gửi magic link"
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors disabled:opacity-40"
                        style={{
                          background: 'rgba(168,85,247,0.08)',
                          color: '#c084fc',
                          borderColor: 'rgba(168,85,247,0.25)',
                        }}
                      >
                        {invitingAffiliate === lead.id ? (
                          <span>...</span>
                        ) : (
                          <>
                            <Share2 size={12} />
                            <span>Duyệt Aff</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lead Detail */}
      {selectedLead && (
        <LeadDetail lead={selectedLead} stages={stages} onClose={() => setSelectedLead(null)}
          onUpdate={updated => { setLeads(prev => prev.map(l => l.id === updated.id ? updated : l)); setSelectedLead(updated) }}
        />
      )}

      {/* Quick Action Modal */}
      {quickAction && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={closeQuickAction}>
          <div
            className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white mb-4">
              {quickAction.type === 'call' ? '📞 Gọi điện' : '💬 Zalo'} — {quickAction.lead.name}
            </h3>
            <form onSubmit={handleQuickActionSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Nội dung</label>
                <textarea
                  value={qaContent}
                  onChange={e => setQaContent(e.target.value)}
                  placeholder={quickAction.type === 'call' ? 'Kết quả cuộc gọi...' : 'Nội dung trao đổi qua Zalo...'}
                  required
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Kết quả</label>
                <select
                  value={qaResult}
                  onChange={e => setQaResult(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none"
                >
                  <option value="">-- Chọn kết quả --</option>
                  {RESULT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Hẹn follow-up (tuỳ chọn)</label>
                <input
                  type="date"
                  value={qaFollowUp}
                  onChange={e => setQaFollowUp(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeQuickAction}
                  className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={qaLoading}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >
                  {qaLoading ? 'Đang ghi...' : 'Ghi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Thêm lead</h3>
            <form onSubmit={handleAddLead} className="space-y-4">
              {[{ label: 'Họ tên *', field: 'name', type: 'text', placeholder: 'Nguyen Van A' }, { label: 'Email *', field: 'email', type: 'email', placeholder: 'lead@email.com' }, { label: 'Điện thoại', field: 'phone', type: 'tel', placeholder: '0901234567' }].map(f => (
                <div key={f.field}>
                  <label className="block text-xs text-gray-500 mb-1.5">{f.label}</label>
                  <input type={f.type} value={(newLead as Record<string, string>)[f.field]} onChange={e => setNewLead(p => ({ ...p, [f.field]: e.target.value }))} placeholder={f.placeholder} required={f.label.includes('*')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none" />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Nguồn</label>
                <select value={newLead.source} onChange={e => setNewLead(p => ({ ...p, source: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none">
                  <option value="landing_page">Trang đích</option>
                  <option value="facebook_ad">Quảng cáo FB</option>
                  <option value="referral">Giới thiệu</option>
                  <option value="organic">Tự nhiên</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white transition-colors">Hủy</button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >{addLoading ? 'Đang thêm...' : 'Thêm'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
export default LeadsTable
