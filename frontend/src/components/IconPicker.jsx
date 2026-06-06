import { useState, useEffect, useMemo, useRef } from 'react'
import * as LucideIcons from 'lucide-react'
import { Search, X } from 'lucide-react'

/**
 * Renders the named Lucide icon. Falls back to nothing if the name doesn't
 * resolve (e.g. an icon was renamed in a Lucide upgrade).
 *
 * Usage:
 *   <AreaIcon name="Database" size={16} />
 */
export function AreaIcon({ name, size = 16, className = '' }) {
  if (!name) return null
  const Icon = LucideIcons[name]
  if (!Icon) return null
  return <Icon size={size} className={className} />
}

// Build a stable list of all icon names ONCE at module load. Lucide ships
// every icon as a named export plus a few helpers. Icons are forwardRef
// components (objects with $$typeof) in current versions - we identify
// them by their PascalCase name and an explicit exclusion list rather
// than typeof, which would discard them all.
const NON_ICON_EXPORTS = new Set([
  'Icon',
  'LucideIcon',
  'createLucideIcon',
  'icons',  // the dynamic icon map
])

const ALL_ICON_NAMES = Object.keys(LucideIcons)
  .filter((k) => /^[A-Z][A-Za-z0-9]+$/.test(k))
  .filter((k) => !NON_ICON_EXPORTS.has(k))
  .filter((k) => LucideIcons[k] != null)
  .sort()

const RESULT_LIMIT = 120

/**
 * Searchable Lucide icon picker. Renders a popover anchored to the trigger.
 * Type to filter; click to pick. Esc / click-outside to close.
 *
 * Props:
 *   value     - current icon name (string | null)
 *   onChange  - (name | null) => void
 *   children  - render-prop receiving { open, value }; defaults to a small
 *               clickable button. Lets callers customise the trigger.
 */
export default function IconPicker({ value, onChange, children }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const popoverRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 50)
    const onDocClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL_ICON_NAMES.slice(0, RESULT_LIMIT)
    return ALL_ICON_NAMES.filter((n) => n.toLowerCase().includes(q)).slice(0, RESULT_LIMIT)
  }, [query])

  const trigger = typeof children === 'function'
    ? children({ open: () => setOpen(true), value })
    : (
      <button
        onClick={() => setOpen(true)}
        className="
          flex items-center justify-center w-9 h-9 rounded-md
          bg-paper-100 dark:bg-pitch-800
          border border-paper-300 dark:border-pitch-500
          text-paper-600 dark:text-paper-500
          hover:border-paper-400 dark:hover:border-pitch-400
          hover:text-pitch-700 dark:hover:text-paper-200
          transition-colors
        "
      >
        {value ? <AreaIcon name={value} size={16} /> : <Search size={14} />}
      </button>
    )

  return (
    <div className="relative inline-block">
      {trigger}

      {open && (
        <div
          ref={popoverRef}
          className="
            absolute left-0 top-full mt-1 z-30
            w-72 rounded-lg shadow-xl
            bg-white dark:bg-pitch-700
            border border-paper-300 dark:border-pitch-500
            p-2
            animate-fade-in
          "
        >
          {/* Search */}
          <div className="relative mb-2">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-400 dark:text-paper-700"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search icons…"
              className="
                w-full pl-7 pr-2 py-1.5 text-xs rounded-md
                bg-paper-100 dark:bg-pitch-800
                border border-paper-300 dark:border-pitch-500
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />
          </div>

          {/* Clear */}
          {value && (
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className="
                w-full flex items-center gap-2 px-2 py-1.5 mb-1.5 rounded-md
                text-xs text-paper-600 dark:text-paper-500
                hover:bg-paper-200 dark:hover:bg-pitch-800 transition-colors
              "
            >
              <X size={12} />
              <span className="font-display uppercase tracking-wide">Remove icon</span>
            </button>
          )}

          {/* Grid */}
          <div className="max-h-56 overflow-y-auto -mr-1 pr-1">
            {matches.length === 0 ? (
              <p className="text-xs italic text-paper-400 dark:text-paper-700 px-2 py-3 text-center">
                No icons match "{query}".
              </p>
            ) : (
              <div className="grid grid-cols-6 gap-0.5">
                {matches.map((name) => {
                  const active = value === name
                  return (
                    <button
                      key={name}
                      onClick={() => { onChange(name); setOpen(false) }}
                      title={name}
                      className={`
                        flex items-center justify-center w-9 h-9 rounded-md transition-colors
                        ${active
                          ? 'bg-paper-300 dark:bg-pitch-600 text-paper-700 dark:text-paper-200'
                          : 'text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-800 hover:text-pitch-700 dark:hover:text-paper-200'
                        }
                      `}
                    >
                      <AreaIcon name={name} size={15} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {query && matches.length >= RESULT_LIMIT && (
            <p className="mt-1.5 text-2xs font-mono text-paper-400 dark:text-paper-700 text-center">
              Showing first {RESULT_LIMIT} matches. Refine your search.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
