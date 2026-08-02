// PoweredBy — attribution footer required by license.
// DO NOT REMOVE per license terms (MIT-with-attribution).

export function PoweredBy({ variant = 'fixed' }: { variant?: 'fixed' | 'inline' }) {
  if (variant === 'inline') {
    return (
      <p className="text-[10px] text-neutral-500 text-center py-2 opacity-60">
        Powered by{' '}
        <a
          href="https://rainmaker.vn"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-400 hover:text-primary underline underline-offset-2"
        >
          Rainmaker.vn
        </a>
      </p>
    )
  }

  return (
    <div className="fixed bottom-2 right-3 z-[9999] pointer-events-none">
      <p className="text-[10px] text-neutral-600 opacity-40 hover:opacity-100 transition-opacity pointer-events-auto">
        Powered by{' '}
        <a
          href="https://rainmaker.vn"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary underline underline-offset-2"
        >
          Rainmaker.vn
        </a>
      </p>
    </div>
  )
}
