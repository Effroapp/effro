import { useState } from 'react'
import { Pin } from 'lucide-react'

import { entriesApi } from '../api/client'
import { notifyEntriesChanged } from '../utils/entryEvents'
import { useToast } from './Toast'
import { Tooltip } from './Tooltip'

/**
 * The pin, at its origin. It lives on entry cards in the thread timeline and
 * on the open-task rows at the top of a thread, with the same treatment in
 * both places.
 *
 * Hollow on approach, filled once it means something. Unpinned it sits at low
 * contrast, findable without hunting. Pinned it is the filled glyph at ink-soft
 * and stays visible at rest, because by then it is reporting a state rather
 * than offering an action. Either state comes to full ink on hover.
 *
 * No colour on the control. It shares its size, padding and weight with the
 * edit and delete icons beside it so the corner cluster reads as one family,
 * and the fill alone says pinned. Mint in this feature is reserved for the
 * ticked checkbox and the completion settle.
 *
 * Tapping pins instantly. No dialog and no options: the same control unpins.
 * The tooltip is the feature's only teacher.
 */
export default function PinControl({ entryId, pinned, onChange, className = '' }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const toggle = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)

    // Optimistic, so the glyph answers the tap rather than the round trip.
    onChange?.(!pinned)
    try {
      const result = await entriesApi.togglePin(entryId)
      // The strip lives on another page, so tell it rather than have it poll.
      notifyEntriesChanged()
      if (result.pinned) {
        // The count rides along as the capacity signal, delivered at the
        // moment weight is added. It never warns and never blocks.
        toast(`Pinned. ${result.count} in hand.`)
      }
    } catch {
      onChange?.(pinned)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip content={pinned ? 'Unpin from In Hand' : 'Pin to In Hand'}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin from In Hand' : 'Pin to In Hand'}
        className={`p-1 rounded transition-colors
          hover:text-paper-900 dark:hover:text-white
          hover:bg-paper-200 dark:hover:bg-pitch-700
          ${pinned
            ? 'text-paper-700 dark:text-paper-300'
            : 'text-paper-900/[0.26] dark:text-white/30'
          } ${className}`}
      >
        <Pin size={12} fill={pinned ? 'currentColor' : 'none'} />
      </button>
    </Tooltip>
  )
}
