
import React, { useState, useEffect, useMemo } from 'react';
import { UserProgress, Student, LeaderboardEntry } from '../types';
import { X, Trophy, Flame, Medal, Shield, Crown, Zap, Loader2, Calendar, Globe } from 'lucide-react';
import { playSound } from '../services/sound';
import { calculateXP, fetchLeaderboard, getWeekID } from '../services/api';

interface LeaderboardViewProps {
  student: Student;
  progress: UserProgress;
  onClose: () => void;
}

type FilterMode = 'WEEKLY' | 'ALL_TIME';

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({ student, progress, onClose }) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>('WEEKLY');
  
  // Calculate current user's REAL-TIME stats to override stale server data
  const currentUserRealtimeXP = useMemo(() => calculateXP(progress), [progress]);
  const currentWeekID = getWeekID();

  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      setLoading(true);
      try {
        const data = await fetchLeaderboard(student.khoa || undefined);
        if (isMounted) setEntries(data);
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => { isMounted = false; };
  }, [student.khoa]);

  // --- FILTERING & SORTING LOGIC ---
  const processedEntries = useMemo(() => {
    // Cohort filter đã bỏ — cohort không còn ở `customers`, giờ ở enrollment-level.
    // Hiển thị toàn bộ student để bảng vẫn hoạt động đến khi triển khai cohort-aware leaderboard.
    let filtered = [...entries];

    // 2. Handle Current User Entry (Upsert Logic)
    // The server data might not have the user yet (if they just joined) or be stale.
    // We construct a fresh entry for the current user.
    const currentUserEntry: LeaderboardEntry = {
      rank: 0,
      student_code: student.student_code,
      display_name: student.display_name,
      khoa: student.khoa,
      total_xp: currentUserRealtimeXP,
      // For weekly XP, if we are in 'WEEKLY' mode, we might want to trust the server 
      // OR if we can't calc it client side, we fallback to total.
      // Since we can't accurately calc weekly delta client-side without timestamps,
      // we will use the Server's weekly_xp for display, unless it's missing (new user).
      weekly_xp: 0, // Placeholder, will be mapped from found entry or 0
      week_id: currentWeekID,
      streak: progress.streak,
      is_current_user: true,
      avatar_color: "bg-mission-accent"
    };

    // Find if user exists in fetched data to get their server-side Weekly XP
    const existingUserIndex = filtered.findIndex(e => e.student_code === student.student_code);
    
    if (existingUserIndex !== -1) {
      // User exists: Update their Total XP with Realtime XP (Client is truth for Total)
      // Keep Server's Weekly XP because Client can't calculate delta easily.
      const existing = filtered[existingUserIndex];
      
      // If the week_id on server matches current week, use stored weekly_xp. Else 0.
      const serverWeekMatch = existing.week_id === currentWeekID;
      
      currentUserEntry.weekly_xp = serverWeekMatch ? existing.weekly_xp : 0;
      
      // Replace in array
      filtered[existingUserIndex] = currentUserEntry;
    } else {
      // User doesn't exist in sheet yet: Add them
      // FIX: If user is not in DB yet, assume they are new, so Weekly XP = Total XP (started this week)
      currentUserEntry.weekly_xp = currentUserEntry.total_xp;
      filtered.push(currentUserEntry);
    }

    // 3. Filter by Timeframe (Weekly vs All Time)
    // Logic: 
    // - ALL_TIME: Sort by total_xp.
    // - WEEKLY: Sort by weekly_xp. Only show users who have activity this week? 
    //   Or just show everyone with 0? usually just show everyone sorted by weekly.
    
    if (filterMode === 'WEEKLY') {
      // Reset weekly_xp to 0 for anyone whose week_id doesn't match current week
      filtered = filtered.map(e => ({
        ...e,
        weekly_xp: e.week_id === currentWeekID ? e.weekly_xp : 0
      }));

      // Sort by Weekly XP
      filtered.sort((a, b) => b.weekly_xp - a.weekly_xp);
    } else {
      // Sort by Total XP
      filtered.sort((a, b) => b.total_xp - a.total_xp);
    }

    // 4. Assign Ranks
    return filtered.map((e, idx) => ({ ...e, rank: idx + 1 }));

  }, [entries, student, currentUserRealtimeXP, progress.streak, filterMode, currentWeekID]);

  const currentUserEntry = processedEntries.find(e => e.is_current_user);

  // Colors for avatars
  const avatarColors = [
    "bg-red-500", "bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-teal-500"
  ];

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/95 backdrop-blur-md p-0 md:p-6">
       
      {/* Main Card */}
      <div className="w-full h-full md:w-[600px] md:h-[80vh] bg-black border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col relative overflow-hidden rounded-sm">
        
        {/* Background Effects */}
        <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-mission-accent/10 to-transparent pointer-events-none" />

        {/* --- Header --- */}
        <div className="relative p-6 border-b border-white/10 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-yellow-500/20 border border-yellow-500/50 flex items-center justify-center rounded-sm">
               <Trophy size={20} className="text-yellow-500 fill-yellow-500 animate-pulse" />
             </div>
             <div>
               <h2 className="font-bold text-white text-lg tracking-widest font-mono uppercase leading-none mb-1">Bảng Vàng</h2>
               <p className="text-[10px] text-neutral-500 font-mono uppercase">
                 Bảng Xếp Hạng <span className="text-mission-accent font-bold">{student.khoa}</span>
               </p>
             </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-neutral-500 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        {/* --- Filter Tabs --- */}
        <div className="flex border-b border-white/10 z-10 bg-black/50">
          <button 
            onClick={() => { playSound('CLICK'); setFilterMode('WEEKLY'); }}
            className={`flex-1 py-3 text-[10px] font-bold font-mono uppercase tracking-widest flex items-center justify-center gap-2 transition-colors
              ${filterMode === 'WEEKLY' ? 'bg-white/10 text-mission-accent border-b-2 border-mission-accent' : 'text-neutral-500 hover:bg-white/5'}
            `}
          >
            <Calendar size={12} /> Tuần Này
          </button>
          <button 
            onClick={() => { playSound('CLICK'); setFilterMode('ALL_TIME'); }}
            className={`flex-1 py-3 text-[10px] font-bold font-mono uppercase tracking-widest flex items-center justify-center gap-2 transition-colors
              ${filterMode === 'ALL_TIME' ? 'bg-white/10 text-mission-accent border-b-2 border-mission-accent' : 'text-neutral-500 hover:bg-white/5'}
            `}
          >
            <Globe size={12} /> Tổng Chiến Dịch
          </button>
        </div>

        {/* --- Top 3 Podium (Visual) --- */}
        <div className="flex items-end justify-center gap-4 py-6 border-b border-white/10 relative shrink-0 min-h-[180px]">
           {loading ? (
             <div className="absolute inset-0 flex items-center justify-center">
               <Loader2 className="animate-spin text-mission-accent" />
             </div>
           ) : (
             <>
               {/* Rank 2 */}
               {processedEntries[1] && (
                 <div className="flex flex-col items-center">
                    <div className="text-[10px] font-mono text-neutral-500 mb-1 flex items-center gap-1">
                       <Medal size={12} className="text-gray-400" /> TOP 2
                    </div>
                    <div className="w-16 h-16 rounded-full border-2 border-gray-400 p-1 mb-2 relative">
                       <div className="w-full h-full bg-gray-400/20 rounded-full flex items-center justify-center text-xs font-bold text-gray-400 uppercase">
                         {processedEntries[1].display_name.substring(0,2)}
                       </div>
                    </div>
                    <div className="w-20 h-24 bg-gradient-to-t from-gray-900 to-gray-800 border-t-4 border-gray-400 flex flex-col items-center justify-end pb-2">
                       <span className="font-bold text-gray-200 text-xs truncate max-w-full px-1">{processedEntries[1].display_name}</span>
                       <span className="font-mono text-[10px] text-mission-accent">
                         {(filterMode === 'WEEKLY' ? processedEntries[1].weekly_xp : processedEntries[1].total_xp).toLocaleString()} XP
                       </span>
                    </div>
                 </div>
               )}

               {/* Rank 1 */}
               {processedEntries[0] && (
                 <div className="flex flex-col items-center z-10 -mx-2">
                    <div className="text-xs font-bold font-mono text-yellow-500 mb-1 flex items-center gap-1 animate-bounce-gentle">
                       <Crown size={14} className="fill-yellow-500" /> QUÁN QUÂN
                    </div>
                    <div className="w-20 h-20 rounded-full border-2 border-yellow-500 p-1 mb-2 relative shadow-[0_0_20px_rgba(234,179,8,0.4)]">
                       <div className="w-full h-full bg-yellow-500/20 rounded-full flex items-center justify-center text-sm font-bold text-yellow-500 uppercase">
                         {processedEntries[0].display_name.substring(0,2)}
                       </div>
                       <div className="absolute -bottom-2 -right-2 bg-yellow-500 text-black font-bold text-[10px] w-6 h-6 flex items-center justify-center rounded-full border-2 border-black">
                         1
                       </div>
                    </div>
                    <div className="w-24 h-32 bg-gradient-to-t from-yellow-900/40 to-yellow-900/20 border-t-4 border-yellow-500 flex flex-col items-center justify-end pb-4">
                       <span className="font-bold text-yellow-100 text-sm truncate max-w-full px-1">{processedEntries[0].display_name}</span>
                       <span className="font-mono text-xs text-mission-accent font-bold">
                         {(filterMode === 'WEEKLY' ? processedEntries[0].weekly_xp : processedEntries[0].total_xp).toLocaleString()} XP
                       </span>
                    </div>
                 </div>
               )}

               {/* Rank 3 */}
               {processedEntries[2] && (
                 <div className="flex flex-col items-center">
                    <div className="text-[10px] font-mono text-neutral-500 mb-1 flex items-center gap-1">
                       <Medal size={12} className="text-orange-700" /> TOP 3
                    </div>
                    <div className="w-16 h-16 rounded-full border-2 border-orange-700 p-1 mb-2 relative">
                       <div className="w-full h-full bg-orange-700/20 rounded-full flex items-center justify-center text-xs font-bold text-orange-700 uppercase">
                         {processedEntries[2].display_name.substring(0,2)}
                       </div>
                    </div>
                    <div className="w-20 h-20 bg-gradient-to-t from-orange-950 to-neutral-900 border-t-4 border-orange-700 flex flex-col items-center justify-end pb-2">
                       <span className="font-bold text-gray-300 text-xs truncate max-w-full px-1">{processedEntries[2].display_name}</span>
                       <span className="font-mono text-[10px] text-mission-accent">
                         {(filterMode === 'WEEKLY' ? processedEntries[2].weekly_xp : processedEntries[2].total_xp).toLocaleString()} XP
                       </span>
                    </div>
                 </div>
               )}
               
               {/* Empty State for Top 3 */}
               {processedEntries.length === 0 && !loading && (
                 <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-xs font-mono">
                   Chưa có dữ liệu cho bảng xếp hạng này.
                 </div>
               )}
             </>
           )}
        </div>

        {/* --- List View (Rank 4+) --- */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-neutral-800">
           {processedEntries.slice(3).map((entry, idx) => (
             <div 
               key={idx}
               className={`
                 flex items-center gap-3 p-3 rounded-sm border transition-colors
                 ${entry.is_current_user 
                    ? 'bg-mission-accent/10 border-mission-accent/50' 
                    : 'bg-white/5 border-transparent hover:border-white/10'}
               `}
             >
                <div className="w-8 h-8 flex items-center justify-center font-mono font-bold text-neutral-500 text-sm">
                   #{entry.rank}
                </div>
                
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 uppercase ${entry.is_current_user ? 'bg-mission-accent text-black' : (avatarColors[idx % avatarColors.length])}`}>
                   {entry.display_name.substring(0,2)}
                </div>

                <div className="flex-1 min-w-0">
                   <div className={`text-sm font-bold truncate ${entry.is_current_user ? 'text-mission-accent' : 'text-gray-300'}`}>
                     {entry.display_name} {entry.is_current_user && "(Bạn)"}
                   </div>
                   <div className="flex items-center gap-3 text-[10px] text-neutral-500 font-mono">
                      <span className="flex items-center gap-1">
                        <Zap size={10} /> 
                        {(filterMode === 'WEEKLY' ? entry.weekly_xp : entry.total_xp).toLocaleString()} XP
                      </span>
                      <span className="flex items-center gap-1"><Flame size={10} className={entry.streak > 0 ? "text-orange-500" : ""} /> {entry.streak} Ngày Streak</span>
                   </div>
                </div>
             </div>
           ))}
           <div className="h-16"></div> {/* Spacer for sticky footer */}
        </div>

        {/* --- Sticky Footer (My Rank) --- */}
        {currentUserEntry && (
          <div className="absolute bottom-0 left-0 right-0 bg-neutral-900 border-t border-mission-accent p-4 z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.8)]">
             <div className="flex items-center gap-4">
                <div className="flex flex-col items-center">
                   <span className="text-[10px] text-neutral-500 font-mono uppercase">Hạng</span>
                   <span className="text-xl font-bold text-white font-mono">#{currentUserEntry.rank}</span>
                </div>
                
                <div className="h-8 w-px bg-white/10" />

                <div className="flex-1">
                   <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-mission-accent">{currentUserEntry.display_name}</span>
                      <span className="text-sm font-bold text-white font-mono">
                        {(filterMode === 'WEEKLY' ? currentUserEntry.weekly_xp : currentUserEntry.total_xp).toLocaleString()} XP
                      </span>
                   </div>
                   {/* Mini progress bar visual */}
                   <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div className="h-full bg-mission-accent w-[100%] opacity-50"></div>
                   </div>
                   <div className="text-[9px] text-neutral-500 mt-1 text-right">
                      {filterMode === 'WEEKLY' ? 'Điểm tích lũy trong tuần này' : 'Tổng điểm tích lũy toàn hành trình'}
                   </div>
                </div>
             </div>
          </div>
        )}

      </div>
    </div>
  );
};
