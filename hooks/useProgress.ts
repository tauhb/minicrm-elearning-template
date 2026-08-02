import { useState, useEffect } from 'react'
import { UserProgress, STORAGE_KEY, Submission } from '../types'
import { differenceInCalendarDays } from 'date-fns'
import { supabase } from '../services/supabase'
import { upsertQuestProgress, upsertTaskCompletion, deleteTaskCompletion, insertSubmission, updateStreak, loadUserProgress } from '../services/api'

const INITIAL_PROGRESS: UserProgress = {
  currentDay: 1,
  completedQuests: [],
  completedTasks: {},
  watchedVideos: {},
  submissions: {},
  streak: 0,
  lastCompletedDate: null
}

export const useProgress = () => {
  const [progress, setProgress] = useState<UserProgress>(INITIAL_PROGRESS)
  const [isLoaded, setIsLoaded] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      // 1. Load from localStorage first (instant)
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          setProgress({ ...INITIAL_PROGRESS, ...parsed, submissions: parsed.submissions || {} })
        } catch (e) {
          console.error('Failed to parse progress', e)
        }
      }

      // 2. Then sync from Supabase if authenticated
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserId(user.id)
        const remote = await loadUserProgress(user.id)
        const merged = { ...INITIAL_PROGRESS, ...remote }
        setProgress(merged)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      }
      setIsLoaded(true)
    }
    init()
  }, [])

  const saveProgress = (newProgress: UserProgress) => {
    setProgress(newProgress)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newProgress))
  }

  const completeTask = async (questId: number, taskId: string, isCompleted: boolean) => {
    const currentTasks = progress.completedTasks[questId] || []
    const newTasks = isCompleted
      ? [...currentTasks, taskId]
      : currentTasks.filter(id => id !== taskId)

    saveProgress({ ...progress, completedTasks: { ...progress.completedTasks, [questId]: newTasks } })
    if (userId) {
      if (isCompleted) {
        await upsertTaskCompletion(userId, taskId)
      } else {
        await deleteTaskCompletion(userId, taskId)
      }
    }
  }

  const toggleVideoWatched = (questId: number, videoIndex: number) => {
    const currentWatched = progress.watchedVideos[questId] || []
    const newWatched = currentWatched.includes(videoIndex)
      ? currentWatched.filter(i => i !== videoIndex)
      : [...currentWatched, videoIndex]
    saveProgress({ ...progress, watchedVideos: { ...progress.watchedVideos, [questId]: newWatched } })
  }

  const addSubmission = async (questId: number, content: string) => {
    const newSubmission: Submission = { timestamp: new Date().toISOString(), content }
    const currentSubmissions = progress.submissions[questId] || []
    saveProgress({ ...progress, submissions: { ...progress.submissions, [questId]: [newSubmission, ...currentSubmissions] } })
    if (userId) await insertSubmission(userId, questId, content)
  }

  const completeQuest = async (questId: number) => {
    if (progress.completedQuests.includes(questId)) return

    const newCompleted = [...progress.completedQuests, questId]
    const nextDay = questId === progress.currentDay ? questId + 1 : progress.currentDay

    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    let newStreak = progress.streak || 0
    const lastDateStr = progress.lastCompletedDate

    if (lastDateStr === todayStr) {
      // same day, no change
    } else if (lastDateStr) {
      const diff = differenceInCalendarDays(today, new Date(lastDateStr))
      newStreak = diff === 1 ? newStreak + 1 : 1
    } else {
      newStreak = 1
    }

    const newProgress = {
      ...progress,
      completedQuests: newCompleted,
      currentDay: Math.min(nextDay, 35),
      streak: newStreak,
      lastCompletedDate: todayStr
    }
    saveProgress(newProgress)

    if (userId) {
      const xp = newCompleted.length * 500
      await upsertQuestProgress(userId, questId, xp)
      await updateStreak(userId, newStreak, todayStr)
    }
  }

  return { progress, isLoaded, completeTask, completeQuest, toggleVideoWatched, addSubmission }
}
