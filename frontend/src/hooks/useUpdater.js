import { useEffect, useState, useCallback } from 'react'
import { isTauri, checkForUpdate, relaunchForUpdate } from '../api/tauri'

/**
 * Silent updater hook + per-version dismissal tracking.
 *
 * Flow:
 *   1. On mount (only in Tauri), silently calls the manifest endpoint.
 *   2. If a newer version is found, exposes it via `available` + sets
 *      status to 'available'. The App-level UpdateToast picks this up
 *      and shows a bottom-right prompt.
 *   3. User clicks "Install" → `install()` downloads + verifies + applies.
 *   4. User clicks "Later" → `dismiss()` writes the version to localStorage
 *      under `updateDismissedVersions`. The toast disappears but the
 *      System Settings cog gets a badge dot - gentle reminder.
 *   5. If a NEW version becomes available later (e.g. v0.1.2 after they
 *      dismissed v0.1.1), the toast re-appears because the new version
 *      isn't in the dismissed list. Only that specific version was
 *      declined; later releases aren't preemptively silenced.
 *
 * Status values:
 *   - 'idle'         no check has run (e.g. browser/Docker)
 *   - 'checking'     manifest fetch in flight
 *   - 'available'    newer version found AND not dismissed
 *   - 'dismissed'    newer version found BUT user clicked Later
 *   - 'none'         current version is the latest
 *   - 'downloading'  install in progress
 *   - 'ready'        installer applied, awaiting relaunch
 *   - 'error'        check or install failed
 *
 * The hook also debounces re-checks to 1 hour within a single session
 * (module-scope timestamp survives unmounts but not full page reloads).
 */

const DISMISSED_KEY = 'updateDismissedVersions'
let _lastCheckedAt = 0
const RECHECK_INTERVAL_MS = 60 * 60 * 1000   // 1 hour

function loadDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch {
    return new Set()
  }
}

function saveDismissed(set) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]))
  } catch {
    // localStorage might be unavailable (private mode, etc.) - fail open.
  }
}

export function useUpdater({ enabled = true } = {}) {
  const [status, setStatus] = useState('idle')
  const [available, setAvailable] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState(() => loadDismissed())

  useEffect(() => {
    if (!isTauri()) return
    // Enterprise licences disable auto-update (v1: no silent updates, no feed).
    // The 1-hour debounce below means re-evaluating when `enabled` flips (e.g.
    // once /auth/me loads) costs at most one extra check.
    if (!enabled) return

    const now = Date.now()
    if (now - _lastCheckedAt < RECHECK_INTERVAL_MS) return
    _lastCheckedAt = now

    let cancelled = false
    setStatus('checking')

    checkForUpdate()
      .then((result) => {
        if (cancelled) return
        if (!result) return setStatus('idle')           // not in Tauri
        if (!result.available) return setStatus('none')
        setAvailable(result)
        // If the user has already dismissed this exact version, jump
        // straight to the 'dismissed' state - only the cog badge will
        // show, no toast.
        const isDismissed = dismissed.has(result.version)
        setStatus(isDismissed ? 'dismissed' : 'available')
      })
      .catch((err) => {
        if (cancelled) return
        setError(typeof err === 'string' ? err : String(err))
        setStatus('error')
      })

    return () => { cancelled = true }
    // Depend only on `enabled` (not `dismissed`): the initial check should run
    // once per session-window; the module-scope debounce guards repeats if
    // `enabled` toggles. Subsequent dismissals are handled by dismiss() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  /** Persist dismissal of THIS version. Toast hides; badge persists. */
  const dismiss = useCallback(() => {
    if (!available) return
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(available.version)
      saveDismissed(next)
      return next
    })
    setStatus('dismissed')
  }, [available])

  /** Download + install + relaunch. UI disables interaction during this. */
  const install = useCallback(async () => {
    if (!available) return
    setStatus('downloading')
    try {
      await available.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setProgress({ downloaded: 0, contentLength: event.data?.contentLength ?? 0 })
        } else if (event.event === 'Progress') {
          setProgress((p) => p
            ? { ...p, downloaded: p.downloaded + (event.data?.chunkLength ?? 0) }
            : null)
        }
      })
      setStatus('ready')
      await relaunchForUpdate()
    } catch (err) {
      setError(typeof err === 'string' ? err : String(err))
      setStatus('error')
    }
  }, [available])

  return { status, available, progress, error, install, dismiss }
}
