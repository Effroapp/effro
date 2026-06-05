import { useState, useEffect } from 'react'
import {
  X, ChevronLeft, CheckCircle2, XCircle, Loader2,
  AlertCircle, RefreshCw, Unplug, Clock
} from 'lucide-react'
import {
  saveStorageConfig, testStorageConnection, disconnectStorage,
  runManualBackup, getBackupLogs
} from '../api/storage'

/**
 * Storage setup / management modal.
 *
 * Three views chained by `view` state:
 *   pick    - provider grid (Nextcloud live; Dropbox/OneDrive/SharePoint soon)
 *   setup   - Nextcloud guide + form + Test + Save
 *   manage  - for already-connected installs: backup history, Back up now,
 *             Switch provider, Disconnect
 *
 * Colour palette matches the rest of Trace - mint signature, no accent/indigo.
 * Per-provider chips keep their natural branding (sky for Nextcloud, etc.) -
 * those are functional category badges, not brand elements.
 */

// ── Provider catalogue ────────────────────────────────────────────────────

const PROVIDERS = [
  {
    key: 'nextcloud',
    label: 'Nextcloud',
    badge: 'Self-hosted',
    badgeColor: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400',
    icon: '☁️',
    iconBg: 'bg-sky-50 dark:bg-sky-950/30',
    live: true,
    what: "Your own Nextcloud server. Files and backups stay on infrastructure you control. Best choice if you run your own homelab.",
  },
  {
    key: 'google_drive',
    label: 'Google Drive',
    badge: 'Personal',
    badgeColor: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400',
    icon: '🗂️',
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/30',
    live: true,
    what: 'Encrypted backups in your Google Drive. Reuses the Google account you connect under Integrations, no extra password needed.',
  },
  {
    key: 'dropbox',
    label: 'Dropbox',
    badge: 'Personal',
    badgeColor: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400',
    icon: '📦',
    iconBg: 'bg-indigo-50 dark:bg-indigo-950/30',
    live: false,
    comingSoonNote: 'Click Dropbox, log in, done - coming in the next update.',
  },
  {
    key: 'onedrive',
    label: 'OneDrive',
    badge: 'Personal',
    badgeColor: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
    icon: '🔷',
    iconBg: 'bg-blue-50 dark:bg-blue-950/30',
    live: false,
    comingSoonNote: 'Personal Microsoft account sync - coming soon.',
  },
  {
    key: 'sharepoint',
    label: 'SharePoint',
    badge: 'Enterprise',
    badgeColor: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
    icon: '🏢',
    iconBg: 'bg-amber-50 dark:bg-amber-950/30',
    live: false,
    comingSoonNote: "For work deployments - files stay inside your company's Microsoft tenancy.",
  },
]

// ── Main component ────────────────────────────────────────────────────────

export default function StorageSetupModal({ onClose, onSaved, currentConfig }) {
  const isConnected = currentConfig?.is_connected
  const [view, setView] = useState(isConnected ? 'manage' : 'pick')
  // Which provider the setup view is configuring.
  const [picked, setPicked] = useState(currentConfig?.provider || 'nextcloud')
  const isGoogle = picked === 'google_drive'

  // Nextcloud form state - prefilled from currentConfig if the user is editing
  const [serverUrl, setServerUrl] = useState(currentConfig?.server_url || '')
  const [username, setUsername] = useState(currentConfig?.username || '')
  const [password, setPassword] = useState('')
  const [remoteFolder, setRemoteFolder] = useState(currentConfig?.remote_folder || 'Effro')
  const [backupEnabled, setBackupEnabled] = useState(currentConfig?.backup_enabled !== false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Manage view
  const [backupLogs, setBackupLogs] = useState([])
  const [runningBackup, setRunningBackup] = useState(false)
  const [backupQueued, setBackupQueued] = useState(false)

  useEffect(() => {
    if (view === 'manage') {
      getBackupLogs().then(setBackupLogs).catch(() => {})
    }
  }, [view])

  function goToSetup(key = 'nextcloud') {
    setPicked(key)
    setTestResult(null)
    setError('')
    // Sensible default folder per provider when starting fresh.
    if (key === 'google_drive' && (!remoteFolder || remoteFolder === 'Effro')) {
      setRemoteFolder('Effro Backups')
    }
    setView('setup')
  }

  // Build the config payload for the currently-picked provider. Google Drive
  // needs no server/credentials - it reuses the Google OAuth connection.
  function configPayload() {
    if (isGoogle) {
      return {
        provider: 'google_drive',
        remote_folder: remoteFolder || 'Effro Backups',
        backup_enabled: backupEnabled,
      }
    }
    return {
      provider: 'nextcloud',
      server_url: serverUrl,
      username,
      password,
      remote_folder: remoteFolder,
      backup_enabled: backupEnabled,
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      // Test against the form values directly - do NOT save first. A failed
      // test used to corrupt the saved config which then made is_connected
      // falsely report a working link.
      const result = await testStorageConnection(configPayload())
      setTestResult(result)
    } catch (e) {
      setTestResult({ ok: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await saveStorageConfig(configPayload())
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setError('')
    try {
      await disconnectStorage()
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleManualBackup() {
    setRunningBackup(true)
    setBackupQueued(false)
    try {
      await runManualBackup()
      setBackupQueued(true)
      // Give the background task a few seconds, then refresh the log.
      setTimeout(() => {
        getBackupLogs().then(setBackupLogs).catch(() => {})
        setRunningBackup(false)
      }, 4000)
    } catch (e) {
      setError(e.message)
      setRunningBackup(false)
    }
  }

  const canTest = isGoogle
    ? true  // Google Drive reuses the OAuth connection - nothing to fill in.
    : (
      serverUrl.trim().length > 4 &&
      username.trim().length > 0 &&
      password.trim().length > 0
    )
  const canSave = testResult?.ok === true

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="
        w-full max-w-md mx-4 rounded-xl shadow-2xl overflow-hidden
        bg-white dark:bg-pitch-700
        border border-paper-200 dark:border-pitch-500
      ">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-paper-200 dark:border-pitch-500">
          <div>
            <div className="text-sm font-semibold text-pitch-800 dark:text-white">
              {view === 'pick' && 'Connect cloud storage'}
              {view === 'setup' && (isGoogle ? 'Setting up Google Drive' : 'Setting up Nextcloud')}
              {view === 'manage' && 'Storage & backups'}
            </div>
            <div className="text-xs text-paper-500 dark:text-paper-500 mt-0.5">
              {view === 'pick' && 'Attachments and encrypted backups sync to your provider'}
              {view === 'setup' && (isGoogle ? 'Reuses your Google connection' : 'Takes about 3 minutes')}
              {view === 'manage' && `Connected to ${currentConfig?.provider}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-paper-400 hover:bg-paper-100 dark:hover:bg-pitch-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── PICK view ─────────────────────────────────────────────────── */}
        {view === 'pick' && (
          <div className="p-3 space-y-1.5 max-h-[70vh] overflow-y-auto">
            {PROVIDERS.map(p => (
              <div key={p.key}>
                {p.live ? (
                  <button
                    onClick={() => goToSetup(p.key)}
                    className="
                      w-full text-left rounded-lg border-2
                      border-paper-200 dark:border-pitch-500
                      p-3 transition-all
                      hover:border-mint dark:hover:border-mint
                      hover:bg-paper-100 dark:hover:bg-pitch-600/50
                    "
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${p.iconBg}`}>
                        {p.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-pitch-800 dark:text-white">{p.label}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${p.badgeColor}`}>
                            {p.badge}
                          </span>
                        </div>
                        <div className="text-xs text-paper-500 dark:text-paper-500 mt-0.5 leading-snug">
                          {p.what?.split('.')[0]}.
                        </div>
                      </div>
                    </div>
                  </button>
                ) : (
                  // "Coming soon" - visible so the user knows what's planned,
                  // dashed border + opacity to make the non-interactive state obvious.
                  <div className="
                    rounded-lg border-2 border-dashed
                    border-paper-200 dark:border-pitch-600
                    p-3 opacity-60
                  ">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${p.iconBg}`}>
                        {p.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-pitch-700 dark:text-paper-300">{p.label}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${p.badgeColor}`}>
                            {p.badge}
                          </span>
                          <span className="
                            flex items-center gap-0.5 text-[10px] font-semibold
                            px-1.5 py-0.5 rounded-full
                            bg-paper-100 dark:bg-pitch-600
                            text-paper-500 dark:text-paper-400
                          ">
                            <Clock size={9} />
                            Soon
                          </span>
                        </div>
                        <div className="text-xs text-paper-400 dark:text-paper-600 mt-0.5 leading-snug">
                          {p.comingSoonNote}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── SETUP view (Nextcloud) ─────────────────────────────────────── */}
        {view === 'setup' && (
          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">

            <button
              onClick={() => setView('pick')}
              className="flex items-center gap-1 text-xs text-paper-500 dark:text-paper-500 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
            >
              <ChevronLeft size={13} /> All providers
            </button>

            {/* "What is this?" - same idiom as the AI Engine setup card */}
            <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
              <div className="text-[10px] font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
                What is this?
              </div>
              <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
                {isGoogle
                  ? 'Effro will store daily encrypted database backups in a folder in your Google Drive. It reuses the Google account you connect under Integrations and only touches the folder it creates, nothing else in your Drive.'
                  : 'Nextcloud is your own private cloud. Effro will store attachments and daily encrypted database backups there. Your data never leaves infrastructure you control.'}
              </div>
            </div>

            {isGoogle && currentConfig?.provider !== 'google_drive' && (
              <div className="rounded-lg p-3 bg-sky-muted/10 border border-sky-muted/30 text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
                Make sure you have connected Google under <strong>Settings → Integrations → Google Docs</strong> first. This backup option signs in with that same account.
              </div>
            )}

            {!isGoogle && (
              <>
                <div>
                  <div className="text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
                    To get your app password
                  </div>
                  <div className="space-y-2">
                    {[
                      { text: 'Log into your Nextcloud and go to ', bold: 'Settings → Security' },
                      { text: 'Scroll to App passwords. Type a name like "Effro" and click ', bold: 'Create new app password' },
                      { text: 'Copy the password - it only shows once, then paste it below' },
                    ].map((s, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <div className="w-5 h-5 rounded-full bg-mint-700 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
                          {s.text}{s.bold && <strong>{s.bold}</strong>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-paper-200 dark:border-pitch-500" />
              </>
            )}

            {(isGoogle
              ? [
                  {
                    label: 'Folder name in Google Drive',
                    value: remoteFolder,
                    set: v => { setRemoteFolder(v); setTestResult(null) },
                    type: 'text',
                    placeholder: 'Effro Backups',
                    hint: "Effro will create this folder in your Drive if it doesn't exist",
                  },
                ]
              : [
              {
                label: 'Server URL',
                value: serverUrl,
                set: v => { setServerUrl(v); setTestResult(null) },
                type: 'url',
                placeholder: 'https://nextcloud.yourdomain.com',
                hint: 'The root URL of your Nextcloud instance',
              },
              {
                label: 'Username',
                value: username,
                set: v => { setUsername(v); setTestResult(null) },
                type: 'text',
                placeholder: 'your-nextcloud-username',
                hint: '',
              },
              {
                label: 'App password',
                value: password,
                set: v => { setPassword(v); setTestResult(null) },
                type: 'password',
                placeholder: 'xxxx-xxxx-xxxx-xxxx-xxxx',
                hint: 'Not your login password - create a dedicated app password in Nextcloud Security settings',
              },
              {
                label: 'Folder name on Nextcloud',
                value: remoteFolder,
                set: v => { setRemoteFolder(v); setTestResult(null) },
                type: 'text',
                placeholder: 'Effro',
                hint: "Effro will create this folder if it doesn't exist",
              },
            ]).map(f => (
              <div key={f.label}>
                <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">
                  {f.label}
                </label>
                <input
                  type={f.type}
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  className="
                    w-full px-3 py-2 rounded-lg text-sm font-mono
                    bg-paper-100 dark:bg-pitch-800
                    border border-paper-300 dark:border-pitch-500
                    text-pitch-800 dark:text-white
                    placeholder:text-paper-400 dark:placeholder:text-paper-700
                    focus:outline-none focus:ring-2 focus:ring-mint-500
                  "
                />
                {f.hint && (
                  <div className="mt-1 text-[10px] text-paper-500 dark:text-paper-600 leading-snug">
                    {f.hint}
                  </div>
                )}
              </div>
            ))}

            {/* Daily backup toggle */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-200 dark:border-pitch-500">
              <div>
                <div className="text-xs font-medium text-pitch-700 dark:text-paper-200">Daily encrypted backup</div>
                <div className="text-[10px] text-paper-500 dark:text-paper-600 mt-0.5">Runs at 02:00 - keeps last 7 backups</div>
              </div>
              <button
                onClick={() => setBackupEnabled(v => !v)}
                className={`
                  relative w-9 h-5 rounded-full transition-colors flex-shrink-0
                  ${backupEnabled ? 'bg-mint-700' : 'bg-paper-300 dark:bg-pitch-500'}
                `}
              >
                <span className={`
                  absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform
                  ${backupEnabled ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'}
                `} />
              </button>
            </div>

            <button
              onClick={handleTest}
              disabled={testing || !canTest}
              className="
                w-full flex items-center justify-center gap-2
                px-4 py-2.5 rounded-lg text-sm font-medium
                border-2 border-mint text-mint-700 dark:text-mint-300
                hover:bg-mint-50 dark:hover:bg-mint-900/20
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors
              "
            >
              {testing
                ? <><Loader2 size={14} className="animate-spin" /> Testing…</>
                : 'Test connection'}
            </button>

            {testResult && (
              <div className={`
                flex items-start gap-2 p-3 rounded-lg text-xs leading-snug border
                ${testResult.ok
                  ? 'bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 border-mint/40'
                  : 'bg-terracotta/10 dark:bg-terracotta/15 text-terracotta border-terracotta/30'}
              `}>
                {testResult.ok
                  ? <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                  : <XCircle size={14} className="flex-shrink-0 mt-0.5" />}
                {testResult.message}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="
                w-full flex items-center justify-center gap-2
                px-4 py-2.5 rounded-lg text-sm font-semibold
                bg-mint-700 hover:bg-mint-800 text-white
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors
              "
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                : 'Save and connect'}
            </button>

            {!canSave && (
              <div className="text-center text-[10px] text-paper-500 dark:text-paper-600">
                Test the connection first to enable Save
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── MANAGE view ────────────────────────────────────────────────── */}
        {view === 'manage' && (
          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">

            <div className="flex items-center gap-2 p-3 rounded-lg bg-mint-50 dark:bg-mint-900/20 border border-mint/40">
              <CheckCircle2 size={14} className="text-mint-700 dark:text-mint-300 flex-shrink-0" />
              <div className="text-xs text-mint-700 dark:text-mint-300 leading-snug">
                <strong>{currentConfig?.provider === 'google_drive' ? 'Google Drive connected' : 'Nextcloud connected'}</strong>
                {currentConfig?.provider === 'google_drive'
                  ? <span className="opacity-80"> - folder "{currentConfig?.remote_folder || 'Effro Backups'}"</span>
                  : currentConfig?.server_url && <span className="opacity-80"> - {currentConfig.server_url}</span>}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
                Database backups
              </div>
              <div className="text-xs text-paper-500 dark:text-paper-600 leading-relaxed mb-3">
                Daily encrypted snapshots stored in{' '}
                <code className="text-[11px] bg-paper-100 dark:bg-pitch-800 px-1 py-0.5 rounded font-mono">
                  {currentConfig?.provider === 'google_drive'
                    ? `${currentConfig?.remote_folder || 'Effro Backups'}/`
                    : `${currentConfig?.remote_folder || 'Effro'}/backups/`}
                </code>{' '}
                on your {currentConfig?.provider === 'google_drive' ? 'Google Drive' : 'Nextcloud'}. Last 7 kept.
              </div>

              {backupLogs.length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {backupLogs.slice(0, 3).map(entry => (
                    <div
                      key={entry.id}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg text-xs border
                        ${entry.status === 'success'
                          ? 'bg-mint-50 dark:bg-mint-900/20 border-mint/30 text-mint-700 dark:text-mint-300'
                          : 'bg-terracotta/10 dark:bg-terracotta/15 border-terracotta/30 text-terracotta'}
                      `}
                    >
                      {entry.status === 'success'
                        ? <CheckCircle2 size={11} className="flex-shrink-0" />
                        : <XCircle size={11} className="flex-shrink-0" />}
                      <span className="flex-1">
                        {new Date(entry.occurred_at).toLocaleDateString()}{' '}
                        {new Date(entry.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {entry.size_bytes && (
                        <span className="text-[10px] opacity-60">
                          {(entry.size_bytes / 1024).toFixed(0)} KB
                        </span>
                      )}
                      {entry.error_message && (
                        <span className="text-[10px] truncate max-w-[120px]" title={entry.error_message}>
                          {entry.error_message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-paper-400 dark:text-paper-600 mb-3">
                  No backups yet - first backup runs tonight at 02:00, or trigger one now.
                </div>
              )}

              {backupQueued && (
                <div className="mb-2 flex items-center gap-2 p-2.5 rounded-lg bg-mint-50 dark:bg-mint-900/20 border border-mint/40 text-xs text-mint-700 dark:text-mint-300">
                  <CheckCircle2 size={12} />
                  Backup queued - log will update in a few seconds
                </div>
              )}

              <button
                onClick={handleManualBackup}
                disabled={runningBackup}
                className="
                  w-full flex items-center justify-center gap-2
                  px-4 py-2 rounded-lg text-xs font-medium
                  border border-paper-300 dark:border-pitch-500
                  text-paper-700 dark:text-paper-300
                  hover:bg-paper-100 dark:hover:bg-pitch-600
                  disabled:opacity-40 transition-colors
                "
              >
                {runningBackup
                  ? <><Loader2 size={12} className="animate-spin" /> Backing up…</>
                  : <><RefreshCw size={12} /> Back up now</>}
              </button>
            </div>

            <div className="border-t border-paper-200 dark:border-pitch-500" />

            <div className="space-y-2">
              <button
                onClick={() => setView('pick')}
                className="
                  w-full px-4 py-2 rounded-lg text-xs
                  border border-paper-300 dark:border-pitch-500
                  text-paper-700 dark:text-paper-300
                  hover:bg-paper-100 dark:hover:bg-pitch-600 transition-colors
                "
              >
                Switch provider
              </button>
              <button
                onClick={handleDisconnect}
                className="
                  w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs
                  border border-terracotta/30
                  text-terracotta
                  hover:bg-terracotta/10 transition-colors
                "
              >
                <Unplug size={12} /> Disconnect
              </button>
              <div className="text-[10px] text-paper-500 dark:text-paper-600 text-center leading-snug">
                Disconnecting stops future syncs. Files already uploaded are not deleted.
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
