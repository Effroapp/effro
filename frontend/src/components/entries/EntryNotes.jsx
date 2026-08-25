import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import MarkdownArea from '../MarkdownArea'

// ─── Entry notes - collapsible free-text context on any entry type ───────────

export default function EntryNotes({ initial, onSave }) {
  const hasContent = (initial || '').trim().length > 0
  // Auto-expanded when there's content. Otherwise collapsed by default so
  // entries aren't cluttered. User toggle overrides per entry.
  const [open, setOpen] = useState(hasContent)
  const [value, setValue] = useState(initial || '')
  const [saving, setSaving] = useState(false)

  // Keep local draft in sync if the entry's notes change from elsewhere
  // (e.g. after a save the parent re-renders with the persisted value).
  useEffect(() => {
    setValue(initial || '')
  }, [initial])

  const flush = async () => {
    const next = value
    if ((next || '') === (initial || '')) return  // nothing changed
    setSaving(true)
    try {
      await onSave?.(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="
          inline-flex items-center gap-1.5 px-1.5 py-0.5 -ml-1.5 rounded
          text-2xs font-display uppercase tracking-widest
          text-paper-500 dark:text-paper-600
          hover:text-pitch-700 dark:hover:text-paper-200
          hover:bg-paper-100 dark:hover:bg-pitch-800
          transition-colors
        "
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        Notes
        {!open && hasContent && (
          <span className="ml-1 px-1 rounded bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200 font-mono text-2xs">
            {value.trim().length}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-1.5">
          <MarkdownArea
            value={value}
            onChange={setValue}
            onBlur={flush}
            placeholder="Add context, findings, or links - saved when you click away."
            rows={3}
            compact
            className="bg-paper-100 dark:bg-pitch-800 border-paper-200 dark:border-pitch-500"
            textClassName="text-xs leading-relaxed"
          />
        </div>
      )}
      {saving && (
        <p className="mt-0.5 text-2xs font-mono text-paper-400 dark:text-paper-700">
          Saving…
        </p>
      )}
    </div>
  )
}
