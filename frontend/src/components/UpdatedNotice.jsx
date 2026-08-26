import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { isTauri, takeJustUpdated, openExternal } from '../api/tauri'

/**
 * Welcome-back notice shown once on the first launch after an auto-update.
 * The Rust side leaves a one-shot flag (in the config store, which survives
 * the post-update webview cache-bust); we read + clear it here.
 *
 * The read is delayed ~1.3s on purpose: the cache-bust reloads the webview
 * shortly after launch, so reading after that settles means this fires on the
 * final (post-reload) mount rather than racing the reload and being missed.
 */
export default function UpdatedNotice() {
  const [version, setVersion] = useState(null)

  useEffect(() => {
    if (!isTauri()) return
    const t = setTimeout(() => {
      takeJustUpdated().then((v) => { if (v) setVersion(v) }).catch(() => {})
    }, 1300)
    return () => clearTimeout(t)
  }, [])

  if (!version) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-[90] w-80 rounded-lg shadow-2xl
                 bg-white dark:bg-pitch-700 border border-mint/40 animate-slide-in"
      role="status" aria-live="polite"
    >
      <div className="h-0.5 bg-gradient-to-r from-mint/40 via-mint to-mint/40" />
      <div className="p-3.5 flex items-start gap-2.5">
        <Sparkles size={15} className="flex-shrink-0 mt-0.5 text-mint" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-sans font-medium uppercase tracking-widest text-mint-700 dark:text-mint-300">
            You are up to date
          </p>
          <p className="text-sm text-pitch-700 dark:text-paper-200 mt-1">
            Effro updated to <span className="font-mono font-semibold">{version}</span>. Welcome back.
          </p>
          <button
            onClick={() => openExternal('https://github.com/Effroapp/effro/releases')}
            className="mt-2 text-xs font-sans font-medium uppercase tracking-wide text-mint-700 dark:text-mint-300 hover:underline"
          >
            See what is new
          </button>
        </div>
        <button
          onClick={() => setVersion(null)}
          aria-label="Dismiss"
          className="flex-shrink-0 p-1 rounded opacity-50 hover:opacity-100 text-paper-500 dark:text-paper-600
                     hover:text-pitch-700 dark:hover:text-paper-200 transition-opacity"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
