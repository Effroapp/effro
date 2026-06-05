import { useEffect } from 'react'
import { presenceApi } from '../api/client'

// How often to register presence while the app is focused. The backend merges
// pings within 30 minutes into one session, so a 4-minute cadence is plenty to
// keep the working window accurate without churning the table.
const PING_INTERVAL_MS = 4 * 60 * 1000

/**
 * Records that the user is present, so Insights can infer an honest working
 * window (when you started, when you stopped). Pings on mount, whenever the
 * window regains focus, and on an interval while the tab is visible. Failures
 * are swallowed: presence is best-effort and must never interrupt the user.
 */
export function useHeartbeat() {
  useEffect(() => {
    const ping = () => { presenceApi.ping().catch(() => {}) }
    const tickIfVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }

    ping() // mark the open immediately
    const timer = setInterval(tickIfVisible, PING_INTERVAL_MS)
    window.addEventListener('focus', ping)
    document.addEventListener('visibilitychange', tickIfVisible)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', ping)
      document.removeEventListener('visibilitychange', tickIfVisible)
    }
  }, [])
}
