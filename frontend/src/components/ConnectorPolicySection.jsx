import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, ShieldCheck, RotateCcw } from 'lucide-react'
import ProviderLogo from './ProviderLogos'
import { adminApi } from '../api/client'

/**
 * Workspace connections - the admin's per-connector switches. Shown only to
 * admins on a licensed workspace (Settings -> Integrations); the edition sets
 * the default (Pro: on, Enterprise: off) and each switch pins one connector on
 * or off for everyone. Members just see the allowed connectors, nothing else.
 */
export default function ConnectorPolicySection({ onChanged }) {
  const [status, setStatus] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try { setStatus(await adminApi.getConnectors()) }
    catch (e) { setError(e.message || 'Failed to load') }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const setOverride = async (key, value) => {
    setBusyKey(key); setError(null)
    try {
      setStatus(await adminApi.saveConnectorOverrides({ [key]: value }))
      onChanged?.()
    } catch (e) {
      setError(e.message || 'Could not save')
    } finally {
      setBusyKey(null)
    }
  }

  if (error && !status) {
    return (
      <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {error}
      </div>
    )
  }
  if (!status) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper-500 dark:text-paper-600 italic">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-paper-300 dark:border-pitch-500 bg-white dark:bg-pitch-700 p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={14} className="text-mint flex-shrink-0" />
        <div className="eyebrow text-paper-500 dark:text-paper-600">
          Workspace connections
        </div>
      </div>
      <p className="text-xs text-paper-500 dark:text-paper-600 leading-relaxed mb-3">
        Which connections people on this workspace can set up. Your edition's default is{' '}
        <b>{status.edition_default ? 'on' : 'off'}</b>; a switch pins a connection either way.
      </p>

      <ul className="-my-1">
        {status.connectors.map((c, idx) => (
          <li key={c.key} className={`flex items-center gap-3 py-2 ${idx > 0 ? 'border-t border-paper-200 dark:border-pitch-600' : ''}`}>
            <ProviderLogo provider={c.key} size={16} />
            <span className="flex-1 min-w-0 text-sm text-pitch-800 dark:text-white truncate">{c.label}</span>
            {c.override !== null && c.override !== undefined && (
              <button
                onClick={() => setOverride(c.key, null)}
                disabled={busyKey === c.key}
                title="Return to the edition default"
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-2xs font-mono uppercase tracking-wide text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw size={10} /> Default
              </button>
            )}
            <Toggle
              on={c.enabled}
              busy={busyKey === c.key}
              onClick={() => setOverride(c.key, !c.enabled)}
              label={`${c.enabled ? 'Disable' : 'Enable'} ${c.label}`}
            />
          </li>
        ))}
      </ul>

      {error && (
        <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <p className="mt-3 text-2xs text-paper-500 dark:text-paper-600 leading-snug">
        Switching a connection off hides it for everyone, blocks new set-ups and pauses its
        background sync. Already-saved credentials are kept and work again when it is switched back on.
      </p>
    </div>
  )
}

function Toggle({ on, busy, onClick, label }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
        on ? 'bg-mint-700' : 'bg-paper-300 dark:bg-pitch-500'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
          on ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
