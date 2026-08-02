// database/seed.ts
import { createClient } from '@supabase/supabase-js'
import { ZONES as localZones, QUESTS as localQuests } from '../data'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '' // needs service role for seeding
)

async function seed() {
  console.log('Seeding zones...')
  for (const zone of localZones) {
    const { error } = await supabase.from('zones').upsert({
      id: zone.id,
      title: zone.title,
      description: zone.description,
      color: zone.color,
      order_index: zone.id,
      start_day: zone.startDay,
      end_day: zone.endDay
    })
    if (error) console.error('Zone error:', error)
    else console.log(`Zone ${zone.id}: ${zone.title}`)
  }

  console.log('Seeding quests...')
  for (const quest of localQuests) {
    // Insert quest
    const { error: questError } = await supabase.from('quests').upsert({
      id: quest.id,
      zone_id: quest.zoneId,
      day_number: quest.id,
      title: quest.title,
      description: quest.description,
      type: quest.type,
      submission_placeholder: quest.submissionPlaceholder,
      order_index: quest.id
    })
    if (questError) { console.error('Quest error:', questError); continue }

    // Insert tasks
    for (let i = 0; i < (quest.tasks || []).length; i++) {
      const task = quest.tasks[i]
      await supabase.from('tasks').upsert({
        quest_id: quest.id,
        label: task.text,
        is_mandatory: task.type === 'MANDATORY',
        order_index: i
      })
    }

    // Insert videos
    for (let i = 0; i < (quest.videos || []).length; i++) {
      const video = quest.videos![i]
      await supabase.from('videos').upsert({
        quest_id: quest.id,
        title: video.title,
        url: video.url,
        cohort: video.cohort || null,
        order_index: i
      })
    }

    // Insert resources
    for (let i = 0; i < (quest.resources || []).length; i++) {
      const res = quest.resources![i]
      await supabase.from('resources').upsert({
        quest_id: quest.id,
        type: res.type.toLowerCase(),
        label: res.title,
        url: res.url || null,
        order_index: i
      })
    }

    console.log(`Quest ${quest.id}: ${quest.title} (${(quest.tasks||[]).length} tasks, ${(quest.videos||[]).length} videos)`)
  }

  console.log('Seeding default app_settings...')
  await supabase.from('app_settings').upsert([
    { key: 'title', value: { value: 'MiniCRM' } },
    { key: 'description', value: { value: '' } },
    { key: 'primaryColor', value: { value: '#B6FF00' } },
  ])

  console.log('Done!')
}

seed().catch(console.error)
