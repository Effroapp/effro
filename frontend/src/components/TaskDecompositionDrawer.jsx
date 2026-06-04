import { useState, useEffect, useCallback } from 'react'
import { ListTree, X, Check, Clock, Loader2, Trash2 } from 'lucide-react'
import { createSubtasks, dismissDecomp } from '../api/tasks'

/**
 * TaskDecompositionDrawer - slides in from the right after a to-do is saved,
 * when the AI judges the task worth breaking up. The user can rename or remove
 * each suggested subtask, then approve or defer.
 *
 * Tone: a gift, not a gate. The to-do exists whether they engage or not.
 * Dismiss = defer ("Break down later" persists on the card), not fail.
 *
 * Props:
 *   entryId    parent to-do id
 *   taskTitle  shown as context
 *   subtasks   AI suggestions [{title, time_estimate_minutes}]
 *   onApprove  (createdSubtasks) => void
 *   onDismiss  () => void   (server marks decomp_dismissed)
 *   onClose    () => void   (no server action)
 */
export default function TaskDecompositionDrawer({
  entryId,
  taskTitle,
  subtasks: initial,
  onApprove,
  onDismiss,
  onClose,
}) {
  const [items, setItems] = useState(
    (initial || []).map((s, i) => ({ ...s, _id: i }))
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20)
    return () => clearTimeout(t)
  }, [])

  const totalMinutes = items.reduce((acc, s) => acc + (s.time_estimate_minutes || 0), 0)
  const formatTotal = (mins) => {
    if (mins < 60) return `${mins} min`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  const updateTitle = useCallback((id, title) => {
    setItems((prev) => prev.map((s) => (s._id === id ? { ...s, title } : s)))
  }, [])

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((s) => s._id !== id))
  }, [])

  const handleClose = useCallback(() => {
    setVisible(false)
    setTimeout(() => onClose?.(), 300)
  }, [onClose])

  const handleApprove = async () => {
    const valid = items.filter((s) => s.title.trim().length > 0)
    if (valid.length === 0) return
    setIsSubmitting(true)
    try {
      const data = await createSubtasks(
        entryId,
        valid.map((s, i) => ({
          title: s.title.trim(),
          time_estimate_minutes: s.time_estimate_minutes,
          subtask_order: i,
        }))
      )
      onApprove?.(data.subtasks)
      handleClose()
    } catch (e) {
      // Surface nothing fancy - leave the drawer open so they can retry.
      console.error('Failed to create subtasks:', e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDismiss = async () => {
    try {
      await dismissDecomp(entryId)
    } catch {
      // best-effort
    }
    onDismiss?.()
    handleClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleDismiss}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Drawer */}
      <div
        className={`
          fixed top-0 right-0 h-full w-full max-w-sm z-50 flex flex-col
          bg-white dark:bg-pitch-800 border-l border-paper-300 dark:border-pitch-700
          shadow-2xl transition-transform duration-300 ease-out
          ${visible ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="px-5 pt-6 pb-4 border-b border-paper-200 dark:border-pitch-700">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-mint-50 dark:bg-mint-900/20 border border-mint/30 flex items-center justify-center flex-shrink-0">
              <ListTree size={16} className="text-mint-700 dark:text-mint-300" />
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 -mr-1 text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <h2 className="font-display font-medium text-base text-pitch-800 dark:text-white leading-snug">
            Here's a breakdown
          </h2>
          <p className="text-xs text-paper-500 dark:text-paper-600 mt-1 leading-relaxed">
            This task looks like it has a few moving parts. Here's a suggested
            sequence - edit anything, remove what doesn't fit.
          </p>

          <div className="mt-3 px-3 py-2 rounded-md bg-paper-100 dark:bg-pitch-700 border border-paper-200 dark:border-pitch-500">
            <p className="text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1">
              Breaking down
            </p>
            <p className="text-sm text-pitch-700 dark:text-paper-200 leading-snug line-clamp-2">
              {taskTitle}
            </p>
          </div>
        </div>

        {/* Subtask list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {items.map((item, idx) => (
            <SubtaskEditRow
              key={item._id}
              item={item}
              index={idx}
              onUpdateTitle={updateTitle}
              onRemove={removeItem}
              isLast={items.length <= 1}
            />
          ))}
          {items.length === 0 && (
            <div className="text-center py-8 text-paper-500 dark:text-paper-600 text-sm">
              All subtasks removed - close to keep the original task only.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-6 pt-4 border-t border-paper-200 dark:border-pitch-700 space-y-3">
          {totalMinutes > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-paper-600 font-mono">
              <Clock size={13} />
              Estimated total: {formatTotal(totalMinutes)}
            </div>
          )}

          <button
            onClick={handleApprove}
            disabled={isSubmitting || items.length === 0}
            className="
              w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
              text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors
            "
          >
            {isSubmitting ? (
              <><Loader2 size={15} className="animate-spin" /> Creating…</>
            ) : (
              <><Check size={15} /> Looks good - create {items.length} subtask{items.length !== 1 ? 's' : ''}</>
            )}
          </button>

          <button
            onClick={handleDismiss}
            className="w-full px-4 py-2.5 rounded-lg text-sm text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
          >
            Break down later
          </button>
        </div>
      </div>
    </>
  )
}

// ── Editable subtask row ──────────────────────────────────────────────────────

function SubtaskEditRow({ item, index, onUpdateTitle, onRemove, isLast }) {
  const [editing, setEditing] = useState(false)

  const formatEstimate = (mins) => {
    if (!mins) return null
    if (mins < 60) return `${mins}m`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  return (
    <div className={`group flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
      editing
        ? 'bg-paper-100 dark:bg-pitch-700 border-mint/40'
        : 'bg-white dark:bg-pitch-800 border-paper-200 dark:border-pitch-700 hover:border-paper-300 dark:hover:border-pitch-500'
    }`}>
      <span className="w-5 h-5 rounded-full bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 flex items-center justify-center text-[10px] font-mono text-paper-600 dark:text-paper-500 flex-shrink-0 mt-0.5">
        {index + 1}
      </span>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={item.title}
            onChange={(e) => onUpdateTitle(item._id, e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
            className="w-full bg-transparent text-sm text-pitch-800 dark:text-white outline-none border-b border-mint/50 pb-0.5 placeholder:text-paper-400 dark:placeholder:text-paper-700"
            placeholder="Describe this step…"
          />
        ) : (
          <p
            onClick={() => setEditing(true)}
            className="text-sm text-pitch-700 dark:text-paper-200 leading-snug cursor-text hover:text-pitch-900 dark:hover:text-white transition-colors"
          >
            {item.title}
          </p>
        )}

        {item.time_estimate_minutes && !editing && (
          <span className="inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-paper-100 dark:bg-pitch-700 text-paper-500 dark:text-paper-600 border border-paper-200 dark:border-pitch-500">
            <Clock size={10} />
            ~{formatEstimate(item.time_estimate_minutes)}
          </span>
        )}
      </div>

      {!isLast && (
        <button
          onClick={() => onRemove(item._id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 mt-0.5 flex-shrink-0 text-paper-400 dark:text-paper-600 hover:text-terracotta"
          aria-label="Remove subtask"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
