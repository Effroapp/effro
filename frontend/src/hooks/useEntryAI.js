import { useState, useCallback } from 'react'
import { detectActions, decomposeTask } from '../api/tasks'

/**
 * useEntryAI - orchestrates the two post-save AI hint flows:
 *
 *   1. Update entries (type 'entry' or a custom type) → detect action
 *      vocabulary →
 *      ActionSuggestionBanner appears below the entry.
 *   2. To-do entries (type 'todo')  → assess decomposition need →
 *      TaskDecompositionDrawer slides in if the task warrants breaking up.
 *
 * Both are best-effort. If AI is unconfigured or a call fails, nothing shows -
 * the entry/to-do is already saved either way.
 *
 * Usage:
 *   const { actionSuggestions, drawerState, onEntrySaved,
 *           clearActions, openBreakdownDrawer, closeDrawer } = useEntryAI()
 *   // after a successful save:
 *   onEntrySaved(savedEntry)
 */
export function useEntryAI() {
  // { entryId, actions: [{phrase, todo_title}] }
  const [actionSuggestions, setActionSuggestions] = useState(null)
  // { entryId, taskTitle, subtasks: [{title, time_estimate_minutes}] }
  const [drawerState, setDrawerState] = useState(null)

  const onEntrySaved = useCallback(async (entry) => {
    if (!entry?.id) return

    // Path A - Update entry → action detection
    // A custom type is an Update underneath, so it gets the same action pass.
    if ((entry.type === 'entry' || entry.type === 'custom')
        && (entry.content?.trim().length || 0) > 10) {
      try {
        const data = await detectActions(entry.content, entry.id)
        if (data.actions?.length > 0) {
          setActionSuggestions({ entryId: entry.id, actions: data.actions })
        }
      } catch {
        // hint, not a gate - stay silent
      }
    }

    // Path B - to-do → decomposition assessment
    if (entry.type === 'todo' && (entry.content?.trim().length || 0) > 3) {
      try {
        const data = await decomposeTask(entry.id, entry.content)
        if (data.needed && data.subtasks?.length > 0) {
          setDrawerState({ entryId: entry.id, taskTitle: entry.content, subtasks: data.subtasks })
        }
      } catch {
        // silent
      }
    }
  }, [])

  // Re-open the drawer from the "Break this down" affordance.
  const openBreakdownDrawer = useCallback(async (entryId, taskTitle) => {
    try {
      const data = await decomposeTask(entryId, taskTitle)
      if (data.needed && data.subtasks?.length > 0) {
        setDrawerState({ entryId, taskTitle, subtasks: data.subtasks })
      }
    } catch {
      // silent
    }
  }, [])

  const clearActions = useCallback(() => setActionSuggestions(null), [])
  const closeDrawer = useCallback(() => setDrawerState(null), [])

  return {
    actionSuggestions,
    drawerState,
    onEntrySaved,
    clearActions,
    openBreakdownDrawer,
    closeDrawer,
  }
}
