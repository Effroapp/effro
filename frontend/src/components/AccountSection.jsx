import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, KeyRound, Monitor, Download, AlertTriangle } from 'lucide-react'
import { authApi, accountApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'

const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg bg-paper-100 dark:bg-pitch-700 ' +
  'border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white ' +
  'placeholder:text-paper-400 dark:placeholder:text-paper-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-mint-500'
const CARD = 'rounded-xl border border-paper-300 dark:border-pitch-600 p-5'
const H3 = 'font-display text-sm font-semibold text-pitch-800 dark:text-pitch-50 mb-3 flex items-center gap-2'
const BTN = 'px-4 py-2 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors'

/** Self-service account settings for any signed-in user (auth-enabled only). */
export default function AccountSection() {
  return (
    <div className="space-y-6">
      <ChangePassword />
      <Sessions />
      <DangerZone />
    </div>
  )
}

function ChangePassword() {
  const toast = useToast()
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [cf, setCf] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (nw.length < 8) { toast('Use at least 8 characters.', 'error'); return }
    if (nw !== cf) { toast('Those new passwords do not match.', 'error'); return }
    setBusy(true)
    try {
      await authApi.changePassword(cur, nw)
      toast('Password changed. Your other sessions were signed out.')
      setCur(''); setNw(''); setCf('')
    } catch (e) {
      toast(e.message || 'Could not change your password.', 'error')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className={CARD}>
      <h3 className={H3}><KeyRound size={15} className="text-mint-600 dark:text-mint-400" /> Password</h3>
      <div className="space-y-3 max-w-sm">
        <input className={FIELD} type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className={FIELD} type="password" autoComplete="new-password" placeholder="New password" value={nw} onChange={(e) => setNw(e.target.value)} />
        <input className={FIELD} type="password" autoComplete="new-password" placeholder="Confirm new password" value={cf} onChange={(e) => setCf(e.target.value)} />
        <button type="submit" disabled={busy || !cur || !nw} className={BTN}>{busy ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  )
}

function Sessions() {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    authApi.sessions().then(setRows).catch((e) => toast(e.message || 'Could not load sessions', 'error')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const revoke = async (id) => {
    try { await authApi.revokeSession(id); load() }
    catch (e) { toast(e.message || 'Could not revoke that session', 'error') }
  }
  const revokeOthers = async () => {
    try { const r = await authApi.revokeOtherSessions(); toast(`Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}`); load() }
    catch (e) { toast(e.message || 'Could not sign out other sessions', 'error') }
  }

  const others = rows.filter((r) => !r.is_current).length

  return (
    <div className={CARD}>
      <h3 className={H3}><Monitor size={15} className="text-mint-600 dark:text-mint-400" /> Active sessions</h3>
      {loading ? (
        <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-paper-400" /></div>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-pitch-800 dark:text-pitch-50 truncate">
                    {shortAgent(s.user_agent)}
                    {s.is_current && <span className="ml-2 text-2xs px-1.5 py-0.5 rounded bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200">this device</span>}
                  </div>
                  <div className="text-2xs text-paper-500 dark:text-pitch-200 truncate">
                    {s.ip_address || 'unknown IP'} · last active {fmt(s.last_seen_at)}
                  </div>
                </div>
                {!s.is_current && (
                  <button onClick={() => revoke(s.id)} className="text-xs px-2.5 py-1.5 rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          {others > 0 && (
            <button onClick={revokeOthers} className="mt-3 text-xs px-2.5 py-1.5 rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
              Sign out all other sessions
            </button>
          )}
        </>
      )}
    </div>
  )
}

function DangerZone() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  // Member self-export can be capped by the licence edition (admins always
  // export). Mirror the server gate; default open when no licence info.
  const canExport =
    user?.role === 'admin' ||
    user?.licence?.capabilities?.member_self_export_allowed !== false

  const del = async () => {
    if (!pw) return
    setBusy(true)
    try {
      await accountApi.deleteAccount(pw)
      await logout()
      navigate('/login', { replace: true })
    } catch (e) {
      toast(e.message || 'Could not delete your account.', 'error')
      setBusy(false)
    }
  }

  return (
    <div className={`${CARD} border-terracotta/40`}>
      <h3 className={H3}><AlertTriangle size={15} className="text-terracotta" /> Your data</h3>
      <div className="flex flex-wrap items-center gap-3">
        {canExport ? (
          <a href={accountApi.exportUrl}
             className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-paper-200 hover:bg-paper-300 dark:bg-pitch-600 dark:hover:bg-pitch-500 text-pitch-800 dark:text-pitch-50 transition-colors">
            <Download size={14} /> Export my data
          </a>
        ) : (
          <p className="text-sm text-paper-600 dark:text-paper-400">
            Data export is managed by your administrator on this workspace.
          </p>
        )}
        {!confirming && (
          <button onClick={() => setConfirming(true)}
                  className="px-4 py-2 text-sm font-medium rounded-md text-terracotta hover:bg-terracotta/10 transition-colors">
            Delete my account
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-4 p-4 rounded-lg bg-terracotta/5 border border-terracotta/30">
          <p className="text-sm text-paper-700 dark:text-pitch-100 mb-3">
            This permanently erases your account and data. Enter your password to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${FIELD} max-w-xs`} type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button onClick={del} disabled={busy || !pw}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-terracotta hover:opacity-90 text-white disabled:opacity-50 transition-opacity">
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button onClick={() => { setConfirming(false); setPw('') }}
                    className="px-3 py-2 text-sm rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function shortAgent(ua) {
  if (!ua) return 'Unknown device'
  // Lightweight, friendly label from the UA string.
  const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux'
    : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : ''
  return os ? `${browser} on ${os}` : browser
}

function fmt(ts) {
  if (!ts) return 'unknown'
  try { return new Date(ts).toLocaleString() } catch { return String(ts) }
}
