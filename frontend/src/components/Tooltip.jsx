import { Info } from 'lucide-react'

/**
 * Branded tooltip — replaces the native browser `title=` so every hover hint in
 * the app shares one look that matches the brand kit (pitch/paper, soft shadow,
 * rounded). Pure CSS hover + keyboard-focus reveal, no portal: fine for the
 * short hints we use. The hint text resets case/tracking so it stays readable
 * even when the trigger sits inside an uppercase, letter-spaced label.
 *
 *   <Tooltip content="Explanation">{trigger}</Tooltip>
 *   <InfoTip content="What this is and how it's worked out" />
 */
const POS = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
}

export function Tooltip({ content, children, side = 'top', className = '' }) {
  if (!content) return children
  return (
    <span className={`relative inline-flex group/tt ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${POS[side] || POS.top} z-50
          w-max max-w-[15rem] rounded-lg px-3 py-2
          bg-pitch-800 text-paper-100 dark:bg-paper-100 dark:text-pitch-800
          text-xs font-normal normal-case tracking-normal leading-relaxed text-left
          shadow-lg ring-1 ring-black/5
          opacity-0 transition-opacity duration-150
          group-hover/tt:opacity-100 group-focus-within/tt:opacity-100`}
      >
        {content}
      </span>
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
