// Sound Effects — local files trong public/sounds/ (sinh bằng ElevenLabs)
// Lazy load, không block initial render.

const SOUNDS = {
  HOVER:      '/sounds/hover.mp3',
  CLICK:      '/sounds/click.mp3',
  TASK_CHECK: '/sounds/task-check.mp3',
  SUCCESS:    '/sounds/success.mp3',
  OPEN:       '/sounds/open.mp3',
  NOTIFY:     '/sounds/notify.mp3',
  ERROR:      '/sounds/error.mp3',
  SCAN:       '/sounds/scan.mp3',
} as const

type SoundType = keyof typeof SOUNDS

const audioCache: Partial<Record<SoundType, HTMLAudioElement>> = {}
let audioDisabled = false

const VOLUMES: Record<SoundType, number> = {
  HOVER: 0.1, CLICK: 0.4, TASK_CHECK: 0.4, SUCCESS: 0.5,
  OPEN: 0.4,  NOTIFY: 0.5, ERROR: 0.4, SCAN: 0.3,
}

export const playSound = (type: SoundType) => {
  if (audioDisabled || typeof window === 'undefined') return
  try {
    let audio = audioCache[type]
    if (!audio) {
      audio = new Audio(SOUNDS[type])
      audio.preload = 'none'
      audio.volume = VOLUMES[type]
      audio.onerror = () => { /* missing file → silent, không tắt cả service */ }
      audioCache[type] = audio
    }
    audio.currentTime = 0
    audio.play().catch(() => {/* autoplay blocked or load error — silent */})
  } catch {/* silent */}
}
