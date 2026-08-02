import React, { useState, useMemo } from 'react'
import { CheckCircle2, Circle, Lock, ChevronDown, ChevronRight, PlayCircle, BookOpen, Zap } from 'lucide-react'
import { Quest, Zone } from '../types'

interface Progress {
  completedQuests: number[]
  currentDay: number
}

interface Props {
  zones:          Zone[]
  quests:         Quest[]
  progress:       Progress
  currentDay:     number
  maxAllowedDay:  number
  startDate:      string
  isAdmin?:       boolean
  onQuestSelect:  (quest: Quest) => void
}

const ModuleView: React.FC<Props> = ({
  zones, quests, progress, currentDay, maxAllowedDay,
  startDate, isAdmin, onQuestSelect,
}) => {
  // Collapse state per zone — all open by default
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

  const toggleZone = (zoneId: number) =>
    setCollapsed(prev => ({ ...prev, [zoneId]: !prev[zoneId] }))

  // Group quests by zone
  const questsByZone = useMemo(() => {
    const map: Record<number, Quest[]> = {}
    zones.forEach(z => { map[z.id] = [] })
    quests.forEach(q => {
      if (map[q.zoneId] !== undefined) map[q.zoneId].push(q)
      else map[0] = [...(map[0] || []), q]
    })
    return map
  }, [zones, quests])

  const totalQuests     = quests.length
  const completedCount  = progress.completedQuests.length
  const pct             = totalQuests > 0 ? Math.round((completedCount / totalQuests) * 100) : 0

  const getQuestState = (quest: Quest): 'completed' | 'current' | 'available' | 'locked' => {
    if (progress.completedQuests.includes(quest.id)) return 'completed'
    if (isAdmin) return 'available'
    const unlocked = quest.id <= progress.currentDay && quest.id <= maxAllowedDay
    if (!unlocked) return 'locked'
    if (quest.id === currentDay) return 'current'
    return 'available'
  }

  return (
    <div className="h-full flex flex-col portal-bg" style={{ background: 'var(--theme-bg)' }}>

      {/* Progress bar */}
      <div className="px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-text)' }}>
            Tiến độ khoá học
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--color-mission-accent)' }}>
            {completedCount}/{totalQuests} bài · {pct}%
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--theme-surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: 'var(--color-mission-accent)' }}
          />
        </div>
      </div>

      {/* Module list */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-4 px-4 space-y-2">
          {zones.map(zone => {
            const zoneQuests = questsByZone[zone.id] || []
            if (zoneQuests.length === 0) return null
            const isOpen = !collapsed[zone.id]
            const zoneDone = zoneQuests.filter(q => progress.completedQuests.includes(q.id)).length

            return (
              <div
                key={zone.id}
                className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}
              >
                {/* Zone header */}
                <button
                  onClick={() => toggleZone(zone.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors"
                  style={{ background: 'var(--theme-surface)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--theme-surface)')}
                >
                  {/* Color dot */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: zone.color || 'var(--color-mission-accent)' }}
                  />
                  <span className="flex-1 text-sm font-bold" style={{ color: 'var(--theme-text)' }}>
                    {zone.title}
                  </span>
                  <span className="text-xs mr-2 shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                    {zoneDone}/{zoneQuests.length}
                  </span>
                  {isOpen
                    ? <ChevronDown size={14} style={{ color: 'var(--theme-text-muted)' }} />
                    : <ChevronRight size={14} style={{ color: 'var(--theme-text-muted)' }} />
                  }
                </button>

                {/* Quest list */}
                {isOpen && (
                  <div className="border-t divide-y" style={{ borderColor: 'var(--theme-border)' }}>
                    {zoneQuests.map(quest => {
                      const state = getQuestState(quest)
                      const hasVideo = (quest.videos?.length ?? 0) > 0

                      const stateStyle: Record<string, { icon: React.ReactNode; color: string; opacity: string }> = {
                        completed: {
                          icon: <CheckCircle2 size={16} />,
                          color: '#34d399',
                          opacity: '1',
                        },
                        current: {
                          icon: <Zap size={16} />,
                          color: 'var(--color-mission-accent)',
                          opacity: '1',
                        },
                        available: {
                          icon: hasVideo ? <PlayCircle size={16} /> : <BookOpen size={16} />,
                          color: 'var(--theme-text-muted)',
                          opacity: '1',
                        },
                        locked: {
                          icon: <Lock size={14} />,
                          color: 'var(--theme-text-subtle)',
                          opacity: '0.5',
                        },
                      }

                      const s = stateStyle[state]
                      const clickable = state !== 'locked'

                      return (
                        <button
                          key={quest.id}
                          onClick={() => clickable && onQuestSelect(quest)}
                          disabled={!clickable}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left group transition-colors"
                          style={{
                            opacity: s.opacity,
                            cursor: clickable ? 'pointer' : 'default',
                            background: 'var(--theme-surface)',
                          }}
                          onMouseEnter={e => clickable && (e.currentTarget.style.background = 'var(--theme-surface-2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'var(--theme-surface)')}
                        >
                          {/* Status icon */}
                          <span className="shrink-0" style={{ color: s.color }}>
                            {s.icon}
                          </span>

                          {/* Quest info */}
                          <span className="flex-1 min-w-0">
                            <span
                              className="text-xs font-mono block"
                              style={{ color: 'var(--theme-text-muted)' }}
                            >
                              Ngày {quest.id}
                            </span>
                            <span
                              className="text-sm font-medium block truncate"
                              style={{ color: state === 'locked' ? 'var(--theme-text-muted)' : 'var(--theme-text)' }}
                            >
                              {quest.title}
                            </span>
                          </span>

                          {/* Current badge */}
                          {state === 'current' && (
                            <span
                              className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold"
                              style={{
                                background: 'rgba(var(--color-mission-accent-rgb,182,255,0),0.15)',
                                color: 'var(--color-mission-accent)',
                              }}
                            >
                              Hôm nay
                            </span>
                          )}

                          {/* Video indicator */}
                          {hasVideo && state !== 'locked' && state !== 'current' && (
                            <PlayCircle size={12} className="shrink-0" style={{ color: 'var(--theme-text-subtle)' }} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ModuleView
