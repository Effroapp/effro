import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ArrowRight, AlertCircle } from 'lucide-react'
import Logo from './Logo'
import ProviderLogo from './ProviderLogos'

/**
 * The moment after an integration connects - one staged flow, same screen:
 *
 *   1. hello    Effro's mark and the provider's slide together, a tick pops
 *               between them, and the user is invited to pull in what is
 *               already there.
 *   2. syncing  in-place progress while the first sync runs.
 *   3. done     a calm summary of what arrived, a small preview of how
 *               captures look, and a Go to Signals that lands focused on
 *               this source.
 *
 * Used embedded (inside the integration modal, by CredentialIntegrationCard)
 * and standalone (over Settings, when an OAuth provider redirects back).
 *
 * props:
 *   providerKey   source key ('telegram', 'mail', 'microsoft'...) - drives the
 *                 Signals source focus
 *   providerName  display name ('Telegram', 'Email (IMAP)'...)
 *   providerLogo  ProviderLogos key
 *   syncNow       () => Promise<{added, updated, skipped, reason, error}>
 *   onClose       dismiss the flow
 *   standalone    render with own backdrop (OAuth return over Settings)
 */
export default function PostConnectFlow({
  providerKey, providerName, providerLogo, syncNow, onClose, standalone = false,
}) {
  const navigate = useNavigate()
  const [stage, setStage] = useState('hello')   // hello -> syncing -> done
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const runSync = async () => {
    setStage('syncing')
    try {
      setResult(await syncNow())
    } catch (e) {
      setError(e.message || 'Sync failed')
    }
    setStage('done')
  }

  const goToSignals = () => {
    onClose?.()
    navigate(`/signals?source=${providerKey}`)
  }

  const added = result?.added ?? 0
  const updated = result?.updated ?? 0
  const syncProblem = error || (result?.skipped ? (result.error || result.reason) : null)

  const body = (
    <div className="text-center px-1 py-3">
      {/* The two marks slide together. Between them: the tick (connected /
          outcome), or - while syncing - a looped stream of dots flowing from
          the provider into Effro, so the pull reads as motion, not a still. */}
      <div className="flex items-center justify-center mb-4" aria-hidden>
        <div className="pcf-slide-left w-14 h-14 rounded-2xl bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 flex items-center justify-center text-pitch-800 dark:text-paper-100">
          <Logo size={30} spinOnHover={false} />
        </div>
        {stage === 'syncing' ? (
          <div className="relative z-10 -mx-2.5 w-9 h-9">
            <span className="pcf-dot bg-mint-700 dark:bg-mint-300" />
            <span className="pcf-dot bg-mint-700 dark:bg-mint-300" />
            <span className="pcf-dot bg-mint-700 dark:bg-mint-300" />
          </div>
        ) : (
          <div className="pcf-tick z-10 -mx-2.5 w-9 h-9 rounded-full bg-mint-700 text-white flex items-center justify-center shadow-md">
            <Check size={18} strokeWidth={3} />
          </div>
        )}
        <div className="pcf-slide-right w-14 h-14 rounded-2xl bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 flex items-center justify-center">
          <ProviderLogo provider={providerLogo} size={28} />
        </div>
      </div>

      {stage === 'hello' && (
        <div className="animate-rise motion-reduce:animate-none">
          <h3 className="font-sans font-semibold text-lg text-pitch-800 dark:text-white">Connected</h3>
          <p className="mt-1 text-sm text-paper-600 dark:text-paper-300 leading-relaxed max-w-xs mx-auto">
            Effro and {providerName} are now friends. New captures will arrive on their own from here.
          </p>
          <p className="mt-3 text-sm text-pitch-700 dark:text-paper-200">Pull in what is already there?</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button onClick={runSync}
              className="px-4 py-2 rounded-md text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white transition-colors">
              Sync now
            </button>
            <button onClick={onClose}
              className="px-4 py-2 rounded-md text-sm text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors">
              Later
            </button>
          </div>
        </div>
      )}

      {stage === 'syncing' && (
        <div className="animate-rise motion-reduce:animate-none py-2">
          {/* The hero above carries the motion; one quiet line is enough here. */}
          <p className="text-sm text-paper-600 dark:text-paper-300">Pulling from {providerName}…</p>
        </div>
      )}

      {stage === 'done' && (
        <div className="animate-rise motion-reduce:animate-none">
          {syncProblem ? (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta text-left max-w-sm mx-auto">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span>Could not sync just now: {syncProblem}. The background sync keeps trying on its own.</span>
            </div>
          ) : (
            <>
              <h3 className="font-sans font-semibold text-lg text-pitch-800 dark:text-white">
                {added > 0
                  ? `${added} new item${added === 1 ? '' : 's'} arrived`
                  : 'All caught up'}
              </h3>
              <p className="mt-1 text-sm text-paper-600 dark:text-paper-300">
                {added > 0
                  ? 'They are waiting in Signals to triage.'
                  : updated > 0
                    ? `${updated} item${updated === 1 ? '' : 's'} refreshed. Nothing new to triage.`
                    : 'Nothing new over there yet. New captures will land in Signals.'}
              </p>
            </>
          )}

          {/* How a capture looks once it lands - a small honest preview. */}
          <div className="mt-4 max-w-sm mx-auto text-left">
            <p className="font-mono text-2xs uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1.5 text-center">
              New captures land in Signals
            </p>
            <div className="rounded-lg border border-paper-300 dark:border-pitch-500 bg-white dark:bg-pitch-700 p-3" aria-hidden>
              <div className="flex items-center gap-1.5 text-2xs text-paper-500 dark:text-paper-600 mb-1.5">
                <ProviderLogo provider={providerLogo} size={12} />
                <span className="font-medium text-paper-600 dark:text-paper-300">{providerName}</span>
                <span>·</span>
                <span>just now</span>
              </div>
              <div className="h-2.5 w-3/4 rounded bg-paper-200 dark:bg-pitch-600 mb-1.5" />
              <div className="h-2.5 w-1/2 rounded bg-paper-200 dark:bg-pitch-600 mb-2.5" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xs font-mono uppercase tracking-wider text-paper-500 dark:text-paper-600">Add as</span>
                <span className="px-1.5 py-0.5 rounded text-2xs bg-mint-700 text-white">To-do</span>
                <span className="px-1.5 py-0.5 rounded text-2xs border border-paper-300 dark:border-pitch-500 text-paper-600 dark:text-paper-300">Note</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <button onClick={goToSignals}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white transition-colors">
              Go to Signals <ArrowRight size={14} />
            </button>
            <button onClick={onClose}
              className="px-4 py-2 rounded-md text-sm text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )

  if (!standalone) return body

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-pitch-900/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 shadow-2xl p-5">
        {body}
      </div>
    </div>
  )
}
