import { useState, useEffect } from 'react'
import {
  X, ChevronLeft, CheckCircle2, XCircle, Loader2,
  AlertCircle, RefreshCw, Unplug, Clock
} from 'lucide-react'
import {
  saveStorageConfig, testStorageConnection, disconnectStorage,
  runManualBackup, getBackupLogs
} from '../api/storage'
import { getGoogleProfile } from '../api/google'
import { getDropboxConfig, getDropboxProfile, saveDropboxConfig, loginUrl as dropboxLoginUrl } from '../api/dropbox'
import SetupGuide, { DROPBOX_GUIDE } from './SetupGuide'
import ProviderLogo from './ProviderLogos'

/**
 * Storage setup / management modal.
 *
 * Three views chained by `view` state:
 *   pick    - provider grid (Nextcloud live; Dropbox/OneDrive/SharePoint soon)
 *   setup   - Nextcloud guide + form + Test + Save
 *   manage  - for already-connected installs: backup history, Back up now,
 *             Switch provider, Disconnect
 *
 * Colour palette matches the rest of Effro - mint signature, no accent/indigo.
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
    live: true,
    what: 'Encrypted backups in your Dropbox. Connect once with your own Dropbox app; with App-folder access Effro only sees its own folder.',
  },
  {
    key: 's3',
    label: 'S3-compatible',
    badge: 'Object storage',
    badgeColor: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400',
    icon: '🪣',
    iconBg: 'bg-orange-50 dark:bg-orange-950/30',
    live: true,
    what: 'Any S3-compatible bucket: Backblaze B2, Wasabi, Cloudflare R2, MinIO, DigitalOcean Spaces, AWS S3. Access key + secret, no OAuth.',
  },
  {
    key: 'webdav',
    label: 'WebDAV',
    badge: 'Self-hosted',
    badgeColor: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400',
    icon: '🗄️',
    iconBg: 'bg-sky-50 dark:bg-sky-950/30',
    live: true,
    what: 'Any WebDAV server: Synology NAS, ownCloud, Box, and most NAS boxes. Server URL, username and password.',
  },
  {
    key: 'onedrive',
    label: 'OneDrive',
    badge: 'Personal',
    badgeColor: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
    icon: '🔷',
    iconBg: 'bg-blue-50 dark:bg-blue-950/30',
    live: false,
    comingSoonNote: 'Arrives with the Microsoft 365 integration.',
  },
  {
    key: 'sharepoint',
    label: 'SharePoint',
    badge: 'Enterprise',
    badgeColor: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
    icon: '🏢',
    iconBg: 'bg-amber-50 dark:bg-amber-950/30',
    live: false,
    comingSoonNote: 'Arrives with the Microsoft 365 integration.',
  },
]

const PROVIDER_LABEL = {
  nextcloud: 'Nextcloud',
  google_drive: 'Google Drive',
  dropbox: 'Dropbox',
  webdav: 'WebDAV',
  s3: 'S3-compatible',
}

// ── Main component ────────────────────────────────────────────────────────

export default function StorageSetupModal({ onClose, onSaved, currentConfig, initialProvider }) {
  const isConnected = currentConfig?.is_connected
  // initialProvider (e.g. after a Dropbox OAuth redirect) jumps straight to that
  // provider's setup view, even if no storage config is saved yet.
  const [view, setView] = useState(initialProvider ? 'setup' : (isConnected ? 'manage' : 'pick'))
  // Which provider the setup view is configuring.
  const [picked, setPicked] = useState(initialProvider || currentConfig?.provider || 'nextcloud')
  const isGoogle = picked === 'google_drive'
  const isDropbox = picked === 'dropbox'
  const isWebdav = picked === 'webdav'
  const isS3 = picked === 's3'

  // Nextcloud form state - prefilled from currentConfig if the user is editing
  const [serverUrl, setServerUrl] = useState(currentConfig?.server_url || '')
  const [username, setUsername] = useState(currentConfig?.username || '')
  const [password, setPassword] = useState('')
  const [remoteFolder, setRemoteFolder] = useState(
    currentConfig?.remote_folder || ((initialProvider === 'dropbox' || initialProvider === 'google_drive') ? 'Effro Backups' : 'Effro')
  )
  // S3 extras (endpoint=serverUrl, access key=username, secret=password).
  const [bucket, setBucket] = useState(currentConfig?.bucket || '')
  const [region, setRegion] = useState(currentConfig?.region || '')
  const [backupEnabled, setBackupEnabled] = useState(currentConfig?.backup_enabled !== false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Is the Google account connected (under Integrations)? null = still checking.
  // Google Drive backups reuse that connection, so the setup is gated on it.
  const [googleConnected, setGoogleConnected] = useState(null)
  useEffect(() => {
    if (view === 'setup' && isGoogle) {
      setGoogleConnected(null)
      getGoogleProfile()
        .then((p) => setGoogleConnected(Boolean(p?.connected)))
        .catch(() => setGoogleConnected(false))
    }
  }, [view, isGoogle])
  const googleReady = !isGoogle || googleConnected === true

  // Dropbox: storage-only OAuth, configured + connected inside this flow.
  const [dropboxConfig, setDropboxConfig] = useState(null)
  const [dropboxConnected, setDropboxConnected] = useState(null)
  const loadDropbox = () => {
    Promise.all([getDropboxConfig().catch(() => null), getDropboxProfile().catch(() => null)])
      .then(([cfg, prof]) => { setDropboxConfig(cfg); setDropboxConnected(Boolean(prof?.connected)) })
  }
  useEffect(() => {
    if (view === 'setup' && isDropbox) {
      setDropboxConnected(null)
      loadDropbox()
    }
  }, [view, isDropbox])
  const dropboxReady = !isDropbox || dropboxConnected === true
  const dropboxNeedsSetup = isDropbox && dropboxConnected === false

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
    if ((key === 'google_drive' || key === 'dropbox' || key === 's3') && (!remoteFolder || remoteFolder === 'Effro')) {
      setRemoteFolder('Effro Backups')
    }
    setView('setup')
  }

  // Build the config payload for the currently-picked provider. Google Drive
  // needs no server/credentials - it reuses the Google OAuth connection.
  function configPayload() {
    if (isGoogle || isDropbox) {
      return {
        provider: isDropbox ? 'dropbox' : 'google_drive',
        remote_folder: remoteFolder || 'Effro Backups',
        backup_enabled: backupEnabled,
      }
    }
    if (isS3) {
      return {
        provider: 's3',
        server_url: serverUrl,   // endpoint
        username,                // access key
        password,                // secret key
        bucket,
        region: region || 'us-east-1',
        remote_folder: remoteFolder || 'Effro Backups',
        backup_enabled: backupEnabled,
      }
    }
    // nextcloud or generic webdav (same shape)
    return {
      provider: isWebdav ? 'webdav' : 'nextcloud',
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
    ? googleReady  // Google Drive reuses the OAuth connection; gate on it.
    : isDropbox
      ? dropboxReady  // Dropbox must be connected (handled before this step)
      : isS3
        ? (serverUrl.trim().length > 4 && bucket.trim().length > 0 &&
           username.trim().length > 0 && password.trim().length > 0)
        : (
          serverUrl.trim().length > 4 &&
          username.trim().length > 0 &&
          password.trim().length > 0
        )
  const canSave = testResult?.ok === true

  // The input fields shown in the setup form, per provider.
  const clearResult = (setter) => (v) => { setter(v); setTestResult(null) }
  const folderField = (label, hint) => ({
    label, value: remoteFolder, set: clearResult(setRemoteFolder), type: 'text',
    placeholder: 'Effro Backups', hint,
  })
  let fields
  if (isGoogle) {
    fields = [folderField('Folder name in Google Drive', "Effro will create this folder in your Drive if it doesn't exist")]
  } else if (isDropbox) {
    fields = [folderField('Folder name in Dropbox', "Effro will create this folder in your Dropbox if it doesn't exist")]
  } else if (isS3) {
    fields = [
      { label: 'Endpoint URL', value: serverUrl, set: clearResult(setServerUrl), type: 'url',
        placeholder: 'https://s3.us-west-002.backblazeb2.com', hint: 'Your provider’s S3 endpoint (B2, Wasabi, R2, MinIO, Spaces, AWS).' },
      { label: 'Region', value: region, set: clearResult(setRegion), type: 'text',
        placeholder: 'us-east-1', hint: 'The bucket’s region (use "auto" for Cloudflare R2).' },
      { label: 'Bucket', value: bucket, set: clearResult(setBucket), type: 'text',
        placeholder: 'my-effro-backups', hint: 'An existing bucket Effro can write to.' },
      { label: 'Access key', value: username, set: clearResult(setUsername), type: 'text',
        placeholder: 'AKIA… / key id', hint: '' },
      { label: 'Secret key', value: password, set: clearResult(setPassword), type: 'password',
        placeholder: 'Paste the secret key', hint: 'Stored Fernet-encrypted.' },
      folderField('Folder (key prefix)', 'Backups are stored under this prefix in the bucket.'),
    ]
  } else if (isWebdav) {
    fields = [
      { label: 'WebDAV URL', value: serverUrl, set: clearResult(setServerUrl), type: 'url',
        placeholder: 'https://nas.local/dav', hint: 'The full WebDAV collection URL.' },
      { label: 'Username', value: username, set: clearResult(setUsername), type: 'text', placeholder: 'username', hint: '' },
      { label: 'Password', value: password, set: clearResult(setPassword), type: 'password',
        placeholder: 'password', hint: 'Stored Fernet-encrypted.' },
      folderField('Folder name', "Effro will create this folder if it doesn't exist"),
    ]
  } else {
    fields = [
      { label: 'Server URL', value: serverUrl, set: clearResult(setServerUrl), type: 'url',
        placeholder: 'https://nextcloud.yourdomain.com', hint: 'The root URL of your Nextcloud instance' },
      { label: 'Username', value: username, set: clearResult(setUsername), type: 'text', placeholder: 'your-nextcloud-username', hint: '' },
      { label: 'App password', value: password, set: clearResult(setPassword), type: 'password',
        placeholder: 'xxxx-xxxx-xxxx-xxxx-xxxx', hint: 'Not your login password - create a dedicated app password in Nextcloud Security settings' },
      folderField('Folder name on Nextcloud', "Effro will create this folder if it doesn't exist"),
    ]
  }

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
              {view === 'setup' && `Setting up ${PROVIDER_LABEL[picked] || 'storage'}`}
              {view === 'manage' && 'Storage & backups'}
            </div>
            <div className="text-xs text-paper-500 dark:text-paper-500 mt-0.5">
              {view === 'pick' && 'Attachments and encrypted backups sync to your provider'}
              {view === 'setup' && (isGoogle ? 'Reuses your Google connection' : isDropbox ? 'Connect your Dropbox app' : 'Takes about 3 minutes')}
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
                        <ProviderLogo provider={p.key} size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-pitch-800 dark:text-white">{p.label}</span>
                          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${p.badgeColor}`}>
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
                        <ProviderLogo provider={p.key} size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-pitch-700 dark:text-paper-300">{p.label}</span>
                          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${p.badgeColor}`}>
                            {p.badge}
                          </span>
                          <span className="
                            flex items-center gap-0.5 text-2xs font-semibold
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

            {/* Google Drive is gated on the Google connection. Surface its state
                first - a blocking warning until Google is connected, since
                everything below depends on it. */}
            {isGoogle && googleConnected === null && (
              <div className="flex items-center gap-2 rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border border-paper-200 dark:border-pitch-600 text-xs text-paper-500 dark:text-paper-600">
                <Loader2 size={13} className="animate-spin" /> Checking your Google connection…
              </div>
            )}
            {isGoogle && googleConnected === false && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-mustard/10 border border-mustard/40 text-xs text-pitch-700 dark:text-paper-200 leading-relaxed">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-mustard" />
                <span>
                  Connect Google first under <strong>Settings → Integrations → Google</strong>.
                  Google Drive backups sign in with that same account, so there is nothing to set up here until it is connected.
                </span>
              </div>
            )}

            {/* "What is this?" - same idiom as the AI Engine setup card */}
            <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
              <div className="text-2xs font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
                What is this?
              </div>
              <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
                {isGoogle
                  ? 'Effro will store daily encrypted database backups in a folder in your Google Drive. It reuses the Google account you connect under Integrations and only touches the folder it creates, nothing else in your Drive.'
                  : isDropbox
                    ? 'Effro will store daily encrypted database backups in a folder in your Dropbox. With App-folder access it only ever touches its own folder, nothing else in your Dropbox.'
                    : isS3
                      ? 'Effro will store daily encrypted database backups in an S3-compatible bucket (Backblaze B2, Wasabi, Cloudflare R2, MinIO, DigitalOcean Spaces, AWS S3). Paste the endpoint, bucket and an access key/secret.'
                      : isWebdav
                        ? 'Effro will store daily encrypted database backups on any WebDAV server (Synology, ownCloud, a NAS). Paste the WebDAV URL plus your username and password.'
                        : 'Nextcloud is your own private cloud. Effro will store attachments and daily encrypted database backups there. Your data never leaves infrastructure you control.'}
              </div>
            </div>

            {/* Dropbox: configure the app + OAuth connect, all here. Until it's
                connected we show this instead of the folder/test/save below. */}
            {isDropbox && dropboxConnected === null && (
              <div className="flex items-center gap-2 rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border border-paper-200 dark:border-pitch-600 text-xs text-paper-500 dark:text-paper-600">
                <Loader2 size={13} className="animate-spin" /> Checking your Dropbox connection…
              </div>
            )}
            {dropboxNeedsSetup && (
              <DropboxConnect
                config={dropboxConfig}
                onSavedConfig={loadDropbox}
                onConnect={() => { window.location.href = dropboxLoginUrl() }}
              />
            )}

            {picked === 'nextcloud' && (
              <>
                <div>
                  <div className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
                    To get your app password
                  </div>
                  <div className="space-y-2">
                    {[
                      { text: 'Log into your Nextcloud and go to ', bold: 'Settings → Security' },
                      { text: 'Scroll to App passwords. Type a name like "Effro" and click ', bold: 'Create new app password' },
                      { text: 'Copy the password - it only shows once, then paste it below' },
                    ].map((s, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <div className="w-5 h-5 rounded-full bg-mint-700 text-white text-2xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
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

            {dropboxReady && (
            <>
            {fields.map(f => (
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
                  disabled={!googleReady}
                  className="
                    w-full px-3 py-2 rounded-lg text-sm font-mono
                    bg-paper-100 dark:bg-pitch-800
                    border border-paper-300 dark:border-pitch-500
                    text-pitch-800 dark:text-white
                    placeholder:text-paper-400 dark:placeholder:text-paper-700
                    focus:outline-none focus:ring-2 focus:ring-mint-500
                    disabled:opacity-40 disabled:cursor-not-allowed
                  "
                />
                {f.hint && (
                  <div className="mt-1 text-2xs text-paper-500 dark:text-paper-600 leading-snug">
                    {f.hint}
                  </div>
                )}
              </div>
            ))}

            {/* Daily backup toggle */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-200 dark:border-pitch-500">
              <div>
                <div className="text-xs font-medium text-pitch-700 dark:text-paper-200">Daily encrypted backup</div>
                <div className="text-2xs text-paper-500 dark:text-paper-600 mt-0.5">Runs at 02:00 - keeps last 7 backups</div>
              </div>
              <button
                onClick={() => setBackupEnabled(v => !v)}
                disabled={!googleReady}
                className={`
                  relative w-9 h-5 rounded-full transition-colors flex-shrink-0
                  disabled:opacity-40 disabled:cursor-not-allowed
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
              <div className="text-center text-2xs text-paper-500 dark:text-paper-600">
                Test the connection first to enable Save
              </div>
            )}
            </>
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
                <strong>{PROVIDER_LABEL[currentConfig?.provider] || 'Cloud'} connected</strong>
                {currentConfig?.provider === 'nextcloud'
                  ? (currentConfig?.server_url && <span className="opacity-80"> - {currentConfig.server_url}</span>)
                  : <span className="opacity-80"> - folder "{currentConfig?.remote_folder || 'Effro Backups'}"</span>}
              </div>
            </div>

            <div>
              <div className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
                Database backups
              </div>
              <div className="text-xs text-paper-500 dark:text-paper-600 leading-relaxed mb-3">
                Daily encrypted snapshots stored in{' '}
                <code className="text-2xs bg-paper-100 dark:bg-pitch-800 px-1 py-0.5 rounded font-mono">
                  {currentConfig?.provider === 'nextcloud'
                    ? `${currentConfig?.remote_folder || 'Effro'}/backups/`
                    : `${currentConfig?.remote_folder || 'Effro Backups'}/`}
                </code>{' '}
                on your {PROVIDER_LABEL[currentConfig?.provider] || 'cloud'}. Last 7 kept.
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
                        <span className="text-2xs opacity-60">
                          {(entry.size_bytes / 1024).toFixed(0)} KB
                        </span>
                      )}
                      {entry.error_message && (
                        <span className="text-2xs truncate max-w-[120px]" title={entry.error_message}>
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
              <div className="text-2xs text-paper-500 dark:text-paper-600 text-center leading-snug">
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

// ── Dropbox connect step (config app creds, then OAuth) ─────────────────────
// Shown inside the Storage flow until Dropbox is connected. Unlike Google
// (connected under Integrations), Dropbox is storage-only, so its app config +
// sign-in happen right here.
function DropboxConnect({ config, onSavedConfig, onConnect }) {
  const [appKey, setAppKey] = useState(config?.app_key || '')
  const [appSecret, setAppSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')

  const save = async (e) => {
    e?.preventDefault()
    if (!appKey.trim() || !appSecret.trim()) return
    setSaving(true); setErr('')
    try {
      await saveDropboxConfig({ app_key: appKey, app_secret: appSecret })
      setEditing(false)
      onSavedConfig()
    } catch (e2) { setErr(e2.message) } finally { setSaving(false) }
  }

  if (config === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper-500 dark:text-paper-600 italic">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }

  // Configured already -> just need the OAuth sign-in.
  if (config.is_configured && !editing) {
    return (
      <div className="space-y-3">
        <SetupGuide guide={DROPBOX_GUIDE} open={showGuide} onClose={() => setShowGuide(false)} />
        <div className="rounded-lg p-3 bg-sky-muted/10 border border-sky-muted/30 text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          App credentials saved. Sign in to your Dropbox to finish connecting.
        </div>
        <button
          onClick={onConnect}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white transition-colors"
        >
          Connect Dropbox
        </button>
        <button
          onClick={() => { setAppSecret(''); setEditing(true) }}
          className="w-full text-center text-xs text-paper-500 hover:text-paper-700 dark:hover:text-paper-300 transition-colors"
        >
          Edit app credentials
        </button>
      </div>
    )
  }

  // Need app key + secret first.
  return (
    <form onSubmit={save} className="space-y-3">
      <SetupGuide guide={DROPBOX_GUIDE} open={showGuide} onClose={() => setShowGuide(false)} />
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          You need a free Dropbox app (about 5 minutes). Follow the guide, then paste the
          App key and App secret below. The secret is encrypted before it touches disk.
        </div>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 text-mint-700 dark:text-mint-300 hover:border-mint/50 transition-colors"
        >
          Open setup guide
        </button>
      </div>

      <div>
        <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">App key</label>
        <input
          value={appKey}
          onChange={(e) => setAppKey(e.target.value)}
          placeholder="abcd1234efgh567"
          autoComplete="off"
          className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">App secret</label>
        <input
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder={config?.app_secret_masked || 'Paste the app secret'}
          autoComplete="off"
          className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
        />
      </div>

      {err && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={saving || !appKey.trim() || !appSecret.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? (<><Loader2 size={14} className="animate-spin" /> Saving…</>) : 'Save'}
      </button>
    </form>
  )
}
