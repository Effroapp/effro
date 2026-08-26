import { useEffect, useState } from 'react'
import { Loader2, UserPlus, ShieldOff, Mail, ChevronDown, ChevronRight, Send } from 'lucide-react'
import { adminApi } from '../api/client'
import { useToast } from './Toast'

const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg bg-paper-100 dark:bg-pitch-700 ' +
  'border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white ' +
  'placeholder:text-paper-400 dark:placeholder:text-paper-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-mint-500'
const BTN = 'px-4 py-2 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors'
const EMPTY = { display_name: '', email: '', role: 'member' }

/**
 * Admin-only Users tab: invite teammates (by email link when SMTP is set up, or
 * with a temporary password otherwise), manage their access, and configure the
 * outbound mail server. Only mounted for an admin on an auth-enabled instance.
 */
export default function UsersSection() {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  const [smtp, setSmtp] = useState(null)            // server config view
  const [form, setForm] = useState(EMPTY)
  const [mode, setMode] = useState('password')      // 'email' | 'password'
  const [tempPw, setTempPw] = useState('')
  const [inviting, setInviting] = useState(false)

  const loadUsers = () => {
    setLoading(true)
    adminApi.listUsers()
      .then(setUsers)
      .catch((e) => toast(e.message || 'Could not load users', 'error'))
      .finally(() => setLoading(false))
  }
  const loadSmtp = () => {
    adminApi.getSmtpConfig()
      .then((c) => { setSmtp(c); setMode(c.enabled ? 'email' : 'password') })
      .catch(() => setSmtp({ enabled: false }))
  }
  useEffect(() => { loadUsers(); loadSmtp() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (e) => {
    e.preventDefault()
    if (!form.email.trim()) return
    if (mode === 'password' && !tempPw) return
    setInviting(true)
    try {
      const payload = { email: form.email.trim(), display_name: form.display_name.trim(), role: form.role }
      if (mode === 'email') payload.send_invite = true
      else payload.password = tempPw
      await adminApi.createUser(payload)
      toast(mode === 'email' ? `Invite sent to ${form.email.trim()}` : `Added ${form.email.trim()}`)
      setForm(EMPTY); setTempPw('')
      loadUsers()
    } catch (e) {
      toast(e.message || 'Could not add the user', 'error')
    } finally {
      setInviting(false)
    }
  }

  const revoke = async (u) => {
    try {
      const r = await adminApi.revokeSessions(u.id)
      toast(`Signed out ${u.email} (${r.revoked} session${r.revoked === 1 ? '' : 's'})`)
    } catch (e) { toast(e.message || 'Could not revoke sessions', 'error') }
  }
  const toggleActive = async (u) => {
    try { await adminApi.updateUser(u.id, { is_active: !u.is_active }); loadUsers() }
    catch (e) { toast(e.message || 'Could not update the user', 'error') }
  }

  const emailReady = !!smtp?.enabled

  return (
    <div className="space-y-6">
      {/* Add / invite */}
      <form onSubmit={invite} className="rounded-xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700/40 p-5">
        <h3 className="font-sans text-sm font-semibold text-pitch-800 dark:text-pitch-50 mb-3 flex items-center gap-2">
          <UserPlus size={15} className="text-mint-600 dark:text-mint-400" /> Add a teammate
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={FIELD} placeholder="Name"
                 value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <input className={FIELD} type="email" placeholder="email@company.com"
                 value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className={FIELD} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          {mode === 'password' && (
            <input className={FIELD} type="password" placeholder="Temporary password"
                   value={tempPw} onChange={(e) => setTempPw(e.target.value)} />
          )}
        </div>

        <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
          <button type="submit" disabled={inviting || !form.email.trim() || (mode === 'password' && !tempPw)} className={BTN}>
            {inviting ? 'Working…' : mode === 'email' ? 'Send invite email' : 'Add user'}
          </button>
          {/* Mode switch */}
          {mode === 'password' ? (
            <button type="button" onClick={() => emailReady ? setMode('email') : null}
                    disabled={!emailReady}
                    className="text-xs text-mint-700 dark:text-mint-300 hover:underline disabled:text-paper-400 disabled:no-underline disabled:cursor-default">
              {emailReady ? 'Email an invite link instead' : 'Set up email below to send invite links'}
            </button>
          ) : (
            <button type="button" onClick={() => setMode('password')}
                    className="text-xs text-mint-700 dark:text-mint-300 hover:underline">
              Set a temporary password instead
            </button>
          )}
        </div>
        <p className="text-2xs text-paper-500 dark:text-pitch-200 mt-2">
          {mode === 'email'
            ? 'They get an email with a link to set their own password.'
            : 'Share these details with them; they can change the password after signing in.'}
        </p>
      </form>

      {/* User list */}
      <div className="rounded-xl border border-paper-300 dark:border-pitch-600 overflow-hidden">
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 size={18} className="animate-spin text-paper-400" /></div>
        ) : users.length === 0 ? (
          <p className="p-6 text-sm text-paper-500 dark:text-paper-500">No users yet.</p>
        ) : (
          <ul className="divide-y divide-paper-200 dark:divide-pitch-600">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-pitch-800 dark:text-pitch-50 truncate">{u.display_name || u.email}</span>
                    <span className={`text-2xs px-1.5 py-0.5 rounded ${u.role === 'admin'
                      ? 'bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200'
                      : 'bg-paper-200 text-paper-600 dark:bg-pitch-600 dark:text-paper-300'}`}>{u.role}</span>
                    {!u.is_active && <span className="text-2xs px-1.5 py-0.5 rounded bg-terracotta/15 text-terracotta">inactive</span>}
                  </div>
                  <div className="text-xs text-paper-500 dark:text-pitch-200 truncate">{u.email}</div>
                </div>
                <button onClick={() => toggleActive(u)} className="text-xs px-2.5 py-1.5 rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
                  {u.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button onClick={() => revoke(u)} title="Sign out all of this user's sessions" className="text-xs px-2.5 py-1.5 rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors flex items-center gap-1">
                  <ShieldOff size={13} /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Email (SMTP) configuration */}
      <SmtpPanel smtp={smtp} onSaved={(c) => { setSmtp(c); if (c.enabled && mode === 'password') setMode('email') }} />
    </div>
  )
}

function SmtpPanel({ smtp, onSaved }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [pw, setPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (smtp) setForm({
      enabled: !!smtp.enabled, host: smtp.host || '', port: smtp.port || 587,
      username: smtp.username || '', from_address: smtp.from_address || '', use_tls: smtp.use_tls !== false,
    })
  }, [smtp])

  if (!form) return null

  const save = async () => {
    setSaving(true)
    try {
      const payload = { ...form, port: Number(form.port) || 587 }
      if (pw) payload.password = pw
      const c = await adminApi.saveSmtpConfig(payload)
      setPw('')
      onSaved(c)
      toast('Email settings saved')
    } catch (e) { toast(e.message || 'Could not save email settings', 'error') }
    finally { setSaving(false) }
  }
  const test = async () => {
    setTesting(true)
    try { const r = await adminApi.testSmtp(); toast(`Test email sent to ${r.sent_to}`) }
    catch (e) { toast(e.message || 'Test email failed', 'error') }
    finally { setTesting(false) }
  }

  return (
    <div className="rounded-xl border border-paper-300 dark:border-pitch-600">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-pitch-800 dark:text-pitch-50">
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Mail size={15} className="text-mint-600 dark:text-mint-400" /> Email (SMTP)
        <span className={`ml-auto text-2xs px-1.5 py-0.5 rounded ${smtp?.enabled
          ? 'bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200'
          : 'bg-paper-200 text-paper-600 dark:bg-pitch-600 dark:text-paper-300'}`}>
          {smtp?.enabled ? 'on' : 'off'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-2xs text-paper-500 dark:text-pitch-200">
            Your own mail server, used only to send invite and reset links. Nothing else is emailed.
          </p>
          <label className="flex items-center gap-2 text-sm text-paper-700 dark:text-pitch-100">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enable email sending
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={FIELD} placeholder="Host (smtp.example.com)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            <input className={FIELD} placeholder="Port (587)" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            <input className={FIELD} placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input className={FIELD} type="password" placeholder={smtp?.has_password ? 'Password (leave blank to keep)' : 'Password'} value={pw} onChange={(e) => setPw(e.target.value)} />
            <input className={FIELD} type="email" placeholder="From address (effro@example.com)" value={form.from_address} onChange={(e) => setForm({ ...form, from_address: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-paper-700 dark:text-pitch-100">
              <input type="checkbox" checked={form.use_tls} onChange={(e) => setForm({ ...form, use_tls: e.target.checked })} />
              Use STARTTLS (587)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className={BTN}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={test} disabled={testing || !smtp?.enabled}
                    className="px-3 py-2 text-sm rounded-md text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors flex items-center gap-1 disabled:opacity-50">
              <Send size={13} /> {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
