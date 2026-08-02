import React, { useEffect, useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { fetchLeads, fetchPipelineStages, updateLead, createLead } from '../../services/api'
import { Lead, PipelineStage } from '../../types'
import LeadCard from './LeadCard'
import LeadDetail from './LeadDetail'

const LeadsPipeline: React.FC = () => {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [showAddLead, setShowAddLead] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', email: '', source: 'landing_page', phone: '' })
  const [addLoading, setAddLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const [s, l] = await Promise.all([fetchPipelineStages(), fetchLeads()])
    setStages(s)
    setLeads(l)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const leadsInStage = (stageId: string) => leads.filter(l => l.pipeline_stage_id === stageId)
  const unassigned = leads.filter(l => !l.pipeline_stage_id)

  const handleDrop = async (stageId: string) => {
    if (!draggedId) return
    const lead = leads.find(l => l.id === draggedId)
    if (!lead || lead.pipeline_stage_id === stageId) return
    setLeads(prev => prev.map(l => l.id === draggedId ? { ...l, pipeline_stage_id: stageId } : l))
    await updateLead(draggedId, { pipeline_stage_id: stageId })
    setDraggedId(null)
  }

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddLoading(true)
    const firstStage = stages[0]
    const created = await createLead({
      ...newLead,
      phone: newLead.phone || null,
      pipeline_stage_id: firstStage?.id || null,
    })
    if (created) {
      setLeads(prev => [created, ...prev])
      setNewLead({ name: '', email: '', source: 'landing_page', phone: '' })
      setShowAddLead(false)
    }
    setAddLoading(false)
  }

  // Display all stages + an "Unassigned" column if needed
  const displayStages: PipelineStage[] = unassigned.length > 0
    ? [{ id: '', name: 'Chưa phân loại', color: '#6b7280', order_index: -1, is_won: false, is_lost: false }, ...stages]
    : stages

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Quy Trình Sale</h1>
          <p className="text-gray-500 text-sm mt-1">{leads.length} khách hàng tiềm năng</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowAddLead(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
          >
            <Plus size={16} />
            Thêm KHTN
          </button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="w-64 shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="h-4 bg-gray-800 rounded animate-pulse mb-4" />
              {[...Array(3)].map((_, j) => <div key={j} className="h-20 bg-gray-800 rounded animate-pulse mb-2" />)}
            </div>
          ))
        ) : displayStages.map(stage => {
          const stageLeads = stage.id ? leadsInStage(stage.id) : unassigned
          return (
            <div
              key={stage.id || 'unassigned'}
              className="w-72 shrink-0 bg-gray-900 border border-gray-800 rounded-xl flex flex-col max-h-full"
              onDragOver={e => e.preventDefault()}
              onDrop={() => stage.id ? handleDrop(stage.id) : undefined}
            >
              {/* Column Header */}
              <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-sm font-medium text-white">{stage.name}</span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                  {stageLeads.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {stageLeads.map(lead => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => setDraggedId(lead.id)}
                    onDragEnd={() => setDraggedId(null)}
                  >
                    <LeadCard lead={lead} onClick={() => setSelectedLead(lead)} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Lead Detail */}
      {selectedLead && (
        <LeadDetail
          lead={selectedLead}
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onUpdate={(updated) => {
            setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
            setSelectedLead(updated)
          }}
        />
      )}

      {/* Add Lead Modal */}
      {showAddLead && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Thêm KHTN</h3>
              <button onClick={() => setShowAddLead(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddLead} className="space-y-4">
              {[
                { label: 'Họ tên *', field: 'name', type: 'text', placeholder: 'Nguyen Van A' },
                { label: 'Email *', field: 'email', type: 'email', placeholder: 'lead@email.com' },
                { label: 'Điện thoại', field: 'phone', type: 'tel', placeholder: '0901234567' },
              ].map(f => (
                <div key={f.field}>
                  <label className="block text-xs text-gray-500 mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    value={(newLead as any)[f.field]}
                    onChange={e => setNewLead(p => ({ ...p, [f.field]: e.target.value }))}
                    placeholder={f.placeholder}
                    required={f.label.includes('*')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:outline-none"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Nguồn</label>
                <select
                  value={newLead.source}
                  onChange={e => setNewLead(p => ({ ...p, source: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none focus:outline-none"
                >
                  <option value="landing_page">Trang đích</option>
                  <option value="facebook_ad">Quảng cáo FB</option>
                  <option value="referral">Giới thiệu</option>
                  <option value="organic">Tự nhiên</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddLead(false)}
                  className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-white transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-mission-accent)', color: '#000' }}
                >
                  {addLoading ? 'Đang thêm...' : 'Thêm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeadsPipeline
