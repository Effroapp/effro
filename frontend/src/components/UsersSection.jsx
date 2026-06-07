import { useEffect, useState } from 'react'
import { Loader2, UserPlus, ShieldOff } from 'lucide-react'
import { adminApi } from '../api/client'
import { useToast } from './Toast'

const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg bg-paper-100 dark:bg-pitch-700 ' +
  'border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white ' +
  'placeholder:text-paper-400 dark:placeholder:text-paper-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-mint-500'

const EMPTY = { display_name: '', email: '', role: 'member', password: '' }

/**
 * Admin-only Users tab in Settings. Lists the people on this instance and lets
 * an admin invite a teammate, revoke their sessions, or deactivate them. Only
 * mounted when auth is enabled and the current user is an admin (see
 * SystemSettings).
 */
export default function UsersSection() {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [inviting, setInviting] = useState(false)

  const load = () => {
    setLoading(true)
    adminApi.listUsers()
      .then(setUsers)
      .catch((e) => toast(e.message || 'Could not load users', 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (e) => {
    e.preventDefault()
    if (!form.email.trim() || !form.password) return
    setInviting(true)
    try {
      await adminApi.createUser({
        email: form.email.trim(),
        display_name: form.display_name.trim(),
        role: form.role,
        password: form.password,
      })
      toast(`Added ${form.email.trim()}`)
      setForm(EMPTY)
      load()
    } catch (e) {
      toast(e.message || 'Could not add user', 'error')
    } finally {
      setInviting(false)
    }
  }

  const revoke = async (u) => {
    try {
      const r = await adminApi.revokeSessions(u.id)
      toast(`Signed out ${u.email} (${r.revoked} session${r.revoked === 1 ? '' : 's'})`)
    } catch (e) {
      toast(e.message || 'Could not revoke sessions', 'error')
    }
  }

  const toggleActive = async (u) => {
    try {
      await adminApi.updateUser(u.id, { is_active: !u.is_active })
      load()
    } catch (e) {
      toast(e.message || 'Could not update user', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      <form
        onSubmit={invite}
        className="rounded-xl border border-paper-300 dark:border-pitch-600 bg-paper-50 dark:bg-pitch-700/40 p-5"
      >
        <h3 className="font-display text-sm font-semibold text-pitch-800 dark:text-pitch-50 mb-3 flex items-center gap-2">
          <UserPlus size={15} className="text-mint-600 dark:text-mint-400" /> Invite a teammate
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={FIELD} placeholder="Name"
                 value={form.display_name}
                 onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <input className={FIELD} type="email" placeholder="email@company.com"
                 value={form.email}
                 onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className={FIELD} value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <input className={FIELD} type="password" placeholder="Temporary password"
                 value={form.password}
                 onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <p className="text-2xs text-paper-500 dark:text-pitch-200 mt-2">
          They can change this from their account after signing in.
        </p>
        <div className="mt-3">
          <button type="submit" disabled={inviting || !form.email.trim() || !form.password}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors">
            {inviting ? 'Adding…' : 'Add user'}
          </button>
        </div>
      </form>

      {/* List */}
      <div className="rounded-xl border border-paper-300 dark:border-pitch-600 overflow-hidden">
        {loading ? (
          <div className="p-6 flex justify-center">
            <Loader2 size={18} className="animate-spin text-paper-400" />
          </div>
        ) : users.length === 0 ? (
          <p className="p-6 text-sm text-paper-500 dark:text-paper-500">No users yet.</p>
        ) : (
          <ul className="divide-y divide-paper-200 dark:divide-pitch-600">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-pitch-800 dark:text-pitch-50 truncate">
                      {u.display_name || u.email}
                    </span>
                    <span className={`text-2xs px-1.5 py-0.5 rounded ${
                      u.role === 'admin'
                        ? 'bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200'
                        : 'bg-paper-200 text-paper-600 dark:bg-pitch-600 dark:text-paper-300'
                    }`}>{u.role}</span>
                    {!u.is_active && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-terracotta/15 text-terracotta">
                        inactive
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-paper-500 dark:text-pitch-200 truncate">{u.email}</div>
                </div>
                <button onClick={() => toggleActive(u)}
                        className="text-xs px-2.5 py-1.5 rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
                  {u.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button onClick={() => revoke(u)} title="Sign out all of this user's sessions"
                        className="text-xs px-2.5 py-1.5 rounded-md text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors flex items-center gap-1">
                  <ShieldOff size={13} /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
