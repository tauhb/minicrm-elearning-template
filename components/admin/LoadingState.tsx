import React from 'react'
import { Loader2 } from 'lucide-react'

interface Props {
  label?: string
  /** inline = compact, single-line (icon + label side by side). Default is block-centered. */
  inline?: boolean
  className?: string
}

/**
 * Shared loading indicator (spinner + label). Consistent size + color across admin views.
 */
const LoadingState: React.FC<Props> = ({ label = 'Đang tải...', inline, className }) => {
  if (inline) {
    return (
      <span className={`inline-flex items-center gap-2 text-xs text-neutral-500 ${className || ''}`}>
        <Loader2 size={14} className="animate-spin" />
        {label}
      </span>
    )
  }
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-8 text-neutral-500 ${className || ''}`}>
      <Loader2 size={20} className="animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  )
}

export default LoadingState
