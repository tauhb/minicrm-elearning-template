import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { fetchCourse } from '../../services/api'
import { Course, Quest, Zone, QuestType } from '../../types'
import { CourseBuilder } from '../CourseBuilder'

const CourseEditor: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'settings' ? 'SETTINGS' : undefined
  const [course, setCourse] = useState<Course | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!courseId) return
    const load = async () => {
      setLoading(true)
      const c = await fetchCourse(courseId)
      setCourse(c)

      // Lấy zones thuộc course này + quests
      const { data: zonesData } = await supabase.from('zones').select('*').eq('course_id', courseId).order('order_index')
      const zoneIds = (zonesData || []).map((z: any) => z.id)
      const questsRes = zoneIds.length > 0
        ? await supabase.from('quests').select('*, tasks(*), videos(*), resources(*)').in('zone_id', zoneIds).order('order_index')
        : { data: [] as any[] }
      const questsData = questsRes.data

      setZones((zonesData || []).map((z: any) => ({
        id: z.id, title: z.title, description: z.description || '',
        startDay: z.start_day, endDay: z.end_day, color: z.color || '#B6FF00'
      })))
      setQuests((questsData || []).map((q: any) => ({
        id: q.day_number, zoneId: q.zone_id, title: q.title, description: q.description || '',
        type: q.type as QuestType, submissionPlaceholder: q.submission_placeholder,
        tasks: (q.tasks || []).sort((a: any, b: any) => a.order_index - b.order_index).map((t: any) => ({
          id: t.id.toString(), text: t.label, type: t.is_mandatory ? 'MANDATORY' : 'OPTIONAL'
        })),
        videos: (q.videos || []).sort((a: any, b: any) => a.order_index - b.order_index)
          .map((v: any) => ({ title: v.title, url: v.url, type: 'LESSON' as const })),
        resources: (q.resources || []).sort((a: any, b: any) => a.order_index - b.order_index)
          .map((r: any) => ({ title: r.label, url: r.url || '', type: r.type.toUpperCase() }))
      })))
      setLoading(false)
    }
    load()
  }, [courseId])

  if (loading) return <div className="flex items-center justify-center h-96"><Loader2 className="animate-spin text-gray-500" /></div>
  if (!course) return <div className="p-8 text-center text-gray-500">Không tìm thấy khóa học</div>

  return (
    <div>
      <div className="px-8 pt-4 pb-2 flex items-center justify-between border-b border-gray-800">
        <button onClick={() => navigate('/admin/products/courses')} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={14} />Tất cả khóa học
        </button>
        <div className="text-sm text-gray-400">
          Đang chỉnh sửa: <span className="text-white font-medium">{course.title}</span>
        </div>
      </div>
      <CourseBuilder initialZones={zones} initialQuests={quests} onClose={() => navigate('/admin/products/courses')} course={course} initialTab={initialTab} />
    </div>
  )
}
export default CourseEditor
