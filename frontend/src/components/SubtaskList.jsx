import { useState, useEffect } from 'react'
import { Check, ChevronDown, X, ListTree } from 'lucide-react'
import { toggleSubtask, deleteSubtask } from '../api/tasks'

/**
 * SubtaskList - the "Subtasks" section that lives INSIDE a to-do entry card.
 *
 * Renders as a bordered-off footer within the parent to-do (not a detached
 * sibling), so it reads as part of the same group. Collapsible, labelled,
 * with a progress bar in the header that's visible whether expanded or not.
 *
 * - Per-subtask completion toggle (optimistic) + delete-on-hover
 * - When a to-do was dismissed from the breakdown drawer but has no subtasks,
 *   shows a compact "Break this down" row instead.
 *
 * Subtasks are Entry rows: { id, content, completed, time_estimate_minutes }.
 *
 * Props:
 *   parentId          parent to-do entry id
 *   subtasks          [{id, content, completed, time_estimate_minutes}]
 *   decomp_dismissed  whether the user deferred the breakdown
 *   taskTitle         parent title (passed to onBreakDown)
 *   onBreakDown       (parentId, taskTitle) => void
 *   onSubtasksChange  (updatedSubtasks) => void   keeps parent state in sync
 */
export default function SubtaskList({
  parentId,
  subtasks = [],
  decomp_dismissed = false,
  taskTitle = '',
  onBreakDown,
  onSubtasksChange,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [localSubtasks, setLocalSubtasks] = useState(subtasks)

  // useState only snapshots the prop on first mount - so when the parent
  // merges freshly-approved subtasks in (or a refetch arrives), sync them
  // down. Optimistic toggle/delete already push the same data up via
  // onSubtasksChange, so this stays consistent and doesn't ping-pong.
  useEffect(() => {
    setLocalSubtasks(subtasks)
  }, [subtasks])

  const completedCount = localSubtasks.filter((s) => s.completed).length
  const totalCount = localSubtasks.length
  const allDone = totalCount > 0 && completedCount === totalCount
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  const formatEstimate = (mins) => {
    if (!mins) return null
    if (mins < 60) return `~${mins}m`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`
  }

  const handleToggle = async (subtask) => {
    const prev = localSubtasks
    const updated = localSubtasks.map((s) =>
      s.id === subtask.id ? { ...s, completed: !s.completed } : s
    )
    setLocalSubtasks(updated)
    onSubtasksChange?.(updated)
    try {
      await toggleSubtask(subtask.id)
    } catch {
      setLocalSubtasks(prev)
      onSubtasksChange?.(prev)
    }
  }

  const handleDelete = async (subtaskId) => {
    const prev = localSubtasks
    const updated = localSubtasks.filter((s) => s.id !== subtaskId)
    setLocalSubtasks(updated)
    onSubtasksChange?.(updated)
    try {
      await deleteSubtask(subtaskId)
    } catch {
      setLocalSubtasks(prev)
      onSubtasksChange?.(prev)
    }
  }

  // No subtasks yet - only offer a compact "Break this down" row if the user
  // deferred the breakdown earlier. Otherwise render nothing.
  if (totalCount === 0) {
    if (!decomp_dismissed) return null
    return (
      <div className="border-t border-paper-100 dark:border-pitch-500 bg-paper-100/40 dark:bg-pitch-800/30 px-4 py-2">
        <button
          onClick={() => onBreakDown?.(parentId, taskTitle)}
          className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-paper-600 hover:text-mint-700 dark:hover:text-mint-300 transition-colors"
        >
          <ListTree size={13} />
          Break this down
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-paper-100 dark:border-pitch-500 bg-paper-100/40 dark:bg-pitch-800/30">
      {/* Header - label + progress + collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2.5 px-4 py-2 group/sub"
      >
        <ChevronDown
          size={13}
          className={`text-paper-400 dark:text-paper-600 flex-shrink-0 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
        />
        <span className="eyebrow text-paper-500 dark:text-paper-600 flex-shrink-0">
          Subtasks
        </span>
        {/* Progress bar - fills the middle so it's a glanceable status whether
            the list is open or collapsed. */}
        <div className="flex-1 h-1 rounded-full bg-paper-200 dark:bg-pitch-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-500 ${allDone ? 'bg-mint' : 'bg-sky-muted'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className={`text-2xs font-mono tabular-nums flex-shrink-0 ${
          allDone ? 'text-mint-700 dark:text-mint-300' : 'text-paper-500 dark:text-paper-600'
        }`}>
          {completedCount}/{totalCount}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-2.5 space-y-1">
          {localSubtasks.map((subtask) => {
            const isDone = subtask.completed
            return (
              <div
                key={subtask.id}
                className="group/row flex items-start gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/60 dark:hover:bg-pitch-700/60 transition-colors"
              >
                <button
                  onClick={() => handleToggle(subtask)}
                  className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                    isDone
                      ? 'bg-mint-700 border-mint-700'
                      : 'border-paper-400 dark:border-pitch-500 hover:border-mint'
                  }`}
                  aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                >
                  {isDone && <Check size={11} className="text-white" />}
                </button>

                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-snug ${
                    isDone ? 'text-paper-500 dark:text-paper-600 line-through' : 'text-pitch-700 dark:text-paper-200'
                  }`}>
                    {subtask.content}
                  </p>
                  {subtask.time_estimate_minutes && !isDone && (
                    <span className="text-2xs font-mono text-paper-500 dark:text-paper-600 mt-0.5 block">
                      {formatEstimate(subtask.time_estimate_minutes)}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(subtask.id)}
                  className="opacity-0 group-hover/row:opacity-100 transition-opacity p-0.5 flex-shrink-0 text-paper-400 dark:text-paper-600 hover:text-terracotta focus-visible:opacity-100"
                  aria-label="Delete subtask"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
