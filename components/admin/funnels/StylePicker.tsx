import React from 'react'

export interface StylePreset {
  vibe?: 'cyberpunk' | 'minimal' | 'warm' | 'corporate' | 'startup' | 'editorial'
  fontPair?: string
  layout?: 'airy' | 'balanced' | 'dense'
  density?: 'compact' | 'balanced' | 'spacious'
  brandColor?: string
}

const VIBES = [
  { key: 'cyberpunk', label: 'Cyberpunk', desc: 'Neon dark, gaming/tech' },
  { key: 'minimal',   label: 'Minimal',   desc: 'Clean white, whitespace' },
  { key: 'warm',      label: 'Warm',      desc: 'Cream/beige, lifestyle' },
  { key: 'corporate', label: 'Corporate', desc: 'Navy blue, professional' },
  { key: 'startup',   label: 'Startup',   desc: 'Purple gradient, playful' },
  { key: 'editorial', label: 'Editorial', desc: 'Large serif, magazine' },
] as const

const FONT_PAIRS = [
  'Inter+Playfair Display',
  'Manrope+Fraunces',
  'IBM Plex Sans+IBM Plex Serif',
  'Space Grotesk+Instrument Serif',
  'System',
]

export function StylePicker({ value, onChange }: { value: StylePreset; onChange: (v: StylePreset) => void }) {
  const set = <K extends keyof StylePreset>(k: K, v: StylePreset[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-2">Vibe</label>
        <div className="grid grid-cols-3 gap-2">
          {VIBES.map(v => (
            <button
              key={v.key}
              onClick={() => set('vibe', v.key)}
              className={`text-left px-3 py-2 rounded-lg border transition ${
                value.vibe === v.key ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:border-neutral-700'
              }`}
              style={value.vibe === v.key ? { borderColor: 'var(--color-mission-accent)' } : undefined}
            >
              <div className="text-sm font-medium">{v.label}</div>
              <div className="text-[10px] text-neutral-500">{v.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Font pair</label>
          <select value={value.fontPair || 'Inter+Playfair Display'} onChange={e => set('fontPair', e.target.value)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm">
            {FONT_PAIRS.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Brand color</label>
          <div className="flex gap-2">
            <input type="color" value={value.brandColor || '#B6FF00'} onChange={e => set('brandColor', e.target.value)}
              className="w-10 h-10 rounded-lg bg-neutral-900 border border-neutral-800" />
            <input type="text" value={value.brandColor || '#B6FF00'} onChange={e => set('brandColor', e.target.value)}
              className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm font-mono" />
          </div>
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Layout</label>
          <select value={value.layout || 'balanced'} onChange={e => set('layout', e.target.value as any)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm">
            <option value="airy">Airy — nhiều khoảng trắng</option>
            <option value="balanced">Balanced — cân bằng</option>
            <option value="dense">Dense — chặt, ít khoảng trắng</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Density</label>
          <select value={value.density || 'balanced'} onChange={e => set('density', e.target.value as any)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm">
            <option value="compact">Compact — ít bullets</option>
            <option value="balanced">Balanced</option>
            <option value="spacious">Spacious — dài hơi</option>
          </select>
        </div>
      </div>
    </div>
  )
}
