import { useEffect, useRef, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

/**
 * Accessible modal dialog with built-in protection against accidental dismiss.
 *
 *   isDirty    - when true, backdrop click is ignored entirely; Escape and the
 *                X button trigger an inline "Discard changes?" confirm before
 *                actually closing. Defaults to false (legacy behaviour: click
 *                anywhere closes).
 *
 * Always-on protection:
 *   - For ~400 ms after the window regains focus from being blurred, backdrop
 *     clicks are ignored. The click that brings the app back into focus will
 *     never dismiss a modal, even when isDirty is false.
 *
 * Other closing paths (Cancel buttons, save) remain entirely up to the caller.
 */
export default function Modal({ isOpen, onClose, title, children, width = 'max-w-lg', isDirty = false }) {
  const [confirming, setConfirming] = useState(false)
  const panelRef = useRef(null)

  // ── Refocus guard - ignore backdrop clicks right after window refocus ──
  const lastFocusedAt = useRef(0)
  useEffect(() => {
    const onFocus = () => { lastFocusedAt.current = Date.now() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // ── Escape behaviour ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (confirming) { setConfirming(false); return }
      attemptClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isDirty, confirming, onClose])

  // ── Body scroll lock ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else        document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Reset confirm prompt when modal opens/closes
  useEffect(() => {
    if (!isOpen) setConfirming(false)
  }, [isOpen])

  if (!isOpen) return null

  const attemptClose = () => {
    if (isDirty) setConfirming(true)
    else onClose()
  }

  const confirmDiscard = () => {
    setConfirming(false)
    onClose()
  }

  const onBackdropClick = () => {
    // Layer 1: ignore clicks that landed within 400 ms of window refocus
    if (Date.now() - lastFocusedAt.current < 400) return
    // Layer 2: when the modal has unsaved work, backdrop never dismisses
    if (isDirty) return
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onBackdropClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-pitch-900/70 dark:bg-pitch-900/80 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`
          relative w-full ${width} animate-slide-in
          bg-white dark:bg-pitch-700
          border border-paper-300 dark:border-pitch-500
          rounded-xl shadow-2xl
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-paper-200 dark:border-pitch-500">
          <h2 className="font-display font-semibold text-sm uppercase tracking-wider text-pitch-700 dark:text-paper-200">
            {title}
          </h2>
          <button
            onClick={attemptClose}
            className="p-1 rounded text-paper-500 hover:text-paper-700 dark:hover:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">{children}</div>

        {/* Discard-changes inline confirm */}
        {confirming && (
          <div className="absolute inset-0 rounded-xl flex items-center justify-center bg-pitch-900/85 backdrop-blur-sm p-4 animate-fade-in">
            <div className="
              w-full max-w-sm rounded-lg
              bg-white dark:bg-pitch-700
              border border-paper-300 dark:border-pitch-500
              shadow-2xl p-5
            ">
              <div className="flex gap-3 mb-4">
                <AlertTriangle size={18} className="text-mustard flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-display uppercase tracking-wide text-xs text-pitch-800 dark:text-white mb-1">
                    Discard changes?
                  </p>
                  <p className="text-xs text-paper-600 dark:text-paper-400 leading-relaxed">
                    You'll lose what you've written. This can't be undone.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="
                    px-3 py-1.5 text-xs rounded-md font-display uppercase tracking-wide
                    text-paper-700 dark:text-paper-300
                    bg-paper-200 dark:bg-pitch-800
                    hover:bg-paper-300 dark:hover:bg-pitch-500
                    transition-colors
                  "
                >
                  Keep editing
                </button>
                <button
                  onClick={confirmDiscard}
                  className="
                    px-3 py-1.5 text-xs rounded-md font-display uppercase tracking-wide
                    text-white bg-terracotta hover:opacity-90
                    transition-colors
                  "
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
