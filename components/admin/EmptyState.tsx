import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'

interface CTA {
  label: string
  onClick: () => void
  icon?: LucideIcon
}

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  cta?: CTA
  className?: string
}

/**
 * Shared empty-state card. Centered, muted icon + title, optional description + CTA.
 */
const EmptyState: React.FC<Props> = ({ icon: Icon = Inbox, title, description, cta, className }) => {
  const Btn = cta?.icon
  return (
    <div
      className={`rounded-xl border p-10 text-center ${className || ''}`}
      style={{ borderColor: 'var(--theme-border, #262626)', background: 'var(--theme-surface, #0a0a0a)' }}
    >
      <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center border"
        style={{ borderColor: 'var(--theme-border, #262626)', background: 'var(--theme-surface-2, #171717)' }}
      >
        <Icon size={22} className="text-neutral-500" />
      </div>
      <p className="text-sm font-medium text-neutral-200">{title}</p>
      {description && (
        <p className="text-xs text-neutral-500 mt-1.5 max-w-sm mx-auto leading-relaxed">{description}</p>
      )}
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent, #B6FF00)', color: '#000' }}
        >
          {Btn && <Btn size={13} />}
          {cta.label}
        </button>
      )}
    </div>
  )
}

export default EmptyState
