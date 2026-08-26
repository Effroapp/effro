import { useState, useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { threadsApi, entriesApi } from '../api/client'
import { useToast } from './Toast'
import Modal from './Modal'
import MarkdownArea from './MarkdownArea'
import { DUE_DATE_OPTIONS } from '../utils/status'
import { useEntryTypes } from '../hooks/useEntryTypes'
import { suggestAndApplyTitle } from '../api/titles'
import { CUSTOM_PALETTE } from '../utils/entityIcons'

const ENTRY_TYPES = [
  { key: 'entry',    label: 'Entry' },
  { key: 'todo',     label: 'To Do' },
  { key: 'decision', label: 'Decision' },
]

export default function QuickCapture() {
  const [open, setOpen] = useState(false)
  const [entryType, setEntryType] = useState('entry')
  const [customTypeId, setCustomTypeId] = useState(null)
  // The user's own types sit alongside the built-ins here too, so capture
  // never has fewer options than the composer.
  const { types: customTypes, refresh: refreshTypes } = useEntryTypes()
  const [content, setContent] = useState('')
  const [threads, setThreads] = useState([])
  const [selectedThreadId, setSelectedThreadId] = useState('')
  const [dueDateOption, setDueDateOption] = useState(null)
  const [dueDate, setDueDate] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const textareaRef = useRef(null)

  // Global 'n' shortcut - fires only when no input is focused
  useEffect(() => {
    const handler = (e) => {
      if (open) return
      const tag = e.target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Fetch threads and autofocus textarea when modal opens
  useEffect(() => {
    if (!open) return
    threadsApi.getAll().then(setThreads).catch(() => {})
    // A type added in the composer should be here the moment capture opens.
    refreshTypes()
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [open, refreshTypes])

  const close = () => {
    setOpen(false)
    setContent('')
    setEntryType('entry')
    setCustomTypeId(null)
    setSelectedThreadId('')
    setDueDateOption(null)
    setDueDate(null)
  }

  const submit = async () => {
    if (!content.trim() || !selectedThreadId) return
    setSubmitting(true)
    try {
      const made = await entriesApi.create(Number(selectedThreadId), {
        content,
        type: entryType,
        custom_type_id: entryType === 'custom' ? customTypeId : undefined,
        due_date: entryType === 'todo' ? dueDate : undefined,
      })
      toast('Captured')
      close()
      // No Title field here, so the entry saves with its fallback. Ask for a
      // better one on the way out: the modal has gone and the thread will show
      // it next time it loads.
      suggestAndApplyTitle(made)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDueDateOption = (opt) => {
    setDueDateOption(opt.label)
    setDueDate(opt.resolve())
  }

  // Group threads by area name for <optgroup>
  const threadsByArea = threads.reduce((acc, t) => {
    if (!acc[t.area_name]) acc[t.area_name] = []
    acc[t.area_name].push(t)
    return acc
  }, {})

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title="Quick Capture"
      width="max-w-md"
      isDirty={Boolean(content.trim() || selectedThreadId || dueDate)}
    >
      <div className="space-y-4">
        {/* Entry type selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ENTRY_TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setEntryType(key); setCustomTypeId(null); setDueDateOption(null); setDueDate(null) }}
              className={`
                px-3 py-1 rounded-full text-xs font-sans font-medium uppercase tracking-wide transition-colors
                ${entryType === key
                  ? 'bg-mint-700 text-white'
                  : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                }
              `}
            >
              {label}
            </button>
          ))}
          {customTypes.map((t) => {
            const selected = entryType === 'custom' && customTypeId === t.id
            const palette = CUSTOM_PALETTE[t.colour] ?? CUSTOM_PALETTE.sage
            return (
              <button
                key={t.id}
                onClick={() => { setEntryType('custom'); setCustomTypeId(t.id); setDueDateOption(null); setDueDate(null) }}
                className={`
                  inline-flex items-center gap-1.5
                  px-3 py-1 rounded-full text-xs font-sans font-medium uppercase tracking-wide transition-colors
                  ${selected
                    ? 'bg-mint-700 text-white'
                    : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                  }
                `}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${selected ? 'bg-white' : palette.dot}`} />
                {t.name}
              </button>
            )
          })}
        </div>

        {/* Content box */}
        <MarkdownArea
          textareaRef={textareaRef}
          value={content}
          onChange={setContent}
          placeholder="Capture a thought, task, or decision…"
          rows={4}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
          className="bg-paper-100 dark:bg-pitch-700 border-paper-300 dark:border-paper-700"
        />

        {/* Thread selector */}
        <div>
          <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
            Thread
          </label>
          {threads.length === 0 ? (
            <p className="text-xs text-paper-500 dark:text-paper-700 italic">
              Create a thread in an area first.
            </p>
          ) : (
            <select
              value={selectedThreadId}
              onChange={(e) => setSelectedThreadId(e.target.value)}
              className="
                w-full px-3 py-2 text-sm rounded-lg
                bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                text-pitch-800 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            >
              <option value="">Select a thread…</option>
              {Object.entries(threadsByArea).map(([areaName, areaThreads]) => (
                <optgroup key={areaName} label={areaName}>
                  {areaThreads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>

        {/* Due date row - To Do only */}
        {entryType === 'todo' && (
          <div>
            <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Due Date
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DUE_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => handleDueDateOption(opt)}
                  className={`
                    px-2.5 py-1 rounded-full text-xs font-sans font-medium uppercase tracking-wide transition-colors
                    ${dueDateOption === opt.label
                      ? 'bg-mint-700 text-white'
                      : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {dueDateOption === 'Pick date' && (
              <input
                type="date"
                value={dueDate || ''}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-2 w-full text-sm px-3 py-2 rounded-lg bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-mint-500"
              />
            )}
            {dueDate && dueDateOption !== 'Pick date' && (
              <p className="font-mono text-xs text-paper-500 mt-1">
                due {format(parseISO(dueDate), 'dd MMM yyyy')}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={close}
            className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!content.trim() || !selectedThreadId || submitting}
            className="btn btn-md btn-primary"
          >
            {submitting ? 'Capturing…' : 'Capture'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
