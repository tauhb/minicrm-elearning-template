
import React, { useState } from 'react';
import { Quest, Zone, UserProgress, TaskType } from '../types';
import { X, Check, Lock, ChevronDown, ChevronRight, Flame, Database, ExternalLink } from 'lucide-react';
import { playSound } from '../services/sound';

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuest: (quest: Quest) => void;
  zones: Zone[];
  quests: Quest[];
  progress: UserProgress;
}

export const SideMenu: React.FC<SideMenuProps> = ({
  isOpen,
  onClose,
  onSelectQuest,
  zones,
  quests,
  progress,
}) => {
  const [expandedZoneId, setExpandedZoneId] = useState<number | null>(null);

  const toggleZone = (id: number) => {
    playSound('CLICK');
    setExpandedZoneId(expandedZoneId === id ? null : id);
  };

  const handleQuestClick = (quest: Quest, isLocked: boolean) => {
    if (isLocked) return;
    
    // Close menu first, then trigger selection
    playSound('OPEN');
    onClose();
    onSelectQuest(quest);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Slide-in Panel */}
      <div 
        className={`
          fixed top-0 left-0 h-full w-[85vw] md:w-[400px] bg-neutral-900 border-r border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] z-[10000] 
          transform transition-transform duration-300 ease-out flex flex-col
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-white/10 bg-black shrink-0">
          <div className="flex items-center gap-3 text-mission-accent">
            <Database size={20} />
            <h2 className="font-bold font-mono text-sm uppercase tracking-widest">Hành Trình</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-neutral-800">
          {zones.map((zone) => {
            const isExpanded = expandedZoneId === zone.id;
            const zoneQuests = quests.filter(q => q.zoneId === zone.id);
            const completedInZone = zoneQuests.filter(q => progress.completedQuests.includes(q.id)).length;
            const isZoneCompleted = completedInZone === zoneQuests.length && zoneQuests.length > 0;
            const isZoneLocked = zone.startDay > progress.currentDay; 

            return (
              <div key={zone.id} className="mb-2 border border-white/5 bg-black/20 overflow-hidden rounded-sm">
                
                {/* Zone Header */}
                <button 
                  onClick={() => toggleZone(zone.id)}
                  className={`w-full flex items-center justify-between p-4 text-left transition-colors ${isExpanded ? 'bg-white/5' : 'hover:bg-white/5'}`}
                >
                  <div className="flex items-center gap-3">
                     <div className={`p-1.5 rounded-sm ${isZoneCompleted ? 'bg-mission-accent text-black' : (isZoneLocked ? 'bg-neutral-800 text-neutral-600' : 'bg-neutral-800 text-white')}`}>
                        {isZoneLocked ? <Lock size={12} /> : (isZoneCompleted ? <Check size={12} strokeWidth={4} /> : <Database size={12} />)}
                     </div>
                     <div>
                       <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Module 0{zone.id}</div>
                       <div className={`text-sm font-bold uppercase ${isZoneLocked ? 'text-neutral-600' : 'text-white'}`}>{zone.title}</div>
                     </div>
                  </div>
                  {isExpanded ? <ChevronDown size={16} className="text-neutral-500" /> : <ChevronRight size={16} className="text-neutral-500" />}
                </button>

                {/* Quests List */}
                {isExpanded && (
                  <div className="border-t border-white/5 bg-black/40">
                    {zoneQuests.map((quest) => {
                      const isQuestCompleted = progress.completedQuests.includes(quest.id);
                      // Visual lock check for menu items
                      const isQuestLocked = quest.id > progress.currentDay && !isQuestCompleted;

                      return (
                        <div 
                           key={quest.id} 
                           onClick={() => handleQuestClick(quest, isQuestLocked)}
                           className={`
                             p-4 border-b border-white/5 last:border-0 relative transition-all group
                             ${!isQuestLocked 
                               ? 'cursor-pointer hover:bg-white/5 hover:pl-5' // Add interactive styles
                               : 'cursor-not-allowed opacity-60' // Add locked styles
                             }
                           `}
                        >
                           {/* Connecting Line for Tree Effect */}
                           <div className="absolute left-6 top-0 bottom-0 w-px bg-white/5" />
                           
                           <div className="relative pl-8">
                              {/* Connector */}
                              <div className="absolute left-[-1px] top-3 w-4 h-px bg-white/10" />

                              {/* Quest Header */}
                              <div className="flex items-start justify-between">
                                <div className="flex items-start gap-2 mb-3">
                                  <div className={`mt-0.5 shrink-0 transition-colors ${isQuestCompleted ? 'text-mission-accent' : (isQuestLocked ? 'text-neutral-700' : 'text-orange-500')}`}>
                                     {isQuestCompleted ? <Flame size={14} className="fill-mission-accent" /> : (isQuestLocked ? <Lock size={12} /> : <Flame size={14} className="animate-pulse" />)}
                                  </div>
                                  <div>
                                     <div className={`text-xs font-bold leading-tight mb-1 flex items-center gap-2 ${isQuestLocked ? 'text-neutral-600' : 'text-gray-300 group-hover:text-mission-accent'}`}>
                                        <span className="font-mono text-[10px] text-neutral-500">DAY {quest.id}</span>
                                        {quest.title}
                                     </div>
                                     {isQuestCompleted && (
                                       <span className="text-[9px] font-mono text-mission-accent bg-mission-accent/10 px-1.5 py-0.5 rounded-xs">
                                         ĐÃ HOÀN THÀNH
                                       </span>
                                     )}
                                  </div>
                                </div>

                                {/* Link Icon indicator on Hover if unlocked */}
                                {!isQuestLocked && (
                                  <ExternalLink size={14} className="text-mission-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                                )}
                              </div>

                              {/* Tasks Checklist (Only show if unlocked) */}
                              {!isQuestLocked && (
                                <div className="space-y-2 pl-2">
                                  {quest.tasks.map(task => {
                                    const isTaskDone = (progress.completedTasks[quest.id] || []).includes(task.id);
                                    return (
                                      <div key={task.id} className="flex items-start gap-2">
                                         <div className={`
                                           w-3 h-3 mt-0.5 border flex items-center justify-center shrink-0
                                           ${isTaskDone ? 'bg-mission-accent border-mission-accent' : 'border-neutral-700 bg-transparent'}
                                         `}>
                                            {isTaskDone && <Check size={8} className="text-black stroke-[4]" />}
                                         </div>
                                         <span className={`text-[10px] leading-snug ${isTaskDone ? 'text-neutral-500 line-through' : 'text-neutral-400'}`}>
                                           {task.text}
                                         </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                           </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            );
          })}
        </div>

      </div>
    </>
  );
};
