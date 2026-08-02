import { differenceInCalendarDays, getISOWeek, getYear } from 'date-fns';
import { Zone, Quest, QuestType, TaskType, Task, Resource, VideoResource, Student, UserProgress, LeaderboardEntry, GameSettings } from '../types';

// --- HELPERS ---

export const getWeekID = (date: Date = new Date()): string => {
  const year = getYear(date);
  const week = getISOWeek(date);
  return `${year}-W${week.toString().padStart(2, '0')}`;
};

export const calculateXP = (progress: UserProgress): number => {
  let xp = 0;
  // 500 XP per Quest
  xp += progress.completedQuests.length * 500;
  
  // 50 XP per Task
  Object.values(progress.completedTasks).forEach(tasks => {
    xp += tasks.length * 50;
  });

  // 20 XP per Video
  Object.values(progress.watchedVideos).forEach(videos => {
    xp += videos.length * 20;
  });

  return xp;
};

// Helper to convert Google Drive links to DIRECT STREAM LINKS (MP4 style) for <video> tag
export const processGoogleDriveUrl = (url: string): string => {
  if (!url) return '';
  const trimmedUrl = url.trim();
  
  // If user pasted a full HTML iframe code instead of URL, try to extract src
  if (trimmedUrl.startsWith('<iframe') && trimmedUrl.includes('src="')) {
      const srcMatch = trimmedUrl.match(/src="([^"]+)"/);
      if (srcMatch && srcMatch[1]) return processGoogleDriveUrl(srcMatch[1]);
  }

  if (trimmedUrl.includes('drive.google.com')) {
    // 1. Try to extract ID from standard URL path: /file/d/ID/...
    const pathMatch = trimmedUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (pathMatch && pathMatch[1]) {
      // Direct Link Hack for HTML5 Video: uc?export=download&id=ID
      return `https://drive.google.com/uc?export=download&id=${pathMatch[1]}`;
    }

    // 2. Try to extract ID from query parameter: ?id=ID
    const queryMatch = trimmedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (queryMatch && queryMatch[1]) {
       // Direct Link Hack for HTML5 Video
      return `https://drive.google.com/uc?export=download&id=${queryMatch[1]}`;
    }
  }
  
  return trimmedUrl;
};

export const calculateMaxAllowedDay = (startDateStr: string): number => {
  try {
    let start: Date;
    const parts = startDateStr.split('-');
    if (parts.length === 3) {
      start = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      start = new Date(startDateStr);
    }

    const today = new Date();
    const daysPassed = differenceInCalendarDays(today, start);
    return Math.max(1, daysPassed + 1);
  } catch (e) {
    console.error("Date calc error", e);
    return 1;
  }
};

// --- API CALLS (DYNAMIC ENDPOINT) ---

const callScript = async (endpoint: string, action: string, payload: any = {}) => {
  try {
    // For GET requests (read-only), we can use query params if we want to cache, 
    // but for simplicity and security with Apps Script, POST is often more reliable for passing JSON bodies.
    // However, Apps Script 'doGet' is for reading. 
    // Let's stick to POST for everything to avoid URL length limits and ensure JSON body handling is consistent,
    // UNLESS the script specifically requires GET.
    // The standard pattern I'll use for the script is a single entry point that handles both, 
    // but POST is safer for large payloads.
    
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain avoids CORS preflight issues with Google Script
      body: JSON.stringify({ action, ...payload })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    if (data.status === 'error') {
      throw new Error(data.message || 'Unknown Script Error');
    }

    return data;
  } catch (error) {
    console.error(`API Call Failed [${action}]:`, error);
    throw error;
  }
};

export const checkConnection = async (endpoint: string): Promise<boolean> => {
  try {
    const data = await callScript(endpoint, 'PING');
    return data.message === 'PONG';
  } catch (e) {
    return false;
  }
};

export const loginStudent = async (endpoint: string, code: string, pass: string): Promise<Student | null> => {
  try {
    const data = await callScript(endpoint, 'LOGIN', { student_code: code, password: pass });
    if (data.student) {
      return data.student;
    }
    return null;
  } catch (err) {
    console.error("Login Error:", err);
    throw new Error("Không thể kết nối đến máy chủ dữ liệu.");
  }
};

export const fetchGameData = async (endpoint: string, student?: Student) => {
  try {
    const data = await callScript(endpoint, 'GET_GAME_DATA', { 
      student_khoa: student?.khoa 
    });

    // Data structure from script: { zones: [], quests: [], settings: {} }
    // We need to process it to match our internal types if necessary.
    // Assuming the script returns clean JSON matching our types mostly.

    const zones: Zone[] = data.zones.map((z: any) => ({
      id: parseInt(z.id),
      title: z.title,
      description: z.description,
      startDay: parseInt(z.start_day),
      endDay: parseInt(z.end_day),
      color: z.color || 'text-white'
    }));

    const quests: Quest[] = data.quests.map((q: any) => {
      // Parse JSON fields if they come as strings, or use directly if object
      const tasks = typeof q.tasks_json === 'string' ? JSON.parse(q.tasks_json) : (q.tasks_json || []);
      const resources = typeof q.resources_json === 'string' ? JSON.parse(q.resources_json) : (q.resources_json || []);
      const videos = typeof q.video_url === 'string' && q.video_url.startsWith('[') 
        ? JSON.parse(q.video_url) 
        : (q.video_url ? [{ title: 'Bài học', url: q.video_url, type: 'LESSON' }] : []);

      return {
        id: parseInt(q.id),
        zoneId: parseInt(q.zone_id),
        title: q.title,
        description: q.description,
        type: q.type as QuestType,
        submissionPlaceholder: q.submission_placeholder,
        tasks: tasks,
        videos: videos,
        resources: resources,
        preparationTasks: q.preparation ? q.preparation.split('|') : undefined
      };
    }).sort((a: Quest, b: Quest) => a.id - b.id);

    return { zones, quests, settings: data.settings || {} };

  } catch (error) {
    console.error("Error fetching game data:", error);
    throw error;
  }
};

export const submitHomework = async (endpoint: string, studentCode: string, questId: number, content: string): Promise<boolean> => {
  try {
    await callScript(endpoint, 'SUBMISSION', {
      student_code: studentCode,
      quest_id: questId,
      content: content
    });
    return true;
  } catch (error) {
    console.error("Submission error:", error);
    throw new Error("Không thể gửi bài nộp đến máy chủ.");
  }
};

export const syncUserProgress = async (endpoint: string, student: Student, progress: UserProgress): Promise<void> => {
  const totalXP = calculateXP(progress);
  const currentWeekID = getWeekID();

  try {
    await callScript(endpoint, 'SYNC_PROGRESS', {
      student_code: student.student_code,
      display_name: student.display_name,
      khoa: student.khoa,
      total_xp: totalXP,
      streak: progress.streak,
      week_id: currentWeekID
    });
  } catch (error) {
    console.warn("Sync failed:", error);
  }
};

export const fetchLeaderboard = async (endpoint: string): Promise<LeaderboardEntry[]> => {
  try {
    const data = await callScript(endpoint, 'GET_LEADERBOARD');
    if (!Array.isArray(data.leaderboard)) return [];

    return data.leaderboard.map((row: any) => ({
      rank: 0,
      student_code: row.student_code,
      display_name: row.display_name,
      khoa: row.khoa,
      total_xp: Number(row.total_xp) || 0,
      weekly_xp: Number(row.weekly_xp) || 0,
      week_id: row.week_id,
      streak: Number(row.streak) || 0,
      is_current_user: false
    }));
  } catch (error) {
    console.error("Fetch Leaderboard Error:", error);
    return [];
  }
};

// --- ADMIN API ---

export const saveCourseData = async (endpoint: string, zones: Zone[], quests: Quest[], settings?: GameSettings) => {
  return callScript(endpoint, 'SAVE_COURSE_DATA', {
    zones,
    quests,
    settings
  });
};
