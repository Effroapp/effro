import { useState, useEffect, useRef } from 'react'
import { Calendar } from 'lucide-react'
import Modal from './Modal'

/**
 * Quick meeting capture - designed for ADHD-friendly low-friction entry.
 * Only two required fields: title and start time. Both stay in view so the
 * user can fill them in without scrolling or hunting.
 *
 * The datetime field defaults to "now + 30 min, rounded up to next quarter"
 * so the user doesn't always have to type. Adjust away.
 */
export default function AddMeetingModal({ isOpen, onClose, onSubmit, submitting }) {
  const [title, setTitle] = useState('')
  const [datetime, setDatetime] = useState('')
  const titleRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setTitle('')
    setDatetime(defaultDatetimeLocal())
    setTimeout(() => titleRef.current?.focus(), 50)
  }, [isOpen])

  const canSubmit = title.trim().length > 0 && datetime

  const submit = (e) => {
    e?.preventDefault?.()
    if (!canSubmit || submitting) return
    onSubmit({
      title: title.trim(),
      // datetime-local gives "YYYY-MM-DDTHH:MM" with no tz; treat as local
      meeting_at: datetime,
    })
  }

  const isDirty = Boolean(title.trim())

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add meeting" width="max-w-md" isDirty={isDirty}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
            Title <span className="text-terracotta">*</span>
          </label>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sprint review with QA"
            className="
              w-full px-3 py-2 text-sm rounded-lg
              bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
              text-pitch-800 dark:text-white
              placeholder:text-paper-400 dark:placeholder:text-paper-700
              focus:outline-none focus:ring-2 focus:ring-mint-500
            "
          />
        </div>

        <div>
          <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
            When <span className="text-terracotta">*</span>
          </label>
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-paper-500 dark:text-paper-600 flex-shrink-0" />
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              className="
                flex-1 px-3 py-2 text-sm rounded-lg
                bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                text-pitch-800 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <QuickTime label="In 1 hour"     getDt={() => roundedLocal(60)} onPick={setDatetime} />
            <QuickTime label="Tomorrow 9am"  getDt={() => atTomorrow(9, 0)} onPick={setDatetime} />
            <QuickTime label="Tomorrow 2pm"  getDt={() => atTomorrow(14, 0)} onPick={setDatetime} />
            <QuickTime label="Next Monday 9am" getDt={() => nextMonday(9, 0)} onPick={setDatetime} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="btn btn-md btn-primary"
          >
            <Calendar size={13} />
            {submitting ? 'Adding…' : 'Add meeting'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function QuickTime({ label, getDt, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick(getDt())}
      className="
        px-2.5 py-1 rounded-full text-xs font-sans font-medium uppercase tracking-wide
        text-paper-600 dark:text-paper-500
        bg-paper-200 dark:bg-pitch-800
        hover:bg-paper-300 dark:hover:bg-pitch-500
        transition-colors
      "
    >
      {label}
    </button>
  )
}

// ── Datetime helpers (all output "YYYY-MM-DDTHH:MM" local) ───────────────────

function pad(n) { return String(n).padStart(2, '0') }

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultDatetimeLocal() {
  // Now + 30 min, rounded up to next 15 minutes
  return roundedLocal(30)
}

function roundedLocal(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60_000)
  const m = d.getMinutes()
  const bump = (15 - (m % 15)) % 15
  d.setMinutes(m + bump, 0, 0)
  return toLocalInput(d)
}

function atTomorrow(h, m) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, m, 0, 0)
  return toLocalInput(d)
}

function nextMonday(h, m) {
  const d = new Date()
  const day = d.getDay()  // Sunday=0
  const daysUntilMonday = day === 1 ? 7 : ((1 - day + 7) % 7 || 7)
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(h, m, 0, 0)
  return toLocalInput(d)
}
