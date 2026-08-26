import { useState, useEffect, useCallback } from 'react'
import { Check, Plus, X, ChevronLeft } from 'lucide-react'
import ProviderLogo from './ProviderLogos'
import ConnectorPolicySection from './ConnectorPolicySection'
import { useAuth } from '../contexts/AuthContext'
import { openExternal } from '../api/tauri'

import MicrosoftIntegration from './MicrosoftIntegration'
import JiraIntegration from './JiraIntegration'
import GoogleIntegration from './GoogleIntegration'
import IcloudIntegration from './IcloudIntegration'
import GithubIntegration from './GithubIntegration'
import TelegramIntegration from './TelegramIntegration'
import MailIntegration from './MailIntegration'

import { getMicrosoftProfile } from '../api/microsoft'
import { getJiraProfile } from '../api/jira'
import { getGoogleProfile } from '../api/google'
import { getIcloudProfile } from '../api/icloud'
import { getGithubProfile } from '../api/github'
import { getTelegramProfile } from '../api/telegram'
import { getMailProfile } from '../api/mail'

/**
 * Integrations tab body, modelled on the Storage flow: a row of every option,
 * a "Connected" list with Manage, and an Add button that opens a picker. Each
 * integration's existing setup component is hosted inside the modal, so this is
 * pure orchestration - no duplicated setup logic.
 */
const INTEGRATIONS = [
  { key: 'jira',      logo: 'jira',      name: 'Jira',          tagline: 'Issues, mentions, sprint',      Component: JiraIntegration,      getProfile: getJiraProfile,      status: (p) => p.cloud_name || p.email || p.display_name },
  { key: 'google',    logo: 'google',    name: 'Google',        tagline: 'Calendar + Gmail',              Component: GoogleIntegration,    getProfile: getGoogleProfile,    status: (p) => p.email },
  { key: 'icloud',    logo: 'icloud',    name: 'iCloud',        tagline: 'Calendar + Apple Mail',         Component: IcloudIntegration,    getProfile: getIcloudProfile,    status: (p) => p.apple_id },
  { key: 'github',    logo: 'github',    name: 'GitHub',        tagline: 'Reviews, assigned, mentions',   Component: GithubIntegration,    getProfile: getGithubProfile,    status: (p) => (p.login ? `@${p.login}` : null) },
  { key: 'microsoft', logo: 'microsoft', name: 'Microsoft 365', tagline: 'Outlook calendar',              Component: MicrosoftIntegration, getProfile: getMicrosoftProfile, status: (p) => p.email },
  { key: 'telegram',  logo: 'telegram',  name: 'Telegram',      tagline: 'Messages to your personal bot', Component: TelegramIntegration,  getProfile: getTelegramProfile,  status: (p) => (p.bot_username ? `@${p.bot_username}` : null) },
  { key: 'mail',      logo: 'mail',      name: 'Email (IMAP)',  tagline: 'Flagged mail from any mailbox', Component: MailIntegration,      getProfile: getMailProfile,      status: (p) => p.username },
]

export default function IntegrationsPanel() {
  const { user, refresh: refreshAuth } = useAuth()
  const [conn, setConn] = useState({})           // key -> { connected, status }
  const [modalKey, setModalKey] = useState(undefined)  // undefined=closed, null=picker, '<key>'=that integration

  // The workspace's connector policy (from /auth/me): a connector absent from
  // the map (or no map at all - the desktop build) is available.
  const policy = user?.connectors
  const available = INTEGRATIONS.filter((i) => !policy || policy[i.key] !== false)
  const hiddenCount = INTEGRATIONS.length - available.length
  const showPolicy = user?.role === 'admin' && !!user?.licence?.licence_required

  const refresh = useCallback(() => {
    available.forEach((i) => {
      i.getProfile()
        .then((p) => setConn((c) => ({ ...c, [i.key]: { connected: Boolean(p?.connected), status: p?.connected ? i.status(p) : null } })))
        .catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
  useEffect(() => { refresh() }, [refresh])

  const closeModal = () => { setModalKey(undefined); refresh() }
  const connected = available.filter((i) => conn[i.key]?.connected)

  return (
    <div className="space-y-5">
      {/* Admin: which connections this workspace offers (licensed instances only) */}
      {showPolicy && <ConnectorPolicySection onChanged={refreshAuth} />}

      {/* All options - icon row */}
      <div>
        <div className="eyebrow text-paper-500 dark:text-paper-600 mb-2">All integrations</div>
        <div className="flex flex-wrap gap-2">
          {available.map((i) => {
            const on = conn[i.key]?.connected
            return (
              <button
                key={i.key}
                onClick={() => setModalKey(i.key)}
                title={i.name}
                className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                  on
                    ? 'border-mint/50 bg-mint/5'
                    : 'border-paper-300 dark:border-pitch-500 bg-paper-100 dark:bg-pitch-800 hover:border-mint dark:hover:border-mint hover:-translate-y-0.5'
                }`}
              >
                <ProviderLogo provider={i.logo} size={18} />
                <span className="text-sm text-pitch-700 dark:text-paper-200">{i.name}</span>
                {on && <Check size={12} strokeWidth={3} className="text-mint-600 dark:text-mint-400" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Connected list */}
      <div className="rounded-xl border border-paper-300 dark:border-pitch-500 bg-white dark:bg-pitch-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow text-paper-500 dark:text-paper-600">Connected</div>
          <button
            onClick={() => setModalKey(null)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-mint-700 hover:bg-mint-800 text-white transition-colors"
          >
            <Plus size={13} /> Add
          </button>
        </div>

        {connected.length === 0 ? (
          <p className="text-sm text-paper-500 dark:text-paper-600">
            Nothing connected yet. Add one and its meetings, emails and issues start flowing into Signals.
          </p>
        ) : (
          <ul className="-my-1">
            {connected.map((i, idx) => (
              <li key={i.key} className={`flex items-center gap-3 py-2.5 ${idx > 0 ? 'border-t border-paper-200 dark:border-pitch-600' : ''}`}>
                <ProviderLogo provider={i.logo} size={18} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-pitch-800 dark:text-white truncate">{i.name}</p>
                  <p className="text-2xs text-paper-500 dark:text-paper-600 truncate">{conn[i.key]?.status || i.tagline}</p>
                </div>
                <button
                  onClick={() => setModalKey(i.key)}
                  className="px-3 py-1.5 rounded-md text-xs text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 font-sans font-medium uppercase tracking-wide transition-colors"
                >
                  Manage
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hiddenCount > 0 && !showPolicy && (
        <p className="text-2xs text-paper-500 dark:text-paper-600 text-center">
          Some connections are managed by your administrator.
        </p>
      )}

      <p className="text-2xs text-paper-500 dark:text-paper-600 text-center">
        Missing one you use?{' '}
        <a
          href="https://github.com/Effroapp/effro/issues/new"
          onClick={(e) => { e.preventDefault(); openExternal('https://github.com/Effroapp/effro/issues/new') }}
          className="text-mint-700 dark:text-mint-300 font-medium hover:underline cursor-pointer"
        >
          Suggest an integration
        </a>.
      </p>

      {modalKey !== undefined && <IntegrationModal items={available} initialKey={modalKey} onClose={closeModal} />}
    </div>
  )
}

function IntegrationModal({ items, initialKey, onClose }) {
  const [key, setKey] = useState(initialKey)  // null => picker grid
  const item = items.find((i) => i.key === key)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-pitch-900/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-[88vh] flex flex-col rounded-2xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-paper-200 dark:border-pitch-600">
          {key !== null && (
            <button onClick={() => setKey(null)} aria-label="All integrations" className="p-1 -ml-1 rounded text-paper-400 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors">
              <ChevronLeft size={16} />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {item && <ProviderLogo provider={item.logo} size={18} />}
            <span className="text-sm font-semibold text-pitch-800 dark:text-white truncate">
              {item ? item.name : 'Add an integration'}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded text-paper-400 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {key === null ? (
            <div className="space-y-1.5">
              {items.map((i) => (
                <button
                  key={i.key}
                  onClick={() => setKey(i.key)}
                  className="w-full text-left rounded-lg border-2 border-paper-200 dark:border-pitch-500 p-3 transition-all hover:border-mint dark:hover:border-mint hover:bg-paper-100 dark:hover:bg-pitch-600/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-paper-100 dark:bg-pitch-800 flex items-center justify-center flex-shrink-0">
                      <ProviderLogo provider={i.logo} size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-pitch-800 dark:text-white">{i.name}</div>
                      <div className="text-xs text-paper-500 dark:text-paper-600">{i.tagline}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            item && <item.Component />
          )}
        </div>
      </div>
    </div>
  )
}
