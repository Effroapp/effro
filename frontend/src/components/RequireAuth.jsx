import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Spinner from './Spinner'

/**
 * Route guard. While the initial /auth/me probe is in flight, show a calm
 * centred spinner; once resolved, send unauthenticated visitors to /login and
 * let everyone else through. When auth is off (desktop) the probe returns the
 * synthetic local admin, so this always passes and no login is ever shown.
 */
export default function RequireAuth() {
  const { user, loading, initialised } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100 dark:bg-pitch-800">
        <Spinner size={28} />
      </div>
    )
  }
  // A fresh instance (no users yet) goes to first-run setup; otherwise login.
  if (!user) return <Navigate to={initialised === false ? '/setup' : '/login'} replace />
  return <Outlet />
}
