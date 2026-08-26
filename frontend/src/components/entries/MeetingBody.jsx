import { useEffect, useState } from 'react'
import { Calendar, Check, X } from 'lucide-react'
import { format } from 'date-fns'

// ─── Meeting body - title + datetime with inline edit ────────────────────────

export default function MeetingBody({ entry, editing, onEditStart, onCancel, onSave }) {
  const initialDt = entry.meeting_at ? toLocalInput(new Date(entry.meeting_at)) : ''
  const [title, setTitle] = useState(entry.content || '')
  const [dt, setDt] = useState(initialDt)
  const [saving, setSaving] = useState(false)

  // Re-seed local state whenever the entry changes underneath (e.g. after a save)
  useEffect(() => {
    setTitle(entry.content || '')
    setDt(entry.meeting_at ? toLocalInput(new Date(entry.meeting_at)) : '')
  }, [entry.content, entry.meeting_at])

  if (!editing) {
    return (
      <div
        onClick={onEditStart}
        className="cursor-text"
        title="Click to edit"
      >
        <div className="text-base font-medium text-pitch-800 dark:text-white leading-snug">
          {entry.content || <span className="italic text-paper-400 dark:text-paper-700">Untitled meeting</span>}
        </div>
        {entry.meeting_at ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-mono text-lavender">
            <Calendar size={11} />
            {format(new Date(entry.meeting_at), 'EEE dd MMM yyyy · HH:mm')}
          </div>
        ) : (
          <div className="mt-1.5 text-xs italic text-paper-400 dark:text-paper-700">
            No time set
          </div>
        )}
      </div>
    )
  }

  const canSave = title.trim().length > 0 && dt && !saving

  const commit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave?.({ title: title.trim(), meeting_at: dt })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-2xs font-sans font-medium uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1">
          Title
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="
            w-full px-3 py-2 text-sm rounded-md
            bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500
            text-pitch-800 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-mint-500
          "
        />
      </div>
      <div>
        <label className="block text-2xs font-sans font-medium uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1">
          When
        </label>
        <input
          type="datetime-local"
          value={dt}
          onChange={(e) => setDt(e.target.value)}
          className="
            w-full px-3 py-2 text-sm rounded-md
            bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500
            text-pitch-800 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-mint-500
          "
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
        >
          <X size={12} /> Cancel
        </button>
        <button
          onClick={commit}
          disabled={!canSave}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
        >
          <Check size={12} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
