import { useState, useEffect, useRef } from 'react'
import { Type, Check } from 'lucide-react'
import { FONT_OPTIONS } from '../hooks/useFont'

export default function FontPicker({ font, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Change font"
        className="
          p-1.5 rounded-md transition-colors
          text-paper-500 dark:text-paper-600
          hover:text-pitch-500 dark:hover:text-paper-300
          hover:bg-paper-200 dark:hover:bg-pitch-700
        "
      >
        <Type size={15} />
      </button>

      {open && (
        <div className="
          absolute right-0 top-full mt-1 z-30 w-56
          rounded-lg shadow-xl
          bg-white dark:bg-pitch-700
          border border-paper-300 dark:border-pitch-500
          p-1
          animate-fade-in
        ">
          <div className="px-2 py-1.5 text-xs font-sans font-medium uppercase tracking-widest text-paper-500 dark:text-paper-700">
            Body font
          </div>
          {FONT_OPTIONS.map((opt) => {
            const active = font === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => { onChange(opt.key); setOpen(false) }}
                style={{ fontFamily: opt.stack }}
                className={`
                  w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors
                  ${active
                    ? 'bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200'
                    : 'text-pitch-500 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700'
                  }
                `}
              >
                <Check
                  size={12}
                  className={`flex-shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`}
                />
                <span className="flex-1">{opt.label}</span>
                <span className="text-xs font-mono text-paper-500 dark:text-paper-700">
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
