import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, initialised, refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Already signed in (incl. the desktop local admin), or a fresh instance that
  // needs setup first - send them where they belong.
  useEffect(() => {
    if (user) navigate('/', { replace: true })
    else if (initialised === false) navigate('/setup', { replace: true })
  }, [user, initialised, navigate])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setSubmitting(true)
    try {
      await authApi.login(email.trim(), password)
      await refresh()
      navigate('/', { replace: true })
    } catch {
      setError('Email or password is incorrect.')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 dark:bg-pitch-800 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size={40} withText />
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700 p-6 shadow-sm"
        >
          <h1 className="font-display text-lg font-semibold text-pitch-800 dark:text-pitch-50 mb-1">
            Welcome back
          </h1>
          <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 mb-6">
            Sign in to your Effro workspace.
          </p>

          <div className="space-y-4">
            <div>
              <label className={LABEL}>Email</label>
              <input
                type="email"
                autoFocus
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
                autoComplete="current-password"
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
              {submitting ? <Spinner size={16} className="text-white" /> : 'Sign in'}
            </button>
          </div>
        </form>

        <p className="text-center mt-5">
          <a
            href="/privacy"
            className="text-xs text-paper-500 dark:text-pitch-200 hover:underline"
          >
            Privacy policy
          </a>
        </p>
      </div>
    </div>
  )
}
