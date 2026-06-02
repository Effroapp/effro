import { useState, useEffect, useCallback } from 'react'
import { Check, ExternalLink, Loader2, AlertCircle, RefreshCw, LogOut, KanbanSquare } from 'lucide-react'
import {
  getJiraConfig, saveJiraConfig,
  getJiraProfile, loginUrl, disconnectJira, jiraSyncNow,
} from '../api/jira'

/**
 * Jira Cloud integration settings card.
 *
 * Two phases (mirrors MicrosoftIntegration.jsx):
 *   1. Configure — paste Atlassian OAuth app Client ID + Secret.
 *   2. Connect  — browser navigates to Atlassian consent, returns to
 *                 /settings?jira_connected=true on success.
 *
 * Signals receives three JQL query results: assigned, mentioned, sprint.
 */
export default function JiraIntegration() {
  const [config, setConfig] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editingConfig, setEditingConfig] = useState(false)
  const [error, setError] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([getJiraConfig(), getJiraProfile()])
      setConfig(c)
      setProfile(p)
    } catch (e) {
      setError(e.message || 'Failed to load')
    }
  }, [])

  useEffect(() => {
    refresh()
    const params = new URLSearchParams(window.location.search)
    if (params.get('jira_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('jira_error')) {
      const raw = params.get('jira_error').replace(/_/g, ' ')
      setError(`Jira sign-in failed: ${raw}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [refresh])

  const handleConnect = () => {
    setError(null)
    window.location.href = loginUrl()
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Jira? Synced issues will stay in Signals; new ones will stop arriving.')) return
    try {
      await disconnectJira()
      await refresh()
    } catch (e) { setError(e.message) }
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      const result = await jiraSyncNow()
      setLastSync(result)
      await refresh()
    } catch (e) { setError(e.message || 'Sync failed') }
    finally { setIsSyncing(false) }
  }

  const handleSaveConfig = async (payload) => {
    setError(null)
    try {
      const updated = await saveJiraConfig(payload)
      setConfig(updated)
      setEditingConfig(false)
    } catch (e) { setError(e.message) }
  }

  if (!config || !profile) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper-500 dark:text-paper-600 italic">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (editingConfig || !config.is_configured) {
    return (
      <ConfigForm
        existing={config}
        onCancel={config.is_configured ? () => setEditingConfig(false) : null}
        onSave={handleSaveConfig}
        error={error}
      />
    )
  }

  if (!profile.connected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-pitch-700 dark:text-paper-300">
          Atlassian app configured. Sign in to start syncing your Jira issues.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleConnect}
            className="
              flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
              bg-[#0052CC] hover:bg-[#0065FF] text-white
              transition-colors
            "
          >
            <KanbanSquare size={14} />
            Sign in with Atlassian
          </button>
          <button
            onClick={() => setEditingConfig(true)}
            className="text-xs text-paper-500 hover:text-paper-700 dark:hover:text-paper-300 transition-colors"
          >
            Edit app config
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
      </div>
    )
  }

  // Connected
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
        <Check size={14} className="text-mint flex-shrink-0" strokeWidth={3} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-pitch-800 dark:text-white truncate">
            {profile.display_name || profile.email || 'Connected'}
          </p>
          <p className="text-[11px] font-mono text-paper-500 dark:text-paper-600 mt-0.5 truncate">
            {profile.email}
            {profile.cloud_name && <> · {profile.cloud_name}</>}
            {profile.last_synced && <> · synced {new Date(profile.last_synced).toLocaleString()}</>}
          </p>
        </div>
      </div>

      {lastSync && !lastSync.skipped && (
        <div className="text-[11px] text-paper-500 dark:text-paper-600 px-1">
          Sync OK: +{lastSync.added || 0} new, {lastSync.updated || 0} updated
          {lastSync.ai_suggested > 0 && <>, {lastSync.ai_suggested} AI-suggested</>}.
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleSyncNow}
          disabled={isSyncing}
          className="
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs
            text-paper-700 dark:text-paper-300
            hover:bg-paper-200 dark:hover:bg-pitch-700
            disabled:opacity-40
            font-display uppercase tracking-wide transition-colors
          "
        >
          {isSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {isSyncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          onClick={() => setEditingConfig(true)}
          className="
            px-3 py-1.5 rounded-md text-xs
            text-paper-700 dark:text-paper-300
            hover:bg-paper-200 dark:hover:bg-pitch-700
            font-display uppercase tracking-wide transition-colors
          "
        >
          Edit config
        </button>
        <button
          onClick={handleDisconnect}
          className="
            ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs
            text-red-500/80 hover:text-red-500
            hover:bg-red-50 dark:hover:bg-red-950/30
            font-display uppercase tracking-wide transition-colors
          "
        >
          <LogOut size={11} />
          Disconnect
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <p className="text-[11px] text-paper-500 dark:text-paper-600 leading-snug">
        Effro pulls three sets of Jira issues every 30 minutes: <strong className="font-medium">assigned to you</strong>, <strong className="font-medium">issues you're watching</strong>, and <strong className="font-medium">current sprint</strong>. Each appears in Signals for triage. Only read access is requested — Effro never writes to Jira.
      </p>
    </div>
  )
}

function ConfigForm({ existing, onCancel, onSave, error }) {
  const [clientId, setClientId] = useState(existing?.client_id || '')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!clientId.trim() || !clientSecret.trim()) return
    setSaving(true)
    try {
      await onSave({ client_id: clientId, client_secret: clientSecret })
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-[10px] font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
          One-time Atlassian setup
        </div>
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          You need a free Atlassian OAuth 2.0 app. Full walk-through in{' '}
          <a
            href="https://github.com/Effroapp/effro/blob/main/docs/JIRA_SETUP.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-mint-700 dark:text-mint-300 font-medium hover:underline inline-flex items-center gap-0.5"
          >
            docs/JIRA_SETUP.md <ExternalLink size={10} />
          </a>
          {' '}— takes about 5 minutes. Your client secret is Fernet-encrypted before it touches disk.
        </div>
      </div>

      <Field
        label="Client ID"
        hint='The "Client ID" from your Atlassian developer app.'
        value={clientId}
        onChange={setClientId}
        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        autoComplete="off"
      />

      <Field
        label="Client secret"
        hint="The secret VALUE (not its ID) from the app settings."
        value={clientSecret}
        onChange={setClientSecret}
        type="password"
        placeholder={existing?.client_secret_masked || 'Paste the secret value here'}
        autoComplete="off"
      />

      {error && <ErrorBanner message={error} />}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !clientId.trim() || !clientSecret.trim()}
          className="
            flex-1 flex items-center justify-center gap-2
            px-4 py-2 rounded-md text-sm font-semibold
            bg-mint-700 hover:bg-mint-800 text-white
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
        >
          {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Save config'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="
              px-4 py-2 rounded-md text-sm
              text-paper-700 dark:text-paper-300
              hover:bg-paper-200 dark:hover:bg-pitch-700
              transition-colors
            "
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function Field({ label, hint, value, onChange, placeholder, type = 'text', autoComplete }) {
  return (
    <div>
      <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="
          w-full px-3 py-2 rounded-lg text-sm font-mono
          bg-paper-100 dark:bg-pitch-800
          border border-paper-300 dark:border-pitch-500
          text-pitch-800 dark:text-white
          placeholder:text-paper-400 dark:placeholder:text-paper-700
          focus:outline-none focus:ring-2 focus:ring-mint-500
        "
      />
      {hint && <p className="mt-1 text-[10px] text-paper-500 dark:text-paper-600">{hint}</p>}
    </div>
  )
}

function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
      <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
      {message}
    </div>
  )
}
