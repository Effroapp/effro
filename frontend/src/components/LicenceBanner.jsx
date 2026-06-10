import { Link } from 'react-router-dom'
import { KeyRound, Clock, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Global licence notices, shown on every authed page when a licence is
 * required. One calm floating pill, top-centre, never alarmist:
 *   - read_only: the licence expired (past grace) or is invalid; reads and
 *     export still work, an admin can renew in Settings.
 *   - grace: expired but inside the grace window; full function plus this
 *     gentle renewal nudge.
 *   - over_seat (admins only): more active users than seats; growth is paused
 *     but nobody is locked out.
 * Hidden entirely on desktop / Pro (licence_required false) and when valid.
 */
export default function LicenceBanner() {
  const { user } = useAuth()
  const lic = user?.licence
  if (!lic || !lic.licence_required) return null
  const isAdmin = user?.role === 'admin'

  let Icon, tone, text
  if (lic.state === 'read_only') {
    Icon = KeyRound
    tone = 'border-terracotta/40 bg-terracotta/10 text-pitch-800 dark:text-paper-200'
    text = 'This workspace is read-only because its licence has expired or is invalid. You can still read and export everything.'
  } else if (lic.state === 'grace') {
    Icon = Clock
    tone = 'border-amber-muted/40 bg-amber-muted/10 text-pitch-800 dark:text-paper-200'
    text = `This licence expired${lic.expires_at ? ` on ${lic.expires_at}` : ''}. Everything still works. Renew within ${lic.grace_days_left ?? 'a few'} days to keep it that way.`
  } else if (lic.seat_state === 'over_seat' && isAdmin) {
    Icon = Users
    tone = 'border-amber-muted/40 bg-amber-muted/10 text-pitch-800 dark:text-paper-200'
    text = 'There are more active users than licensed seats. Everyone keeps working; adding or reactivating people is paused until you are back within seats.'
  } else {
    return null
  }

  return (
    <div
      role="status"
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-40 max-w-xl w-[calc(100%-2rem)] sm:w-auto
        flex items-start gap-2.5 px-4 py-2.5 rounded-xl border shadow-sm backdrop-blur ${tone}`}
    >
      <Icon size={15} className="flex-shrink-0 mt-0.5 opacity-70" />
      <p className="text-xs leading-relaxed">
        {text}{' '}
        {isAdmin && (
          <Link to="/settings" className="underline underline-offset-2 hover:opacity-80">
            Manage the licence in Settings
          </Link>
        )}
      </p>
    </div>
  )
}
