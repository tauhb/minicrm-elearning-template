
import React, { useEffect, useState, useMemo } from 'react';
import { Quest, NodeState, Zone, QuestType } from '../types';
import { Lock, Check, Crosshair, ChevronRight, ChevronLeft, Flame, CalendarClock } from 'lucide-react';
import { playSound } from '../services/sound';
import { addDays, format, parseISO } from 'date-fns';

interface GameMapProps {
  quests: Quest[];
  currentDay: number;
  completedQuests: number[];
  zones: Zone[];
  onQuestSelect: (quest: Quest) => void;
  startDate: string; // Add startDate to calculate unlock dates
}

export const GameMap: React.FC<GameMapProps> = ({ 
  quests, 
  currentDay, 
  completedQuests, 
  zones,
  onQuestSelect,
  startDate
}) => {
  const initialZoneIndex = useMemo(() => {
    if (zones.length === 0) return 0;
    const idx = zones.findIndex(z => currentDay >= z.startDay && currentDay <= z.endDay);
    return idx !== -1 ? idx : 0;
  }, [currentDay, zones]);

  const [activeZoneIndex, setActiveZoneIndex] = useState(initialZoneIndex);
  
  useEffect(() => {
    setActiveZoneIndex(initialZoneIndex);
  }, [initialZoneIndex]);

  if (zones.length === 0) return null;

  const activeZone = zones[activeZoneIndex] || zones[0];

  const zoneQuests = useMemo(() => {
    return quests.filter(q => q.zoneId === activeZone.id);
  }, [quests, activeZone]);

  const nextZone = () => {
    playSound('CLICK');
    if (activeZoneIndex < zones.length - 1) setActiveZoneIndex(prev => prev + 1);
  };
  const prevZone = () => {
    playSound('CLICK');
    if (activeZoneIndex > 0) setActiveZoneIndex(prev => prev - 1);
  };

  const generateZonePath = (questCount: number) => {
    if (questCount < 2) return "";
    const width = 1000;
    const height = 400;
    const centerY = height / 2;
    const amplitude = 60;
    
    let d = "";
    
    for (let i = 0; i < questCount; i++) {
      const x = (i / (questCount - 1)) * (width - 160) + 80;
      const y = centerY + (i % 2 === 0 ? amplitude : -amplitude);
      
      if (i === 0) {
        d += `M ${x} ${y}`;
      } else {
        const prevX = ((i - 1) / (questCount - 1)) * (width - 160) + 80;
        const prevY = centerY + ((i - 1) % 2 === 0 ? amplitude : -amplitude);
        
        const cp1x = prevX + (x - prevX) * 0.5;
        const cp1y = prevY;
        const cp2x = prevX + (x - prevX) * 0.5;
        const cp2y = y;
        
        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x} ${y}`;
      }
    }
    return d;
  };

  // Helper to calculate unlock date
  const getUnlockDate = (dayId: number) => {
    try {
      const start = new Date(startDate); // Simple parse, assumes YYYY-MM-DD works or ISO
      // Add (dayId - 1) days
      const unlockDate = addDays(start, dayId - 1);
      return format(unlockDate, 'dd/MM');
    } catch (e) {
      return 'TBD';
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      
      {/* Zone Title / HUD Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/80 backdrop-blur-md z-20 sticky top-0">
         <button 
           onClick={prevZone} 
           disabled={activeZoneIndex === 0}
           className={`p-2 border border-white/10 hover:bg-white/5 transition-colors ${activeZoneIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'text-mission-accent'}`}
         >
           <ChevronLeft size={24} />
         </button>

         <div className="text-center">
            <div className="text-[10px] font-mono text-mission-accent tracking-[0.2em] uppercase mb-1 opacity-80">
              CHẶNG {activeZoneIndex + 1}/{zones.length}
            </div>
            <div className="text-xl font-bold uppercase tracking-wider text-white font-mono">
              <span className="text-mission-accent mr-2">&gt;&gt;</span>
              {activeZone.title}
            </div>
         </div>

         <button 
           onClick={nextZone} 
           disabled={activeZoneIndex === zones.length - 1}
           className={`p-2 border border-white/10 hover:bg-white/5 transition-colors ${activeZoneIndex === zones.length - 1 ? 'opacity-30 cursor-not-allowed' : 'text-mission-accent'}`}
         >
           <ChevronRight size={24} />
         </button>
      </div>

      {/* Main Map Area - Scrollable Container */}
      {/* UPDATED: Changed overflow-y-hidden to overflow-y-auto AND added min-h-[600px] to inner container so it doesn't get cut off on short screens */}
      <div className="flex-1 w-full relative overflow-x-auto overflow-y-auto">
        
        {/* Scroll Surface: Enforces min-width on mobile to allow horizontal scrolling, and MIN HEIGHT vertical */}
        <div className="min-h-[600px] h-full min-w-[600px] md:min-w-full flex items-center justify-center px-12 md:px-0">
          
          {/* Content Wrapper: Contains both Path (SVG) and Nodes */}
          <div className="relative w-full max-w-5xl h-[400px] mx-auto px-8 md:px-16">
            
            {/* Connection Line */}
            <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
              <svg width="100%" height="400" viewBox="0 0 1000 400" preserveAspectRatio="none" className="w-full h-full">
                <path 
                  d={generateZonePath(zoneQuests.length)} 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="1" 
                  className="text-mission-accent dashed-line"
                  strokeDasharray="4 4"
                />
              </svg>
            </div>

            {/* Nodes */}
            {zoneQuests.map((quest, index) => {
              const total = zoneQuests.length;
              const leftPercent = total > 1 ? (index / (total - 1)) * 100 : 50;
              const topOffset = index % 2 === 0 ? 60 : -60;
              
              let state = NodeState.LOCKED;
              
              // Logic state
              if (completedQuests.includes(quest.id)) {
                  state = NodeState.COMPLETED;
              } else if (quest.id === currentDay) {
                  state = NodeState.ACTIVE;
              } else if (quest.id < currentDay) {
                  state = NodeState.COMPLETED; 
              } else {
                  state = NodeState.LOCKED;
              }

              // Drip Check
              if (quest.id > currentDay && !completedQuests.includes(quest.id)) {
                  state = NodeState.LOCKED;
              }

              const isCheckpoint = quest.type === QuestType.CHECKPOINT;
              const unlockDateStr = getUnlockDate(quest.id);

              return (
                <div 
                  key={quest.id}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500"
                  style={{ left: `${leftPercent}%`, marginTop: `${topOffset}px` }}
                >
                  <div className="flex flex-col items-center gap-4 group relative">
                    
                    {/* Status Label (Top) */}
                    <div className={`
                      absolute -top-12 px-2 py-1 text-[10px] font-mono border whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-black z-20 pointer-events-none
                      ${state === NodeState.ACTIVE ? 'border-mission-accent text-mission-accent opacity-100' : 'border-neutral-700 text-neutral-500'}
                    `}>
                      NGÀY_{quest.id.toString().padStart(2, '0')}
                    </div>
                    
                    {/* Floating Fire for Completed State */}
                    {state === NodeState.COMPLETED && (
                      <div className="absolute -top-8 z-30 animate-flicker-fast pointer-events-none">
                        <Flame 
                          size={24} 
                          className="fill-orange-500 text-orange-500 drop-shadow-[0_0_10px_rgba(255,165,0,0.8)]" 
                          strokeWidth={0}
                        />
                      </div>
                    )}

                    {/* Main Node Button */}
                    <button
                      onClick={() => onQuestSelect(quest)}
                      onMouseEnter={() => state !== NodeState.LOCKED && playSound('HOVER')}
                      className={`
                        relative flex items-center justify-center transition-all duration-300
                        ${isCheckpoint ? 'w-16 h-16' : 'w-10 h-10'}
                        
                        /* LOCKED: Dim but Interactive now */
                        ${state === NodeState.LOCKED ? 'bg-neutral-900 border border-neutral-800 text-neutral-700 hover:border-neutral-600' : ''}
                        
                        /* ACTIVE: High Contrast */
                        ${state === NodeState.ACTIVE ? 'bg-mission-accent shadow-[0_0_30px_rgba(182,255,0,0.4)] scale-125 z-10 text-black' : ''}
                        
                        /* COMPLETED: Hollow but Lit */
                        ${state === NodeState.COMPLETED ? 'bg-black border border-mission-accent/60 text-mission-accent/60' : ''}
                        
                        ${state !== NodeState.LOCKED ? 'hover:scale-110 hover:shadow-[0_0_15px_rgba(182,255,0,0.3)]' : ''}
                        cursor-pointer
                      `}
                    >
                      {/* Active Radar Effect */}
                      {state === NodeState.ACTIVE && (
                        <div className="absolute inset-0 border border-mission-accent animate-radar" />
                      )}

                      {/* Icon Logic */}
                      {state === NodeState.LOCKED && (
                        // Dim Faint Fire for Locked
                        <Flame size={14} className="text-neutral-700/50 animate-flicker" />
                      )}
                      
                      {state === NodeState.COMPLETED && (
                        // Checkmark for Completed (Fire is floating above)
                        <Check size={18} strokeWidth={3} />
                      )}
                      
                      {state === NodeState.ACTIVE && (
                        <Crosshair size={24} className="animate-spin-slow" strokeWidth={2.5} />
                      )}
                    </button>

                    {/* Node Title (Bottom) */}
                    <div className={`
                      w-36 text-center text-[10px] font-bold font-mono py-1 px-1 transition-all duration-300
                      ${state === NodeState.ACTIVE ? 'text-mission-accent bg-mission-accent/10 border border-mission-accent/30' : ''}
                      ${state === NodeState.COMPLETED ? 'text-neutral-500 line-through decoration-mission-accent/50' : ''}
                      
                      /* Locked State: Show Date on Hover */
                      ${state === NodeState.LOCKED ? 'text-neutral-600 opacity-0 group-hover:opacity-100' : ''}
                    `}>
                      {state === NodeState.LOCKED ? (
                        <div className="flex flex-col items-center animate-in fade-in duration-300">
                          <span className="text-neutral-400 line-clamp-2 leading-tight">{quest.title}</span>
                          <span className="flex items-center justify-center gap-1 text-mission-accent/60 text-[9px] mt-1 font-normal tracking-wide">
                            <Lock size={8} /> Mở: {unlockDateStr}
                          </span>
                        </div>
                      ) : (
                        quest.title
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zone Navigation / Status Footer */}
      <div className="h-20 border-t border-white/10 bg-black/90 flex items-center justify-center gap-1 px-4 z-20">
          {zones.map((zone, idx) => {
            const isCompleted = completedQuests.length >= zone.endDay;
            const isCurrent = currentDay >= zone.startDay && currentDay <= zone.endDay;
            const isAccessible = currentDay >= zone.startDay;
            
            return (
              <button
                key={zone.id}
                onClick={() => {
                   if (isAccessible) {
                     playSound('CLICK');
                     setActiveZoneIndex(idx);
                   }
                }}
                disabled={!isAccessible}
                className={`
                  flex-1 max-w-[120px] h-full flex flex-col items-center justify-center border-t-2 transition-all relative
                  ${idx === activeZoneIndex ? 'bg-white/5 border-mission-accent' : 'bg-transparent border-transparent hover:bg-white/5'}
                  ${!isAccessible ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <div className={`text-[10px] font-mono mb-1 ${idx === activeZoneIndex ? 'text-mission-accent font-bold' : 'text-neutral-500'}`}>
                   GIAI ĐOẠN 0{zone.id}
                </div>
                <div className="flex gap-0.5">
                   {Array.from({length: 4}).map((_, i) => (
                     <div key={i} className={`w-1 h-1 ${isCompleted ? 'bg-mission-accent' : (isCurrent && idx === activeZoneIndex ? 'bg-mission-accent animate-pulse' : 'bg-neutral-800')}`} />
                   ))}
                </div>
              </button>
            )
          })}
      </div>
    </div>
  );
};
