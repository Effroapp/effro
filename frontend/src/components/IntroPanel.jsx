import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * IntroPanel - the calm, first-run explainer used at the top of Insights and
 * each Settings tab. ONE consistent format everywhere: a soft mint panel with a
 * single icon, a bold title, a short paragraph (bold the keywords), and a
 * "Got it" link. Dismissed for good per `storageKey` (via the X or "Got it").
 *
 * Keep the body to one calm paragraph; wrap keywords in <Key>…</Key> for the
 * same emphasis the Insights welcome uses.
 *
 * Props:
 *   icon        - a Lucide icon component (rendered mint, size 17)
 *   title       - short heading, e.g. "Welcome to Insights"
 *   storageKey  - localStorage key that records "dismissed for good"
 *   children    - the body paragraph
 */
export default function IntroPanel({ icon: Icon, title, storageKey, children }) {
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(storageKey) != null } catch { return false }
  })
  if (seen) return null

  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1') } catch { /* ignore */ }
    setSeen(true)
  }

  return (
    <div className="relative rounded-xl bg-gradient-to-br from-mint/10 to-mint/[0.03] dark:from-mint/[0.12] dark:to-mint/[0.03] p-5 pr-10 mb-6 animate-rise motion-reduce:animate-none">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 p-1 rounded text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
      >
        <X size={15} />
      </button>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-mint/15 flex items-center justify-center flex-shrink-0">
          {Icon && <Icon size={17} className="text-mint-600 dark:text-mint-400" />}
        </span>
        <div>
          <p className="text-base font-semibold text-pitch-800 dark:text-white">{title}</p>
          <p className="text-sm text-paper-600 dark:text-paper-300 leading-relaxed mt-1">
            {children}
          </p>
          <button
            onClick={dismiss}
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-mint-700 dark:text-mint-300 hover:underline"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

/** Emphasised keyword inside an IntroPanel body - matches the Insights welcome. */
export function Key({ children }) {
  return <b className="font-medium text-pitch-700 dark:text-paper-200">{children}</b>
}
