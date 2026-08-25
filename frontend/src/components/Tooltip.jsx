import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

/**
 * Branded tooltip — replaces the native browser `title=` so every hover hint in
 * the app shares one look that matches the brand kit (pitch/paper, soft shadow,
 * rounded). The hint text resets case/tracking so it stays readable even when
 * the trigger sits inside an uppercase, letter-spaced label.
 *
 *   <Tooltip content="Explanation">{trigger}</Tooltip>
 *   <InfoTip content="What this is and how it's worked out" />
 *
 * The bubble renders in a portal on `document.body`, positioned against the
 * trigger's viewport rect. That is what keeps it whole: an absolutely
 * positioned bubble is clipped by any `overflow: hidden` ancestor, and several
 * of our cards have one for their rounded accent bar, so a tooltip near a card
 * edge used to show as a cropped dark sliver. It also clamps itself into the
 * viewport and flips side rather than running off the top.
 */
const GAP = 8      // between trigger and bubble
const MARGIN = 8   // smallest gap to the viewport edge

function place(rect, side) {
  switch (side) {
    case 'bottom': return { left: rect.left + rect.width / 2, top: rect.bottom + GAP, tx: '-50%',  ty: '0' }
    case 'left':   return { left: rect.left - GAP,            top: rect.top + rect.height / 2, tx: '-100%', ty: '-50%' }
    case 'right':  return { left: rect.right + GAP,           top: rect.top + rect.height / 2, tx: '0',     ty: '-50%' }
    default:       return { left: rect.left + rect.width / 2, top: rect.top - GAP, tx: '-50%',  ty: '-100%' }
  }
}

export function Tooltip({ content, children, side = 'top', className = '' }) {
  const triggerRef = useRef(null)
  const bubbleRef = useRef(null)
  const clamped = useRef(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)

  const measure = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    // Flip a top-side tooltip below its trigger when there is no room above.
    const wanted = side === 'top' && rect.top < 44 ? 'bottom' : side
    setPos(place(rect, wanted))
  }, [side])

  const show = useCallback(() => { clamped.current = false; measure(); setOpen(true) }, [measure])
  const hide = useCallback(() => setOpen(false), [])

  // Keep it against the trigger while it is up, and clamp it inside the
  // viewport once its real width is known.
  useLayoutEffect(() => {
    if (!open) return
    const bubble = bubbleRef.current
    // Once per reveal, so a clamp can never chase its own tail.
    if (bubble && pos && !clamped.current) {
      clamped.current = true
      const r = bubble.getBoundingClientRect()
      const overLeft = MARGIN - r.left
      const overRight = r.right - (window.innerWidth - MARGIN)
      const shift = overLeft > 0 ? overLeft : overRight > 0 ? -overRight : 0
      if (shift) setPos((p) => (p ? { ...p, left: p.left + shift } : p))
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, pos, hide])

  if (!content) return children

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && pos && createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: `translate(${pos.tx}, ${pos.ty})`,
          }}
          className="pointer-events-none z-[200]
            w-max max-w-[15rem] rounded-lg px-3 py-2
            bg-pitch-800 text-paper-100 dark:bg-paper-100 dark:text-pitch-800
            text-xs font-normal normal-case tracking-normal leading-relaxed text-left
            shadow-lg ring-1 ring-black/5 animate-fade-in"
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  )
}

/**
 * The small, consistent 'i' affordance. Drop it next to any label or option to
 * explain what it is. Hover or keyboard-focus reveals the branded tooltip.
 */
export function InfoTip({ content, side = 'top', size = 13, className = '' }) {
  return (
    <Tooltip content={content} side={side}>
      <span
        tabIndex={0}
        aria-label="More information"
        className={`inline-flex items-center justify-center rounded-full cursor-help
          text-paper-400 dark:text-paper-600 hover:text-paper-600 dark:hover:text-paper-300
          focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500/40 transition-colors ${className}`}
      >
        <Info size={size} />
      </span>
    </Tooltip>
  )
}

export default Tooltip
