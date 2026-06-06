import { useState } from 'react'
import { Info, Sparkles, ShieldCheck, X, ChevronDown } from 'lucide-react'

/**
 * Calm, ADHD-first intro for a Settings tab. Instead of a wall of text it shows
 * the message as three scannable beats - what it is / how it helps / why we do
 * it - each with its own icon and a short line. Dismissing it collapses to a
 * one-line "What is X?" strip (persisted), reopenable any time. Mirrors the
 * Insights welcome + eyelid-hide patterns.
 *
 *   beats: [{ label, text }, ...]  (in what / how / why order)
 */
const BEAT_META = [
  { Icon: Info,        color: 'var(--sky-muted)' },  // what it is  (sky)
  { Icon: Sparkles,    color: 'var(--sage)' },  // how it helps (mint/sage)
  { Icon: ShieldCheck, color: 'var(--lavender)' },  // why we do it (lavender)
]

export default function IntroCard({ id, title, beats }) {
  const key = `effro.intro.${id}`
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== 'dismissed' } catch { return true }
  })

  const dismiss = () => { setOpen(false); try { localStorage.setItem(key, 'dismissed') } catch { /* ignore */ } }
  const reopen = () => { setOpen(true); try { localStorage.removeItem(key) } catch { /* ignore */ } }

  if (!open) {
    return (
      <button
        onClick={reopen}
        className="w-full flex items-center gap-2 mb-5 px-3 py-2 rounded-lg border border-dashed border-paper-300 dark:border-pitch-500 text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 hover:border-paper-400 dark:hover:border-pitch-400 transition-colors text-left"
      >
        <Info size={14} className="flex-shrink-0" />
        <span className="text-[13px]">What is <span className="font-medium">{title}</span>?</span>
        <ChevronDown size={14} className="ml-auto flex-shrink-0" />
      </button>
    )
  }

  return (
    <div className="relative mb-5 rounded-xl border border-paper-300 dark:border-pitch-500 bg-white dark:bg-pitch-700 p-4 pr-9">
      <button
        onClick={dismiss}
        aria-label="Hide this"
        className="absolute top-3 right-3 p-1 rounded text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
      >
        <X size={15} />
      </button>
      <div className="space-y-3">
        {beats.map((b, i) => {
          const m = BEAT_META[i] || BEAT_META[0]
          return (
            <div key={i} className="flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `color-mix(in srgb, ${m.color} 10%, transparent)` }}
              >
                <m.Icon size={14} style={{ color: m.color }} />
              </span>
              <div className="min-w-0">
                <div className="font-mono uppercase tracking-widest text-[10px] text-paper-500 dark:text-paper-600 mb-0.5">
                  {b.label}
                </div>
                <p className="text-sm text-paper-600 dark:text-paper-300 leading-snug">{b.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
