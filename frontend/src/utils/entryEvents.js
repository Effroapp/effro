import { useEffect } from 'react'

/**
 * A single "entries changed" signal, for views that show a derived slice of
 * entries and so go stale when one is edited somewhere else on the page.
 *
 * The dashboard is the case that needs it: In Hand and Coming Up are two
 * different reads of the same to-dos, and ticking one in In Hand used to leave
 * the other showing the task as still open until a reload. Anything that
 * completes, uncompletes, pins or unpins an entry announces it here, and every
 * derived list refetches.
 *
 * Deliberately one coarse event with no payload. These lists are small and a
 * refetch is cheap, so the alternative (each consumer patching its own copy
 * from a diff) buys nothing and gets out of step.
 */
export const ENTRIES_CHANGED = 'effro:entries-changed'

export function notifyEntriesChanged() {
  window.dispatchEvent(new Event(ENTRIES_CHANGED))
}

/** Refetch whenever an entry changes anywhere in the app. */
export function useEntriesChanged(handler) {
  useEffect(() => {
    window.addEventListener(ENTRIES_CHANGED, handler)
    return () => window.removeEventListener(ENTRIES_CHANGED, handler)
  }, [handler])
}
