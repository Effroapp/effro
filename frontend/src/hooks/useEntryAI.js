import { useState, useCallback } from 'react'
import { detectActions, decomposeTask } from '../api/tasks'
import { suggestAndApplyTitle } from '../api/titles'

/**
 * useEntryAI - orchestrates the two post-save AI hint flows:
 *
 *   1. Update entries (type 'entry' or a custom type) → detect action
 *      vocabulary →
 *      ActionSuggestionBanner appears below the entry.
 *   2. To-do entries (type 'todo')  → assess decomposition need →
 *      TaskDecompositionDrawer slides in if the task warrants breaking up.
 *   3. Titled entries still carrying a fallback title → suggest a real one →
 *      the caller swaps the returned entry into thread state.
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

  // onTitled is called with the updated entry when a suggestion lands, so the
  // caller can replace it in thread state. Optional: Quick Capture has already
  // closed by then and simply ignores the result.
  const onEntrySaved = useCallback(async (entry, onTitled) => {
    if (!entry?.id) return
    // A reference card is a pointer at a file or a thread, not prose. There is
    // nothing in it to detect actions in, decompose or name.
    if (entry.type === 'reference') return

    // Path C - a fallback title gets a suggested one. First, because it is the
    // one the user is most likely to see land on the card in front of them.
    suggestAndApplyTitle(entry).then((updated) => {
      if (updated) onTitled?.(updated)
    })

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
