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
  'block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5'

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, loading, initialised, refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [oidc, setOidc] = useState({ enabled: false, provider_name: null })

  // Already signed in (incl. the desktop local admin), or a fresh instance that
  // needs setup first - send them where they belong.
  useEffect(() => {
    if (user) navigate('/', { replace: true })
    else if (initialised === false) navigate('/setup', { replace: true })
  }, [user, initialised, navigate])

  // Load SSO availability, and surface any error the OIDC callback bounced back.
  useEffect(() => {
    authApi.oidcConfig().then(setOidc).catch(() => {})
    const err = new URLSearchParams(window.location.search).get('error')
    if (err === 'account_disabled') setError('Your account is not active. Contact your administrator.')
    else if (err === 'invalid_state') setError('Sign-in failed. Please try again.')
    else if (err === 'sso_failed') setError('Single sign-on failed. Please try again.')
    else if (err === 'sso_unavailable') setError('Single sign-on is not available right now.')
    else if (err === 'no_seats') setError('No seats are available on this workspace. Contact your administrator.')
    else if (err === 'domain_not_allowed') setError('Your email domain is not allowed on this workspace. Contact your administrator.')
  }, [])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setSubmitting(true)
    try {
      await authApi.login(email.trim(), password)
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      // Forced SSO (and similar policy refusals) come back as a 403 with a
      // clear message - show it rather than the generic wrong-password line.
      const msg = String(err.message || '')
      setError(msg.toLowerCase().includes('single sign-on') ? msg : 'Email or password is incorrect.')
      setSubmitting(false)
    }
  }

  // While the initial /auth/me probe is in flight, show the same spinner the
  // guard uses rather than flashing the form (which then redirects away).
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

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700 p-6 shadow-sm"
        >
          <h1 className="font-sans text-lg font-semibold text-pitch-800 dark:text-pitch-50 mb-1">
            Welcome back
          </h1>
          <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 mb-6">
            Sign in to your Effro workspace.
          </p>

          {oidc.enabled && (
            <div className={oidc.password_login_disabled ? '' : 'mb-4'}>
              <button
                type="button"
                onClick={() => { window.location.href = '/api/auth/oidc/login' }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-paper-200 hover:bg-paper-300 dark:bg-pitch-600 dark:hover:bg-pitch-500 text-pitch-800 dark:text-pitch-50 border border-paper-300 dark:border-pitch-500 transition-colors"
              >
                Sign in with {oidc.provider_name || 'SSO'}
              </button>
              {!oidc.password_login_disabled && (
                <div className="flex items-center gap-3 mt-4">
                  <div className="flex-1 h-px bg-paper-300 dark:bg-pitch-600" />
                  <span className="text-2xs text-paper-500 dark:text-pitch-300">or</span>
                  <div className="flex-1 h-px bg-paper-300 dark:bg-pitch-600" />
                </div>
              )}
            </div>
          )}

          {/* Enterprise forced-SSO: the workspace signs in with SSO only, so the
              password form is hidden (the backend refuses it regardless). */}
          {oidc.password_login_disabled ? (
            <div className="mt-4">
              {error && (
                <p className="text-sm text-terracotta" role="alert">
                  {error}
                </p>
              )}
              <p className="font-lexend text-2xs text-paper-500 dark:text-pitch-200 mt-3 leading-relaxed">
                This workspace signs in with single sign-on only.
              </p>
            </div>
          ) : (
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
              className="btn btn-md btn-primary w-full"
            >
              {submitting ? <Spinner size={16} className="text-white" /> : 'Sign in'}
            </button>
          </div>
          )}
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
