import { useState } from 'react'
import { ListChecks, Check, X, Plus } from 'lucide-react'

/**
 * ActionSuggestionBanner - appears below a saved Update entry when the AI
 * spots action-intent vocabulary ("need to email…", "follow up with…").
 * Each detected action gets a one-click "Add to-do" button.
 *
 * Amber while there's work to add; mint once everything's been actioned.
 * Dismisses cleanly and never re-appears for the same entry.
 *
 * Props:
 *   actions      [{phrase, todo_title}]
 *   threadId     thread to create the to-do in
 *   onCreateTodo (title, threadId) => void
 *   onDismiss    () => void
 */
export default function ActionSuggestionBanner({ actions, threadId, onCreateTodo, onDismiss }) {
  const [dismissed, setDismissed] = useState(false)
  const [created, setCreated] = useState(new Set())

  if (dismissed || !actions || actions.length === 0) return null

  const handleCreate = (action) => {
    onCreateTodo?.(action.todo_title, threadId)
    setCreated((prev) => new Set([...prev, action.todo_title]))
  }

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  const allCreated = actions.every((a) => created.has(a.todo_title))

  return (
    <div className={`
      mt-2 rounded-lg border transition-colors
      ${allCreated
        ? 'bg-mint-50 dark:bg-mint-900/20 border-mint/40'
        : 'bg-mustard/10 dark:bg-mustard/15 border-mustard/30'}
    `}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {allCreated
            ? <Check size={13} className="text-mint-700 dark:text-mint-300 flex-shrink-0" />
            : <ListChecks size={13} className="text-mustard flex-shrink-0" />}
          <span className={`text-xs font-display uppercase tracking-wide ${
            allCreated ? 'text-mint-700 dark:text-mint-300' : 'text-mustard'
          }`}>
            {allCreated
              ? 'To-dos added'
              : actions.length === 1 ? 'Action detected' : `${actions.length} actions detected`}
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="p-0.5 rounded text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
          aria-label="Dismiss suggestions"
        >
          <X size={13} />
        </button>
      </div>

      {/* Action rows */}
      <div className="px-3.5 pb-3 space-y-1.5">
        {actions.map((action, i) => {
          const isCreated = created.has(action.todo_title)
          return (
            <div
              key={i}
              className={`flex items-center justify-between gap-3 px-2.5 py-2 rounded-md transition-colors ${
                isCreated ? 'bg-mint-50 dark:bg-mint-900/20' : 'bg-white/60 dark:bg-pitch-800/60'
              }`}
            >
              <div className="min-w-0">
                <p className={`text-sm leading-snug truncate ${
                  isCreated
                    ? 'text-mint-700 dark:text-mint-300 line-through'
                    : 'text-pitch-700 dark:text-paper-200'
                }`}>
                  {action.todo_title}
                </p>
                {!isCreated && action.phrase && (
                  <p className="text-[11px] text-paper-500 dark:text-paper-600 mt-0.5 truncate">
                    from: “{action.phrase}”
                  </p>
                )}
              </div>

              {isCreated ? (
                <span className="flex-shrink-0 text-[10px] font-mono text-mint-700 dark:text-mint-300">
                  Added ✓
                </span>
              ) : (
                <button
                  onClick={() => handleCreate(action)}
                  className="
                    flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded
                    text-xs font-medium
                    bg-mustard/15 dark:bg-mustard/20 text-mustard
                    border border-mustard/30
                    hover:bg-mustard/25 transition-colors
                  "
                >
                  <Plus size={12} />
                  Add to-do
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
