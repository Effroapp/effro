import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Spinner from '../components/Spinner'
import { useAuth } from '../contexts/AuthContext'
import { authApi } from '../api/client'

const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg bg-paper-100 dark:bg-pitch-700 ' +
  'border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white ' +
  'placeholder:text-paper-400 dark:placeholder:text-paper-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-mint-500'
const LABEL =
  'block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5'

export default function SetupPage() {
  const navigate = useNavigate()
  const { user, loading, initialised, refresh } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [alreadySetUp, setAlreadySetUp] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // If a user already exists (someone set it up, or this is the desktop local
  // admin), there is nothing to set up - move along.
  useEffect(() => {
    if (user) navigate('/', { replace: true })
    else if (initialised === true) navigate('/login', { replace: true })
  }, [user, initialised, navigate])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setSubmitting(true)
    try {
      await authApi.setup({
        email: email.trim(),
        display_name: displayName.trim(),
        password,
      })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      if (String(err.message || '').toLowerCase().includes('already')) {
        setAlreadySetUp(true)
      } else {
        setError('Could not create the account. Please try again.')
      }
      setSubmitting(false)
    }
  }

  // Avoid flashing the form during the initial /auth/me probe.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100 dark:bg-pitch-800">
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 dark:bg-pitch-800 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size={40} withText />
        </div>

        {alreadySetUp ? (
          <div className="rounded-2xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700 p-6 shadow-sm text-center">
            <p className="font-lexend text-sm text-paper-700 dark:text-pitch-100 mb-4">
              This instance is already set up.
            </p>
            <Link
              to="/login"
              className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white transition-colors"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700 p-6 shadow-sm"
          >
            <h1 className="font-display text-lg font-semibold text-pitch-800 dark:text-pitch-50 mb-1">
              Set up Effro
            </h1>
            <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 mb-6">
              Create the admin account for this workspace.
            </p>

            <div className="space-y-4">
              <div>
                <label className={LABEL}>Display name</label>
                <input
                  type="text"
                  autoFocus
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL}>Email</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL}>Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={FIELD}
                />
              </div>

              {error && (
                <p className="text-sm text-terracotta" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || !email.trim() || !password}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
              >
                {submitting ? <Spinner size={16} className="text-white" /> : 'Create admin account'}
              </button>

              <p className="font-lexend text-2xs text-paper-500 dark:text-pitch-200 leading-relaxed">
                You are the admin. Invite other team members from Settings after
                signing in.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
