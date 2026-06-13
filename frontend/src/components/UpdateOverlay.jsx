import { Loader2, AlertCircle } from 'lucide-react'
import Logo from './Logo'
import { openExternal } from '../api/tauri'

/**
 * Full-screen, calm update experience. Once the user accepts an update the
 * whole thing happens here: a friendly screen with download progress, then the
 * app closes and reopens on its own. No installer wizard, no prompts - the
 * native installer runs silently (installMode "quiet"), so this overlay is the
 * only thing the user sees.
 *
 * Shown while updater.status is downloading / ready (installing) / error.
 * Returns null otherwise (the small UpdateToast handles the "available" prompt).
 */
export default function UpdateOverlay({ updater }) {
  if (!updater) return null
  const { status, progress, available, error, install, reset } = updater
  if (status !== 'downloading' && status !== 'ready' && status !== 'error') return null

  const pct = progress && progress.contentLength
    ? Math.min(100, Math.round((progress.downloaded / progress.contentLength) * 100))
    : null
  const target = available?.version

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-pitch-900/90 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Updating Effro" aria-live="polite"
    >
      <div className="effro-rise w-full max-w-sm rounded-2xl bg-paper-50 dark:bg-pitch-700
                      border border-paper-300 dark:border-pitch-400 shadow-2xl px-7 py-8 text-center">
        <div className="flex justify-center mb-4">
          {status === 'error'
            ? <span className="w-11 h-11 rounded-xl grid place-items-center bg-terracotta/10 border border-terracotta/25"><AlertCircle size={22} className="text-terracotta" /></span>
            : <span className="w-11 h-11 rounded-xl grid place-items-center bg-mint/10 border border-mint/20"><Logo size={24} /></span>}
        </div>

        {status === 'error' ? (
          <>
            <h2 className="font-display font-semibold text-lg text-pitch-800 dark:text-pitch-50">The update could not finish</h2>
            <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 mt-2 leading-relaxed">
              Nothing has changed - you are still on your current version. You can try again, or download it yourself.
            </p>
            {error && <p className="font-mono text-2xs text-paper-500 dark:text-pitch-300 mt-2 break-words">{error}</p>}
            <div className="flex items-center justify-center gap-2 mt-5">
              <button onClick={install}
                className="px-4 py-2 rounded-md text-sm font-medium bg-mint-700 hover:bg-mint-800 text-white transition-colors">
                Try again
              </button>
              <button onClick={() => openExternal('https://github.com/Effroapp/effro/releases')}
                className="px-3 py-2 rounded-md text-sm text-paper-700 dark:text-pitch-100 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
                Download manually
              </button>
              <button onClick={reset}
                className="px-3 py-2 rounded-md text-sm text-paper-500 dark:text-pitch-200 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="font-mono text-2xs uppercase tracking-[0.18em] text-mint-700 dark:text-mint-300">Updating Effro</p>
            <h2 className="font-display font-semibold text-xl text-pitch-800 dark:text-pitch-50 mt-1.5">
              {status === 'ready' ? 'Almost there' : 'Downloading the update'}
            </h2>
            {target && (
              <p className="font-mono text-2xs text-paper-500 dark:text-pitch-200 mt-1.5">
                {available.currentVersion} <span className="opacity-50">→</span> <span className="text-pitch-700 dark:text-pitch-50">{target}</span>
              </p>
            )}

            {/* Progress: a real bar while downloading, an indeterminate sweep
                while the installer applies it. */}
            <div className="mt-5 h-1.5 rounded-full bg-paper-300 dark:bg-pitch-600 overflow-hidden">
              {status === 'downloading' && pct != null
                ? <div className="h-full rounded-full bg-mint transition-[width] duration-300" style={{ width: `${pct}%` }} />
                : <div className="h-full w-1/3 rounded-full bg-mint animate-pulse" />}
            </div>
            {status === 'downloading' && pct != null && (
              <p className="font-mono text-2xs text-paper-500 dark:text-pitch-200 mt-2">{pct}%</p>
            )}

            <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 mt-5 leading-relaxed">
              {status === 'ready'
                ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin text-mint" /> Applying the update. Effro will close and reopen in a moment.</span>
                : 'This usually takes under a minute. Feel free to grab a coffee - Effro will reopen on its own when it is done.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
