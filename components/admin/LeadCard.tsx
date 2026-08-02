import React from 'react'
import { Lead } from '../../types'
import { formatDistanceToNow } from 'date-fns'

const SOURCE_COLORS: Record<string, string> = {
  landing_page: 'text-emerald-400 bg-emerald-400/10',
  facebook_ad: 'text-blue-400 bg-blue-400/10',
  referral: 'text-purple-400 bg-purple-400/10',
  organic: 'text-amber-400 bg-amber-400/10',
}

interface Props {
  lead: Lead
  onClick: () => void
}

const LeadCard: React.FC<Props> = ({ lead, onClick }) => (
  <div
    onClick={onClick}
    className="bg-gray-800 border border-gray-700 rounded-lg p-3 cursor-pointer hover:border-indigo-600/50 hover:bg-gray-900/80 transition-all"
  >
    <div className="flex items-start justify-between mb-2">
      <p className="text-sm font-medium text-white leading-tight">{lead.name}</p>
      {lead.source && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_COLORS[lead.source] || 'text-gray-400 bg-gray-700'}`}>
          {lead.source.replace('_', ' ')}
        </span>
      )}
    </div>
    <p className="text-xs text-gray-500 mb-2">{lead.email}</p>
    <div className="flex items-center justify-between">
      {lead.score > 0 && (
        <div className="flex items-center gap-1">
          <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(lead.score, 100)}%` }} />
          </div>
          <span className="text-[10px] text-gray-500">{lead.score}</span>
        </div>
      )}
      <span className="text-[10px] text-gray-600 ml-auto">
        {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
      </span>
    </div>
  </div>
)

export default LeadCard
