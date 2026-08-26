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
  'block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5'

/**
 * Public landing for an emailed invite / reset link (/set-password?token=...).
 * Validates the token, lets the person choose a password, then signs them in.
 */
export default function SetPasswordPage() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '')
  const [status, setStatus] = useState('checking') // checking | valid | invalid
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setStatus('invalid'); return }
    authApi.resetTokenInfo(token)
      .then((r) => {
        if (r.valid) { setEmail(r.email); setStatus('valid') } else setStatus('invalid')
      })
      .catch(() => setStatus('invalid'))
  }, [token])

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (pw.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw !== pw2) { setError('Those passwords do not match.'); return }
    setSubmitting(true)
    try {
      await authApi.setPassword(token, pw)
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not set your password. The link may have expired.')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 dark:bg-pitch-800 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size={40} withText />
        </div>

        <div className="rounded-2xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700 p-6 shadow-sm">
          {status === 'checking' && (
            <div className="flex justify-center py-6"><Spinner size={24} /></div>
          )}

          {status === 'invalid' && (
            <div className="text-center">
              <p className="font-lexend text-sm text-paper-700 dark:text-pitch-100 mb-4">
                This link is invalid or has expired. Ask an admin to send a new invite.
              </p>
              <Link
                to="/login"
                className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={onSubmit}>
              <h1 className="font-sans text-lg font-semibold text-pitch-800 dark:text-pitch-50 mb-1">
                Set your password
              </h1>
              <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 mb-6">
                Welcome to Effro. Choose a password for <span className="font-medium">{email}</span>.
              </p>
              <div className="space-y-4">
                <div>
                  <label className={LABEL}>New password</label>
                  <input type="password" autoFocus autoComplete="new-password"
                         value={pw} onChange={(e) => setPw(e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Confirm password</label>
                  <input type="password" autoComplete="new-password"
                         value={pw2} onChange={(e) => setPw2(e.target.value)} className={FIELD} />
                </div>
                {error && <p className="text-sm text-terracotta" role="alert">{error}</p>}
                <button type="submit" disabled={submitting || !pw || !pw2}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors">
                  {submitting ? <Spinner size={16} className="text-white" /> : 'Set password and sign in'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
