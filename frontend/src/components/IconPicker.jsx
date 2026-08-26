import { useEffect, useMemo, useRef, useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { Plus, X } from 'lucide-react'

import {
  AREA_QUICK_PICK_ICONS, iconByName, kebabToPascal, pascalToKebab, searchIconNames,
} from '../utils/entityIcons'

/**
 * Renders the named Lucide icon. Falls back to nothing if the name doesn't
 * resolve (e.g. an icon was renamed in a Lucide upgrade).
 *
 * Areas store Lucide's own PascalCase export name, so that is what this takes.
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

/**
 * The area icon picker.
 *
 * The same shape as the create-type panel entries use, because that is the one
 * that works: ten to pick from straight away, or a search over the whole Lucide
 * set for anyone with something specific in mind. What it replaced was an
 * alphabetical dump of the first hundred and twenty names, which opened on
 * AArrowDown and asked the user to do the browsing.
 *
 * It stays a popover rather than an inline panel because both callers, the new
 * area modal and the area header, want a small trigger and no reflow.
 *
 * Props:
 *   value     - current icon name, PascalCase (string | null)
 *   onChange  - (name | null) => void, called with PascalCase
 *   children  - render-prop receiving { open, value }; defaults to a small
 *               clickable button. Lets callers customise the trigger.
 */
export default function IconPicker({ value, onChange, children }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const popoverRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setDebounced('')
    setTimeout(() => inputRef.current?.focus(), 50)
    const onDocClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // 150ms, so typing does not filter four thousand names on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  // An area may search the whole set. The five reserved names are reserved
  // against entry types, which share a timeline rail; an area does not.
  const results = useMemo(
    () => searchIconNames(debounced, 40, { includeBuiltIns: true }),
    [debounced],
  )

  const selected = value ? pascalToKebab(value) : null
  const searching = Boolean(debounced.trim())

  // The current icon leads the quick picks when it is not already one of them,
  // so opening the picker always shows you where you are.
  const quickPicks = useMemo(() => {
    if (!selected || AREA_QUICK_PICK_ICONS.includes(selected)) return AREA_QUICK_PICK_ICONS
    return [selected, ...AREA_QUICK_PICK_ICONS]
  }, [selected])

  const showing = searching ? results : quickPicks

  const pick = (kebab) => {
    onChange(kebab === selected ? null : kebabToPascal(kebab))
    setOpen(false)
  }

  const trigger = typeof children === 'function'
    ? children({ open: () => setOpen(true), value })
    : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={value ? `Icon: ${value}` : 'Set icon'}
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
        {value ? <AreaIcon name={value} size={16} /> : <Plus size={14} />}
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
            w-80 rounded-xl shadow-xl
            bg-white dark:bg-pitch-700
            border border-paper-300 dark:border-pitch-500
            p-4
            animate-fade-in
          "
        >
          <Label>Icon</Label>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons, e.g. code, users, shield"
            className={FIELD}
          />

          <div className="mt-3">
            <Label>{searching ? 'Results' : 'Quick pick'}</Label>
            {showing.length === 0 ? (
              <p className="text-xs text-paper-500 dark:text-paper-600">
                No icons match that. Try a plainer word.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {showing.map((name) => {
                  const Ico = iconByName(name)
                  if (!Ico) return null
                  const active = selected === name
                  return (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      aria-label={name}
                      aria-pressed={active}
                      onClick={() => pick(name)}
                      className={`w-9 h-9 rounded-md border flex items-center justify-center transition-colors
                        ${active
                          ? 'bg-mint-50 dark:bg-mint-900/20 border-mint text-paper-900 dark:text-pitch-50'
                          : 'bg-white dark:bg-pitch-800 border-paper-300 dark:border-pitch-500 text-paper-500 dark:text-paper-600 hover:bg-paper-100 dark:hover:bg-pitch-700 hover:text-paper-900 dark:hover:text-pitch-50'}`}
                    >
                      <Ico size={16} />
                    </button>
                  )
                })}
              </div>
            )}
            {!searching && (
              <p className="mt-2 text-xs leading-relaxed text-paper-500 dark:text-paper-600">
                Ten to pick from straight away, or search the full icon set for your own.
              </p>
            )}
          </div>

          {value && (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="
                mt-3 w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-md
                text-xs text-paper-600 dark:text-paper-500
                hover:bg-paper-200 dark:hover:bg-pitch-800 transition-colors
              "
            >
              <X size={12} />
              <span className="font-sans font-medium uppercase tracking-wide">Remove icon</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const FIELD = `w-full px-3 py-2.5 text-sm rounded-md
  bg-white dark:bg-pitch-800
  border border-paper-300 dark:border-pitch-500
  text-pitch-800 dark:text-white
  placeholder:text-paper-500 dark:placeholder:text-paper-600
  focus:outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-50 dark:focus:ring-mint-900/30`

function Label({ children }) {
  return (
    <p className="eyebrow text-paper-500 dark:text-paper-600 mb-1.5">
      {children}
    </p>
  )
}
