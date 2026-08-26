import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CUSTOM_COLOURS, CUSTOM_PALETTE, QUICK_PICK_ICONS,
  iconByName, searchIconNames,
} from '../../utils/entityIcons'

/**
 * The create-type panel.
 *
 * One real decision to make, which is the icon. Every custom type reads on the
 * same neutral ground on the rail unless the user gives it a colour, and the
 * icon is what tells two of them apart at a glance, so it is the thing the
 * panel is arranged around: ten to pick from straight away, or a search over
 * the whole Lucide set for anyone with something specific in mind.
 *
 * The preview shows exactly what the timeline will show, chip and medallion
 * together, because both are what the user is really choosing.
 */
const FALLBACK_ICON = 'circle-dot'

export default function CreateEntryType({ onCreate, onCancel, busy = false, error = null }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(null)
  const [colour, setColour] = useState(CUSTOM_COLOURS[0].key)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const nameRef = useRef(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  // 150ms, so typing does not filter four thousand names on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  const results = useMemo(() => searchIconNames(debounced), [debounced])
  const showing = debounced.trim() ? results : QUICK_PICK_ICONS

  const previewIcon = icon || FALLBACK_ICON
  const PreviewIcon = iconByName(previewIcon)
  const canCreate = !!name.trim() && !busy

  const submit = () => {
    if (!canCreate) return
    onCreate({ name: name.trim(), colour, icon: icon || FALLBACK_ICON })
  }

  return (
    <div className="rounded-xl border border-paper-300 dark:border-pitch-500
                    bg-white dark:bg-pitch-700 p-4">
      <Label>New entry type</Label>

      {/* Name */}
      <div className="mt-3">
        <Label>Name</Label>
        <input
          ref={nameRef}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          placeholder="Name, like Risk or Question"
          className={FIELD}
        />
      </div>

      {/* Icon search */}
      <div className="mt-3">
        <Label>Icon</Label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons, e.g. flag, shield, beaker"
          className={FIELD}
        />
      </div>

      {/* Quick pick, replaced by results while a search is running */}
      <div className="mt-3">
        <Label>{debounced.trim() ? 'Results' : 'Quick pick'}</Label>
        {showing.length === 0 ? (
          <p className="text-xs text-paper-500 dark:text-paper-600">
            No icons match that. Try a plainer word.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {showing.map((n) => {
              const Ico = iconByName(n)
              if (!Ico) return null
              const selected = icon === n
              return (
                <button
                  key={n}
                  type="button"
                  title={n}
                  aria-label={n}
                  aria-pressed={selected}
                  onClick={() => setIcon(selected ? null : n)}
                  className={`w-9 h-9 rounded-md border flex items-center justify-center transition-colors
                    ${selected
                      ? 'bg-mint-50 dark:bg-mint-900/20 border-mint text-paper-900 dark:text-pitch-50'
                      : 'bg-white dark:bg-pitch-800 border-paper-300 dark:border-pitch-500 text-paper-500 dark:text-paper-600 hover:bg-paper-100 dark:hover:bg-pitch-700 hover:text-paper-900 dark:hover:text-pitch-50'}`}
                >
                  <Ico size={16} />
                </button>
              )
            })}
          </div>
        )}
        {!debounced.trim() && (
          <p className="mt-2 text-xs leading-relaxed text-paper-500 dark:text-paper-600">
            Ten to pick from straight away, or search the full icon set for your own.
            The quick picks are all unclaimed by a built-in type, so they stay distinct
            in the timeline.
          </p>
        )}
      </div>

      {/* Colour */}
      <div className="mt-3">
        <Label>Colour</Label>
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-2">
          {CUSTOM_COLOURS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={colour === key}
              aria-label={label}
              onClick={() => setColour(key)}
              className={`w-5 h-5 rounded-full transition-transform ${CUSTOM_PALETTE[key].dot}
                ${colour === key
                  ? 'ring-2 ring-offset-2 ring-paper-700 dark:ring-paper-300 ring-offset-white dark:ring-offset-pitch-700'
                  : 'hover:scale-110'}`}
            />
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-terracotta">{error}</p>}

      {/* Preview and submit */}
      <div className="mt-4 pt-4 border-t border-paper-200 dark:border-pitch-500
                      flex items-center gap-3">
        <Label className="mb-0">Preview</Label>

        <span
          className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full
                     font-mono text-2xs font-medium uppercase tracking-[0.1em]"
          style={{
            color: `var(--${colour})`,
            background: `color-mix(in srgb, var(--${colour}) 12%, transparent)`,
            border: `1px solid color-mix(in srgb, var(--${colour}) 32%, transparent)`,
          }}
        >
          {PreviewIcon && <PreviewIcon size={12} />}
          {name.trim() || 'Name'}
        </span>

        <span
          className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
          style={{
            background: `color-mix(in srgb, var(--${colour}) 14%, var(--rail-ground))`,
            border: `1px solid color-mix(in srgb, var(--${colour}) 34%, transparent)`,
          }}
        >
          {PreviewIcon && <PreviewIcon size={15} strokeWidth={2} style={{ color: `var(--${colour})` }} />}
        </span>

        <span className="flex-1" />

        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded text-paper-600
                     hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canCreate}
          className="px-3 py-1.5 text-xs font-sans font-medium uppercase tracking-wide rounded
                     bg-mint-700 hover:bg-mint-800 text-white
                     disabled:opacity-50 transition-colors"
        >
          Create type
        </button>
      </div>

      {!icon && (
        <p className="mt-2 text-xs text-paper-500 dark:text-paper-600">
          No icon picked yet, so it will use the dotted circle.
        </p>
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

function Label({ children, className = 'mb-1.5' }) {
  return (
    <p className={`font-mono text-2xs uppercase tracking-[0.12em]
                   text-paper-500 dark:text-paper-600 ${className}`}>
      {children}
    </p>
  )
}
