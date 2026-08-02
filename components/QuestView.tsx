
import React, { useState, useEffect } from 'react';
import { Quest, QuestType, TaskType, UserProgress, Student } from '../types';
import { 
  Check, Award, ArrowRight, ShieldAlert, X, 
  PlayCircle, FileText, Link as LinkIcon, Upload,
  Tv, Briefcase, Video, History, Clock, ExternalLink, RefreshCw,
  ChevronLeft, ChevronRight, Zap, ChevronDown, ChevronUp, AlignLeft
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { insertSubmission } from '../services/api';
import { playSound } from '../services/sound';
import { useDialog } from '../contexts/DialogContext';
import { format } from 'date-fns';

interface QuestViewProps {
  student: Student;
  quest: Quest;
  progress: UserProgress;
  onClose: () => void;
  onCompleteTask: (questId: number, taskId: string, checked: boolean) => void;
  onCompleteQuest: (questId: number) => void;
  onToggleVideoWatched?: (questId: number, videoIndex: number) => void;
  onAddSubmission: (questId: number, content: string) => void;
}

type Tab = 'INSTRUCTION' | 'TASKS' | 'SUBMISSION';

// Helper function to normalize URLs
const normalizeUrl = (url: string) => {
  if (!url) return '#';
  url = url.trim();
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://${url}`;
};

export const QuestView: React.FC<QuestViewProps> = ({ 
  student,
  quest, 
  progress, 
  onClose, 
  onCompleteTask, 
  onCompleteQuest,
  onToggleVideoWatched,
  onAddSubmission
}) => {
  const { alert: showAlert } = useDialog();
  const [activeTab, setActiveTab] = useState<Tab>('INSTRUCTION');
  const [submissionText, setSubmissionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResubmit, setShowResubmit] = useState(false);
  
  // Video state management
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  
  // Text Resource Accordion State
  const [openTextResource, setOpenTextResource] = useState<number | null>(null);

  const videos = quest.videos || [];
  const currentVideo = videos.length > 0 ? videos[currentVideoIndex] : null;

  const completedTaskIds = progress.completedTasks[quest.id] || [];
  const watchedVideoIndices = progress.watchedVideos?.[quest.id] || [];
  const isQuestCompleted = progress.completedQuests.includes(quest.id);
  const submissionsHistory = progress.submissions?.[quest.id] || [];

  const mandatoryTasks = quest.tasks.filter(t => t.type === TaskType.MANDATORY);
  const optionalTasks = quest.tasks.filter(t => t.type === TaskType.OPTIONAL);

  const mandatoryCompletedCount = mandatoryTasks.filter(t => completedTaskIds.includes(t.id)).length;
  const isReadyToSubmit = mandatoryCompletedCount === mandatoryTasks.length;

  // --- XP CALCULATION LOGIC ---
  const XP_VALUES = {
    QUEST_COMPLETION: 500,
    TASK: 50,
    VIDEO: 20,
    SUBMISSION: 0 // Changed from 100 to 0 (Requirement only, no extra XP)
  };

  const totalTasks = quest.tasks.length;
  const totalVideos = videos.length;
  
  // Calculate Potential MAX XP for this specific quest
  const maxXP = 
    XP_VALUES.QUEST_COMPLETION + 
    (totalTasks * XP_VALUES.TASK) + 
    (totalVideos * XP_VALUES.VIDEO) + 
    XP_VALUES.SUBMISSION;
    
  // Calculate Current Earned XP
  const currentXP = 
    (isQuestCompleted ? XP_VALUES.QUEST_COMPLETION : 0) +
    (completedTaskIds.length * XP_VALUES.TASK) +
    (watchedVideoIndices.length * XP_VALUES.VIDEO) +
    (submissionsHistory.length > 0 ? XP_VALUES.SUBMISSION : 0); // Count submission XP once for the bar visual

  const xpPercentage = Math.min(100, Math.round((currentXP / maxXP) * 100));
  
  // --- END XP LOGIC ---

  const handleComplete = async () => {
    setIsSubmitting(true);

    try {
      // 1. Submit to Supabase via API
      await insertSubmission(student.student_code, quest.id, submissionText);

      // 2. Save to Local Storage History
      onAddSubmission(quest.id, submissionText);

      // 3. Play Success Sound IMMEDIATELY
      playSound('SUCCESS');

      // 4. Trigger Confetti
      confetti({
        particleCount: 150,
        spread: 60,
        colors: ['#B6FF00', '#FFFFFF'],
        zIndex: 10002
      });

      // 5. Update Local Progress and Close
      setTimeout(() => {
        onCompleteQuest(quest.id);
        setIsSubmitting(false);
        setSubmissionText(''); // Clear text
        setShowResubmit(false); // Reset resubmit view
        onClose();
      }, 1500); 

    } catch (error) {
      showAlert({
        title: 'Nộp bài thất bại',
        message: 'Có lỗi khi nộp bài. Vui lòng kiểm tra kết nối mạng và thử lại.',
        variant: 'danger',
      });
      setIsSubmitting(false);
    }
  };

  const handlePrevVideo = () => {
    if (currentVideoIndex > 0) {
      playSound('CLICK');
      setCurrentVideoIndex(prev => prev - 1);
    }
  };

  const handleNextVideo = () => {
    if (currentVideoIndex < videos.length - 1) {
      playSound('CLICK');
      setCurrentVideoIndex(prev => prev + 1);
    }
  };

  const hasPreparation = quest.preparationTasks && quest.preparationTasks.length > 0;
  const isCheckpoint = quest.type === QuestType.CHECKPOINT;

  // Render Video Player (Conditional for Drive Iframe vs MP4 Video)
  const renderVideoPlayer = () => {
    if (!currentVideo) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-neutral-600">
          <Tv size={64} className="mb-4 opacity-20" />
          <p className="font-mono text-xs uppercase tracking-widest opacity-50">KHÔNG CÓ TÍN HIỆU</p>
        </div>
      );
    }

    // Check if it is a Google Drive PREVIEW/VIEW link (Embed mode)
    const isDriveEmbed = currentVideo.url.includes('drive.google.com') && 
                        (currentVideo.url.includes('/preview') || currentVideo.url.includes('/view'));

    if (isDriveEmbed) {
      return (
        <div className="w-full h-full bg-black">
          <iframe
            src={currentVideo.url}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen"
            title={currentVideo.title}
          />
        </div>
      );
    }

    // Default to MP4 Player for standard links
    return (
      <video
        key={`${quest.id}-video-${currentVideoIndex}`} // Force re-render when video changes
        className="w-full h-full object-contain bg-black"
        controls
        autoPlay
        playsInline
        controlsList="nodownload" // Chrome/Edge: Hides download button
        onContextMenu={(e) => e.preventDefault()} // Disables Right Click (Save As)
        src={currentVideo.url}
        onEnded={() => {
          // Auto-advance to next video if available
          if (currentVideoIndex < videos.length - 1) {
             setCurrentVideoIndex(prev => prev + 1);
          }
        }}
      >
        <source src={currentVideo.url} type="video/mp4" />
        Trình duyệt của bạn không hỗ trợ thẻ video.
      </video>
    );
  };

  return (
    // UPDATED WRAPPER:
    // 1. Added `overflow-y-auto` and `block` (instead of flex center) to allow window scrolling on mobile/small screens.
    // 2. Centering is handled via `mx-auto` and `my-auto` inside.
    <div className="fixed inset-0 z-[10001] bg-black/95 backdrop-blur-md overflow-y-auto overflow-x-hidden block lg:overflow-hidden lg:flex lg:items-center lg:justify-center">
      
      {/* 
        MAIN CONTAINER 
        - Mobile: w-full, min-h-screen (grows with content)
        - Desktop (lg): w-[95vw] h-[85vh], centered vertically, internal scroll
      */}
      <div className="
        relative w-full bg-black border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)] 
        flex flex-col lg:grid lg:grid-cols-12
        
        min-h-screen md:min-h-0 md:h-auto 
        
        md:w-[95vw] md:mx-auto md:my-8 
        
        lg:h-[90vh] lg:rounded-sm lg:overflow-hidden lg:max-w-[1600px]
      ">
        
        {/* --- CLOSE BUTTON (Global) --- */}
        <button 
          onClick={onClose} 
          className="absolute top-3 right-3 z-[50000] p-2 bg-neutral-900/80 text-white hover:text-mission-accent hover:bg-neutral-800 rounded-full border border-white/10 hover:border-mission-accent transition-all"
        >
          <X size={20} />
        </button>

        {/* 
            MOBILE SCROLL WRAPPER 
            - On Mobile: This wrapper just renders content. The outer Fixed div handles scrolling.
            - On Desktop: This wrapper is `contents`, passing children to Grid.
        */}
        <div className="contents">

          {/* =========================================================================
              LEFT COLUMN: VIDEO & CONTEXT (Desktop: 8/12 cols)
             ========================================================================= */}
          <div className="lg:col-span-8 bg-black relative flex flex-col border-b lg:border-b-0 lg:border-r border-white/10 group shrink-0 lg:h-full">
            {/* Grid Background Effect */}
            <div className="absolute inset-0 grid-bg opacity-10 pointer-events-none" />

            {/* Content Wrapper */}
            <div className="flex-1 min-h-0 flex flex-col p-0 lg:p-10 lg:overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
              
              {/* 1. VIDEO PLAYER (Dynamic: Iframe or MP4) */}
              <div className="w-full aspect-video shadow-2xl relative z-[10000] bg-neutral-900 border border-neutral-800 mb-6 lg:mb-8 shrink-0 flex items-center justify-center overflow-hidden">
                 {renderVideoPlayer()}
              </div>

              {/* 2. TITLE & NAVIGATION */}
              <div className="px-4 lg:px-0 mb-6 shrink-0 pb-6 lg:pb-0">
                 <div className="flex flex-wrap items-center gap-3 mb-3">
                   <span className="bg-mission-accent text-black font-bold font-mono text-[10px] md:text-xs px-2 py-0.5 uppercase tracking-widest">
                     NGÀY {quest.id.toString().padStart(2, '0')}
                   </span>
                   
                   {/* VIDEO NAVIGATION CONTROLS */}
                   {videos.length > 1 && (
                     <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-sm overflow-hidden h-6 md:h-auto">
                        <button 
                          onClick={handlePrevVideo}
                          disabled={currentVideoIndex === 0}
                          className={`h-full px-2 hover:bg-neutral-800 transition-colors flex items-center justify-center ${currentVideoIndex === 0 ? 'text-neutral-700 cursor-not-allowed' : 'text-mission-accent hover:text-white'}`}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="font-mono text-[9px] md:text-[10px] text-neutral-400 px-2 py-0.5 border-l border-r border-neutral-800 tracking-wider h-full flex items-center">
                          VIDEO {currentVideoIndex + 1}/{videos.length}
                        </span>
                        <button 
                          onClick={handleNextVideo}
                          disabled={currentVideoIndex === videos.length - 1}
                          className={`h-full px-2 hover:bg-neutral-800 transition-colors flex items-center justify-center ${currentVideoIndex === videos.length - 1 ? 'text-neutral-700 cursor-not-allowed' : 'text-mission-accent hover:text-white'}`}
                        >
                          <ChevronRight size={14} />
                        </button>
                     </div>
                   )}

                   {quest.type === QuestType.CHECKPOINT && (
                     <span className="border border-mission-accent text-mission-accent font-bold font-mono text-[10px] md:text-xs px-2 py-0.5 uppercase tracking-widest">
                       CHECKPOINT
                     </span>
                   )}
                 </div>
                 <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-white uppercase leading-tight font-sans tracking-tight">
                   {quest.title}
                 </h2>
              </div>
              
            </div>
          </div>

          {/* =========================================================================
              RIGHT COLUMN: ACTION PANEL (Desktop: 4/12 cols)
             ========================================================================= */}
          <div className="lg:col-span-4 bg-neutral-900/30 backdrop-blur-sm flex flex-col lg:h-full relative lg:overflow-hidden min-h-[500px]">
            
            {/* 1. TABS */}
            <div className="flex border-b border-white/10 bg-black shrink-0 pr-14 sticky top-0 z-40 lg:static">
               {(['INSTRUCTION', 'TASKS', 'SUBMISSION'] as Tab[]).map((tab) => (
                 <button 
                   key={tab}
                   onClick={() => {
                     playSound('CLICK');
                     setActiveTab(tab);
                   }}
                   className={`flex-1 py-4 text-[10px] md:text-xs font-bold font-mono uppercase tracking-widest transition-all relative whitespace-nowrap
                     ${activeTab === tab 
                       ? 'bg-mission-accent text-black' 
                       : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'}
                   `}
                 >
                   {tab === 'INSTRUCTION' && 'HƯỚNG DẪN'}
                   {tab === 'TASKS' && 'NHIỆM VỤ'}
                   {tab === 'SUBMISSION' && 'NỘP BÀI'}
                   
                   {tab === 'TASKS' && !isQuestCompleted && isReadyToSubmit && (
                      <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-mission-accent rounded-full animate-ping" />
                   )}
                 </button>
               ))}
            </div>

            {/* --- NEW: MICRO-GAMIFICATION XP WIDGET (SIMPLIFIED) --- */}
            <div className="px-6 py-5 bg-black/40 border-b border-white/5 shrink-0 select-none flex flex-col justify-center">
               {/* Progress Bar Container */}
               <div className="w-full h-6 bg-neutral-900 border border-white/20 relative group overflow-hidden">
                 
                 {/* Fill */}
                 <div 
                   className="h-full bg-mission-accent relative transition-all duration-700 ease-out"
                   style={{ width: `${xpPercentage}%` }}
                 >
                    {/* Shimmer Effect */}
                    <div className="absolute inset-0 bg-white/20 -translate-x-full animate-[shimmer_2s_infinite]" />
                 </div>

                 {/* Text Overlay */}
                 <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <span className="text-[10px] font-bold font-mono text-white drop-shadow-[0_1px_2px_rgba(0,0,0,1)] tracking-widest">
                       {currentXP} / {maxXP} XP
                    </span>
                 </div>
               </div>
            </div>

            {/* 2. SCROLLABLE CONTENT BODY */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent">
               
               {/* --- TAB: INSTRUCTION --- */}
               {activeTab === 'INSTRUCTION' && (
                 <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                   {/* 1. DESCRIPTION */}
                   <div className="space-y-2">
                     <h3 className="text-mission-accent font-mono text-xs uppercase tracking-widest flex items-center gap-2 opacity-70">
                       <FileText size={14} /> Nội dung
                     </h3>
                     <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">
                       {quest.description}
                     </p>
                   </div>
                   {/* 2. PLAYLIST */}
                   {videos.length > 0 && (
                     <div className="space-y-3">
                       <h3 className="text-mission-accent font-mono text-xs uppercase tracking-widest flex items-center gap-2 opacity-70">
                         <PlayCircle size={14} /> Danh sách bài học
                       </h3>
                       <div className="space-y-2">
                         {videos.map((vid, idx) => {
                           const isWatched = watchedVideoIndices.includes(idx);
                           const isZoom = vid.type === 'ZOOM_RECORDING';
                           return (
                             <button 
                               key={idx}
                               onClick={() => setCurrentVideoIndex(idx)}
                               className={`w-full flex items-center gap-3 p-3 transition-all border text-left group rounded-sm
                                 ${currentVideoIndex === idx 
                                   ? 'bg-neutral-800 border-mission-accent text-white' 
                                   : 'bg-black/50 border-neutral-800 text-gray-400 hover:border-neutral-600 hover:bg-neutral-800'
                                 }
                               `}
                             >
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleVideoWatched) onToggleVideoWatched(quest.id, idx);
                                  }}
                                  className={`w-5 h-5 flex items-center justify-center shrink-0 border cursor-pointer hover:scale-110 transition-transform
                                    ${isWatched 
                                      ? 'bg-mission-accent border-mission-accent text-black' 
                                      : 'bg-transparent border-neutral-600 text-transparent hover:border-mission-accent'}
                                  `}
                                >
                                    {isWatched && <Check size={12} strokeWidth={4} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                   <div className="flex items-center gap-2 mb-0.5">
                                      {isZoom && vid.cohort && (
                                        <span className="px-1.5 py-0.5 bg-red-900/40 border border-red-500/50 text-red-400 text-[9px] font-bold font-mono rounded-xs uppercase">
                                          ZOOM {vid.cohort}
                                        </span>
                                      )}
                                      <p className={`text-xs font-bold truncate ${isWatched ? 'text-gray-500 line-through' : ''}`}>
                                        {vid.title}
                                      </p>
                                   </div>
                                   <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-500 uppercase">
                                      <span className="flex items-center gap-1">
                                         {isZoom ? <Video size={10} className="text-red-500" /> : <PlayCircle size={10} />}
                                         {isZoom ? 'ZOOM REPLAY' : (vid.type === 'LESSON' ? 'Bài học' : 'Thực hành')}
                                         {/* XP Label per video */}
                                         <span className="text-mission-accent ml-1">+{XP_VALUES.VIDEO} XP</span>
                                      </span>
                                      {vid.duration && <span>• {vid.duration}</span>}
                                   </div>
                                </div>
                                {currentVideoIndex === idx && <div className="w-2 h-2 bg-mission-accent rounded-full animate-pulse" />}
                             </button>
                           );
                         })}
                       </div>
                     </div>
                   )}
                   {/* 3. RESOURCES */}
                   {quest.resources && quest.resources.length > 0 && (
                     <div className="space-y-3 pt-4 border-t border-white/10">
                       <h3 className="text-mission-accent font-mono text-xs uppercase tracking-widest flex items-center gap-2 opacity-70">
                         <LinkIcon size={14} /> Tài nguyên
                       </h3>
                       <div className="grid grid-cols-1 gap-2">
                         {quest.resources.map((res, idx) => {
                           // TEXT RESOURCE (Accordion Style)
                           if (res.type === 'TEXT') {
                             const isOpen = openTextResource === idx;
                             return (
                                <div key={idx} className="bg-neutral-900 border border-neutral-800 transition-all rounded-sm overflow-hidden">
                                   <button 
                                     onClick={() => {
                                         playSound('CLICK');
                                         setOpenTextResource(isOpen ? null : idx);
                                     }}
                                     className="w-full flex items-center justify-between p-3 hover:bg-neutral-800 group"
                                   >
                                      <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-4 flex justify-center shrink-0">
                                           <AlignLeft size={14} className={`transition-colors ${isOpen ? 'text-white' : 'text-neutral-500 group-hover:text-mission-accent'}`} />
                                        </div>
                                        <span className={`text-sm font-medium truncate ${isOpen ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                                          {res.title}
                                        </span>
                                      </div>
                                      {isOpen ? <ChevronUp size={14} className="text-mission-accent shrink-0" /> : <ChevronDown size={14} className="text-neutral-500 shrink-0" />}
                                   </button>
                                   
                                   {/* Collapsible Content */}
                                   {isOpen && (
                                      <div className="p-4 border-t border-neutral-800 bg-black/40 animate-in fade-in slide-in-from-top-1 duration-200">
                                         <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                                            {res.url}
                                         </div>
                                      </div>
                                   )}
                                </div>
                             );
                           }

                           // DEFAULT LINK RESOURCE
                           return (
                             <a 
                               key={idx} 
                               href={normalizeUrl(res.url)}
                               target="_blank" 
                               rel="noreferrer"
                               className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-800 hover:border-mission-accent hover:bg-neutral-800 transition-all group rounded-sm"
                             >
                               <div className="w-4 flex justify-center shrink-0">
                                  <LinkIcon size={14} className="text-neutral-500 group-hover:text-mission-accent" />
                               </div>
                               <span className="text-sm font-medium text-gray-300 group-hover:text-white truncate">{res.title}</span>
                               <ExternalLink size={12} className="ml-auto text-neutral-600 group-hover:text-neutral-400 opacity-0 group-hover:opacity-100 transition-all" />
                             </a>
                           );
                         })}
                       </div>
                     </div>
                   )}
                 </div>
               )}

               {/* --- TAB: TASKS --- */}
               {activeTab === 'TASKS' && (
                 <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-8">
                    {hasPreparation && (
                      <div className={`border p-4 rounded-sm ${
                        isCheckpoint 
                          ? 'bg-red-950/20 border-red-900/50' 
                          : 'bg-blue-950/20 border-blue-900/50'
                      }`}>
                        <h3 className={`text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-2 ${
                          isCheckpoint ? 'text-red-500' : 'text-blue-400'
                        }`}>
                          {isCheckpoint ? <ShieldAlert size={12} /> : <Briefcase size={12} />}
                          {isCheckpoint ? 'YÊU CẦU BẮT BUỘC' : 'CHUẨN BỊ CẦN THIẾT'}
                        </h3>
                        <ul className="space-y-2">
                          {quest.preparationTasks!.map((pt, idx) => (
                            <li key={idx} className={`flex items-start gap-2 text-xs ${
                              isCheckpoint ? 'text-red-200/70' : 'text-blue-200/70'
                            }`}>
                              <span>•</span> {pt}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="space-y-3">
                      <h3 className="text-white font-mono text-xs uppercase tracking-widest flex justify-between">
                        <span>Nhiệm Vụ Bắt Buộc</span>
                        <span className="text-mission-accent">+{XP_VALUES.TASK} XP/Task</span>
                      </h3>
                      {mandatoryTasks.map(task => {
                        const isChecked = completedTaskIds.includes(task.id);
                        return (
                          <label 
                            key={task.id} 
                            className={`flex items-start gap-3 p-3 border transition-all cursor-pointer select-none
                              ${isChecked 
                                ? 'bg-mission-accent/5 border-mission-accent/50' 
                                : 'bg-black border-neutral-800 hover:border-neutral-600'}`}
                          >
                            <div className="mt-0.5 shrink-0 relative">
                               <input 
                                type="checkbox" 
                                className="peer sr-only"
                                checked={isChecked}
                                onChange={(e) => onCompleteTask(quest.id, task.id, e.target.checked)}
                                disabled={isQuestCompleted}
                              />
                              <div className={`w-5 h-5 border flex items-center justify-center transition-colors rounded-sm
                                ${isChecked ? 'bg-mission-accent border-mission-accent' : 'border-neutral-600'}
                              `}>
                                {isChecked && <Check size={14} className="text-black stroke-[4]" />}
                              </div>
                            </div>
                            <span className={`text-sm leading-snug transition-colors ${isChecked ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                              {task.text}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {optionalTasks.length > 0 && (
                      <div className="space-y-3 pt-4 border-t border-white/5">
                        <h3 className="text-neutral-500 font-mono text-xs uppercase tracking-widest flex justify-between">
                          <span>Làm Thêm (Optional)</span>
                          <span className="text-neutral-600">+{XP_VALUES.TASK} XP/Task</span>
                        </h3>
                        {optionalTasks.map(task => {
                          const isChecked = completedTaskIds.includes(task.id);
                          return (
                            <label 
                              key={task.id} 
                              className="flex items-start gap-3 p-2 group cursor-pointer"
                            >
                               <input 
                                type="checkbox" 
                                className="accent-neutral-500 w-4 h-4 mt-0.5 bg-black border-neutral-700"
                                checked={isChecked}
                                onChange={(e) => onCompleteTask(quest.id, task.id, e.target.checked)}
                                disabled={isQuestCompleted}
                              />
                              <span className={`text-xs ${isChecked ? 'text-neutral-600 line-through' : 'text-neutral-400 group-hover:text-neutral-300'}`}>
                                {task.text}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {isReadyToSubmit && !isQuestCompleted && (
                      <button 
                        onClick={() => {
                          playSound('CLICK');
                          setActiveTab('SUBMISSION');
                        }}
                        className="w-full py-3 mt-4 bg-mission-accent text-black font-bold font-mono text-xs uppercase tracking-widest hover:bg-[#a3e600] animate-pulse"
                      >
                        &gt;&gt; CHUYỂN SANG NỘP BÀI
                      </button>
                    )}
                 </div>
               )}

               {/* --- TAB: SUBMISSION (UPDATED LOGIC) --- */}
               {activeTab === 'SUBMISSION' && (
                 // UPDATED: Removed h-full to prevent forcing height on mobile. Added bottom padding.
                 <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 pb-8">
                   
                   {/* CASE 1: ALREADY COMPLETED (SHOW HISTORY) */}
                   {isQuestCompleted && !showResubmit ? (
                     <div className="flex flex-col gap-6">
                        {/* Hero Banner */}
                        <div className="flex flex-col items-center justify-center text-center p-6 border border-dashed border-mission-accent/30 bg-mission-accent/5 rounded-lg">
                           <Award size={48} className="text-mission-accent mb-4" />
                           <h3 className="text-lg font-bold text-white uppercase tracking-widest mb-2">ĐÃ HOÀN THÀNH</h3>
                           <p className="text-gray-500 text-xs">Bạn đã nhận +{XP_VALUES.QUEST_COMPLETION} XP Hoàn thành xuất sắc.</p>
                        </div>

                        {/* History List */}
                        <div className="space-y-2">
                           <h3 className="text-mission-accent font-mono text-xs uppercase tracking-widest flex items-center gap-2 border-b border-white/10 pb-2 mb-3">
                              <History size={14} /> Lịch sử cập nhật
                           </h3>
                           
                           {submissionsHistory.length > 0 ? (
                             submissionsHistory.map((sub, idx) => (
                               <div key={idx} className="p-3 bg-neutral-900/50 border border-neutral-800 rounded-sm">
                                  <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono mb-1">
                                     <Clock size={10} />
                                     {format(new Date(sub.timestamp), "dd/MM/yyyy HH:mm")}
                                  </div>
                                  <div className="text-sm text-gray-300 break-words whitespace-pre-wrap">
                                    {/* Detect if content is a URL */}
                                    {sub.content.startsWith('http') ? (
                                      <a href={sub.content} target="_blank" rel="noreferrer" className="text-mission-accent hover:underline flex items-center gap-1">
                                        <ExternalLink size={12} /> {sub.content}
                                      </a>
                                    ) : (
                                      sub.content
                                    )}
                                  </div>
                               </div>
                             ))
                           ) : (
                             <p className="text-xs text-neutral-600 italic">Chưa có dữ liệu lịch sử.</p>
                           )}
                        </div>

                        {/* Resubmit Button */}
                        <button 
                          onClick={() => {
                            playSound('CLICK');
                            setShowResubmit(true);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-3 bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors text-xs font-bold font-mono uppercase tracking-widest border border-neutral-700 hover:border-neutral-500"
                        >
                           <RefreshCw size={14} /> Cập nhật kết quả mới
                        </button>
                     </div>
                   ) : (
                   /* CASE 2: NOT COMPLETED OR RESUBMITTING */
                   /* UPDATED: Removed h-full, used flex-col with gap */
                     <div className="flex flex-col space-y-4">
                         
                         {/* Header if Resubmitting */}
                         {showResubmit && (
                           <button 
                             onClick={() => setShowResubmit(false)}
                             className="text-xs text-neutral-500 hover:text-white flex items-center gap-1 mb-2"
                           >
                             ← Quay lại lịch sử
                           </button>
                         )}

                         <div className="p-4 bg-neutral-800/50 border border-neutral-800 rounded-sm">
                           <div className="flex items-center gap-2 mb-2 text-mission-accent">
                             <Upload size={16} />
                             <h3 className="font-bold text-xs uppercase tracking-wider">
                                {showResubmit ? 'Cập nhật bài làm mới' : `YÊU CẦU NỘP BÀI`}
                             </h3>
                           </div>
                           <p className="text-gray-400 text-xs leading-relaxed">
                             {quest.submissionPlaceholder || "Dán link kết quả hoặc chia sẻ cảm nhận của bạn để hoàn tất ngày học."}
                           </p>
                         </div>
                         
                         {/* UPDATED: Removed flex-1, added min-h and w-full */}
                         <textarea 
                           value={submissionText}
                           onChange={(e) => setSubmissionText(e.target.value)}
                           placeholder="Nhập nội dung bài làm tại đây..."
                           className="w-full bg-black border border-neutral-700 text-white p-4 font-mono text-sm focus:outline-none focus:border-mission-accent focus:ring-1 focus:ring-mission-accent resize-none min-h-[200px]"
                         />

                         <div className="pt-2">
                           <button 
                             onClick={handleComplete}
                             disabled={(!isReadyToSubmit && !isQuestCompleted) || isSubmitting || !submissionText.trim()}
                             className={`w-full py-4 font-bold text-xs flex items-center justify-center gap-2 transition-all uppercase font-mono tracking-widest
                               ${(!isReadyToSubmit && !isQuestCompleted) || isSubmitting || !submissionText.trim()
                                 ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
                                 : 'bg-mission-accent text-black hover:bg-[#a3e600] shadow-lg shadow-mission-accent/20' 
                               }`}
                           >
                             {isSubmitting ? 'ĐANG GỬI...' : (showResubmit ? 'CẬP NHẬT' : `HOÀN THÀNH (+${XP_VALUES.QUEST_COMPLETION} XP) `)}
                             {!isSubmitting && <ArrowRight size={14} />}
                           </button>
                           {(!isReadyToSubmit && !isQuestCompleted) && (
                             <p className="text-center text-red-500 text-[10px] mt-2 font-mono">
                               * Hoàn thành checklist trước khi nộp
                             </p>
                           )}
                         </div>
                     </div>
                   )}
                 </div>
               )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
