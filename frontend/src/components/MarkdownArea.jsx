import { useRef } from 'react'
import { Bold, Italic, List, ListOrdered, Link2 } from 'lucide-react'
import {
  toggleInlineWrap, toggleLinePrefix, continueListOnEnter, insertLink,
} from '../utils/markdownEditing'

/**
 * MarkdownArea — the app's freeform text box: a quiet formatting row over a
 * plain textarea, reading as one control. Writes markdown, which every prose
 * surface renders via <Markdown>. Built in-house so the controls stay ours:
 * Lucide icons, app tokens, no editor library.
 *
 * Keyboard: Ctrl/Cmd+B bold, Ctrl/Cmd+I italic. Enter continues a list;
 * Enter on an empty item exits it. Other keys (e.g. Ctrl+Enter submit) pass
 * through to onKeyDown.
 *
 * onChange receives the next STRING (not an event).
 * className styles the frame (background/border); the default matches the
 * app's standard input look.
 */
export default function MarkdownArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  autoFocus = false,
  onKeyDown,
  onBlur,
  textareaRef,
  className = 'bg-paper-100 dark:bg-pitch-700 border-paper-300 dark:border-paper-700',
  textClassName = 'text-sm',
  compact = false,
}) {
  const innerRef = useRef(null)
  const taRef = textareaRef || innerRef

  const apply = (action) => {
    const ta = taRef.current
    if (!ta) return
    const next = action(ta.value, ta.selectionStart, ta.selectionEnd)
    onChange(next.value)
    // Restore focus + selection after React re-renders the controlled value.
    // setTimeout (not rAF): the desktop webview can pause compositing while
    // hidden, and rAF then never fires; a macrotask always does.
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(next.selStart, next.selEnd)
    }, 0)
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') { e.preventDefault(); apply((v, s, x) => toggleInlineWrap(v, s, x, '**')); return }
      if (k === 'i') { e.preventDefault(); apply((v, s, x) => toggleInlineWrap(v, s, x, '_')); return }
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      const ta = e.target
      const res = continueListOnEnter(ta.value, ta.selectionStart)
      if (res) {
        e.preventDefault()
        onChange(res.value)
        setTimeout(() => ta.setSelectionRange(res.caret, res.caret), 0)
        return
      }
    }
    onKeyDown?.(e)
  }

  const CONTROLS = [
    { Icon: Bold, title: 'Bold (Ctrl+B)', action: (v, s, x) => toggleInlineWrap(v, s, x, '**') },
    { Icon: Italic, title: 'Italic (Ctrl+I)', action: (v, s, x) => toggleInlineWrap(v, s, x, '_') },
    null,
    { Icon: List, title: 'Bullet list', action: (v, s, x) => toggleLinePrefix(v, s, x, 'bullet') },
    { Icon: ListOrdered, title: 'Numbered list', action: (v, s, x) => toggleLinePrefix(v, s, x, 'number') },
    null,
    { Icon: Link2, title: 'Link', action: insertLink },
  ]

  const iconSize = compact ? 12 : 14

  return (
    <div className={`rounded-lg border overflow-hidden focus-within:ring-2 focus-within:ring-mint-500 ${className}`}>
      <div className={`flex items-center gap-0.5 ${compact ? 'px-1 py-0.5' : 'px-1.5 py-1'} border-b border-paper-300/60 dark:border-pitch-500/60`}>
        {CONTROLS.map((c, i) =>
          c === null ? (
            <span key={i} className="w-px h-3.5 mx-0.5 bg-paper-300/80 dark:bg-pitch-500/80" />
          ) : (
            <button
              key={i}
              type="button"
              title={c.title}
              aria-label={c.title}
              onMouseDown={(e) => e.preventDefault()}  /* keep textarea focus + selection */
              onClick={() => apply(c.action)}
              className="
                p-1.5 rounded
                text-paper-500 dark:text-paper-600
                hover:text-paper-700 dark:hover:text-paper-300
                hover:bg-paper-200/70 dark:hover:bg-pitch-600/70
                transition-colors
              "
            >
              <c.Icon size={iconSize} />
            </button>
          )
        )}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`
          block w-full px-3 py-2.5 ${textClassName}
          bg-transparent resize-none
          text-pitch-800 dark:text-white
          placeholder:text-paper-400 dark:placeholder:text-paper-700
          focus:outline-none
        `}
      />
    </div>
  )
}
