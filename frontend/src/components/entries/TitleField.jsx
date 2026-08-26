import { useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { suggestTitle } from '../../api/titles'
import { TODO_TITLE_FLOOR } from '../../utils/entries'
import { useAIConfigured } from '../../hooks/useAIConfigured'
import { useToast } from '../Toast'

/**
 * The title input, with its Suggest button.
 *
 * Shared by the composer and the card's inline editor so a title is written
 * the same way wherever it is written. A title is never required to save: leave
 * it blank and the server derives one from the entry's own first line.
 *
 * `onAiFlagChange` reports whether the current value came from the model, so
 * the caller can send `title_source: 'ai'` on save. Typing clears it, because
 * the moment the user edits the words they are theirs.
 */
export default function TitleField({
  value,
  onChange,
  content,
  entryType = null,
  onAiFlagChange,
  onEnter,
  autoFocus = false,
  placeholder = 'Title (optional)',
  inputRef,
}) {
  const toast = useToast()
  const { configured } = useAIConfigured()
  const [busy, setBusy] = useState(false)
  const ownRef = useRef(null)
  const ref = inputRef || ownRef

  // Below this there is nothing worth shortening, and the server refuses it
  // anyway, so the button stays out of the way. A to-do needs to be long
  // enough that shortening it actually helps.
  const floor = entryType === 'todo' ? TODO_TITLE_FLOOR : 20
  const canSuggest = (content || '').trim().length >= floor

  const suggest = async () => {
    if (busy) return
    setBusy(true)
    try {
      const title = await suggestTitle(content, entryType)
      onChange(title)
      onAiFlagChange?.(true)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative mb-2">
      <input
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); onAiFlagChange?.(false) }}
        onKeyDown={(e) => {
          // Enter moves on to the content rather than submitting, so a title
          // is never the thing that accidentally posts an empty entry.
          if (e.key === 'Enter') { e.preventDefault(); onEnter?.() }
        }}
        className={`w-full py-2 pl-3 text-sm rounded-md
          bg-white dark:bg-pitch-800
          border border-paper-300 dark:border-pitch-500
          text-pitch-800 dark:text-white
          placeholder:text-paper-500 dark:placeholder:text-paper-600
          focus:outline-none focus:ring-2 focus:ring-mint-500
          ${canSuggest && configured ? 'pr-32' : 'pr-3'}`}
      />

      {canSuggest && configured && (
        <button
          type="button"
          onClick={suggest}
          disabled={busy}
          className="absolute right-1.5 top-1/2 -translate-y-1/2
                     inline-flex items-center gap-1.5 px-2 py-1 rounded
                     text-2xs font-sans font-medium uppercase tracking-widest
                     text-paper-500 dark:text-paper-600
                     hover:text-mint-700 dark:hover:text-mint-300
                     hover:bg-mint-50 dark:hover:bg-mint-900/20
                     disabled:opacity-60 transition-colors"
        >
          {busy
            ? <Loader2 size={11} className="animate-spin" />
            : <Sparkles size={11} />}
          {entryType === 'todo' ? 'Shorten it' : 'Suggest a title'}
        </button>
      )}
    </div>
  )
}
