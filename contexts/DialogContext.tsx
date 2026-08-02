import React, { createContext, useContext, useState, useCallback } from 'react'
import { AlertTriangle, Info, CheckCircle2, X } from 'lucide-react'

type DialogVariant = 'info' | 'success' | 'warning' | 'danger'

interface DialogOptions {
  title?: string
  message: string
  variant?: DialogVariant
  confirmText?: string
  cancelText?: string
}

interface DialogState extends DialogOptions {
  id: number
  isConfirm: boolean
  resolve: (value: boolean) => void
}

interface DialogContextValue {
  alert: (opts: DialogOptions | string) => Promise<void>
  confirm: (opts: DialogOptions | string) => Promise<boolean>
}

const DialogContext = createContext<DialogContextValue | null>(null)

export const useDialog = (): DialogContextValue => {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider')
  return ctx
}

const normalize = (opts: DialogOptions | string): DialogOptions => {
  return typeof opts === 'string' ? { message: opts } : opts
}

const VARIANT_STYLES: Record<DialogVariant, { color: string; icon: React.ReactNode }> = {
  info:    { color: '#60a5fa', icon: <Info size={20} /> },
  success: { color: '#34d399', icon: <CheckCircle2 size={20} /> },
  warning: { color: '#fbbf24', icon: <AlertTriangle size={20} /> },
  danger:  { color: '#f87171', icon: <AlertTriangle size={20} /> },
}

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const alert = useCallback((opts: DialogOptions | string): Promise<void> => {
    return new Promise(resolve => {
      const o = normalize(opts)
      setDialog({
        ...o, id: Date.now(), isConfirm: false,
        resolve: () => resolve(),
      })
    })
  }, [])

  const confirm = useCallback((opts: DialogOptions | string): Promise<boolean> => {
    return new Promise(resolve => {
      const o = normalize(opts)
      setDialog({
        ...o, id: Date.now(), isConfirm: true,
        resolve: (v: boolean) => resolve(v),
      })
    })
  }, [])

  const close = (ok: boolean) => {
    if (!dialog) return
    dialog.resolve(ok)
    setDialog(null)
  }

  const variant = dialog?.variant || (dialog?.isConfirm ? 'warning' : 'info')
  const variantStyle = VARIANT_STYLES[variant]
  const accent = dialog?.variant === 'danger'
    ? '#f87171'
    : 'var(--color-mission-accent, #B6FF00)'

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-md rounded-sm border border-white/10 bg-neutral-950 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Close X */}
            <button
              onClick={() => close(false)}
              className="absolute top-3 right-3 p-1.5 text-neutral-500 hover:text-white transition-colors"
              style={{ position: 'relative', float: 'right', marginTop: '8px', marginRight: '8px' }}
            >
              <X size={16} />
            </button>

            <div className="p-7 pt-6">
              {/* Icon */}
              <div
                className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: variantStyle.color + '40',
                  backgroundColor: variantStyle.color + '15',
                  color: variantStyle.color,
                }}
              >
                {variantStyle.icon}
              </div>

              {/* Title */}
              {dialog.title && (
                <h3 className="mb-2 text-base font-bold text-white">{dialog.title}</h3>
              )}

              {/* Message */}
              <p className="mb-6 text-sm text-neutral-400 leading-relaxed whitespace-pre-line">
                {dialog.message}
              </p>

              {/* Buttons */}
              <div className="flex gap-2 justify-end">
                {dialog.isConfirm && (
                  <button
                    onClick={() => close(false)}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-700 rounded-sm transition-colors"
                  >
                    {dialog.cancelText || 'Huỷ'}
                  </button>
                )}
                <button
                  onClick={() => close(true)}
                  autoFocus
                  className="px-5 py-2 text-sm font-semibold rounded-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: accent, color: dialog.variant === 'danger' ? '#fff' : '#000' }}
                >
                  {dialog.confirmText || (dialog.isConfirm ? 'Xác nhận' : 'OK')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}
