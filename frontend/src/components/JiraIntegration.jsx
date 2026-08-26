import { useState, useEffect, useCallback } from 'react'
import { Check, BookOpen, Loader2, AlertCircle, RefreshCw, LogOut, KanbanSquare } from 'lucide-react'
import {
  getJiraConfig, saveJiraConfig,
  getJiraProfile, loginUrl, disconnectJira, jiraSyncNow,
  getJiraScope, setJiraScope,
} from '../api/jira'
import SetupGuide, { JIRA_GUIDE } from './SetupGuide'
import Field from './Field'

// Which Jira issues land in Signals. Personal preference — defaults to "mine".
const SCOPE_OPTIONS = [
  { key: 'mine',     label: "Only what's mine", desc: 'Issues assigned to you, plus ones you watch or are mentioned in.' },
  { key: 'assigned', label: 'Assigned to me',   desc: 'Strictly issues where you are the assignee. The quietest.' },
  { key: 'all',      label: 'Everything',        desc: 'Assigned + watched + the entire current sprint (includes other people).' },
]

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
  const [scope, setScope] = useState('mine')
  const [savingScope, setSavingScope] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [c, p, s] = await Promise.all([getJiraConfig(), getJiraProfile(), getJiraScope()])
      setConfig(c)
      setProfile(p)
      setScope(s.scope)
    } catch (e) {
      setError(e.message || 'Failed to load')
    }
  }, [])

  const handleScopeChange = async (next) => {
    if (next === scope || savingScope) return
    setSavingScope(true)
    setScope(next)  // optimistic
    try {
      await setJiraScope(next)
      // Re-sync so Signals reflects the new scope right away
      const result = await jiraSyncNow()
      setLastSync(result)
    } catch (e) {
      setError(e.message || 'Could not update scope')
    } finally {
      setSavingScope(false)
    }
  }

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
          <p className="text-2xs font-mono text-paper-500 dark:text-paper-600 mt-0.5 truncate">
            {profile.email}
            {profile.cloud_name && <> · {profile.cloud_name}</>}
            {profile.last_synced && <> · synced {new Date(profile.last_synced).toLocaleString()}</>}
          </p>
        </div>
      </div>

      {lastSync && !lastSync.skipped && (
        <div className="text-2xs text-paper-500 dark:text-paper-600 px-1">
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
            font-sans font-medium uppercase tracking-wide transition-colors
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
            font-sans font-medium uppercase tracking-wide transition-colors
          "
        >
          Edit config
        </button>
        <button
          onClick={handleDisconnect}
          className="
            ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs
            text-terracotta/80 hover:text-terracotta
            hover:bg-terracotta/10
            font-sans font-medium uppercase tracking-wide transition-colors
          "
        >
          <LogOut size={11} />
          Disconnect
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Which issues land in Signals — personal preference */}
      <div className="pt-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="eyebrow text-paper-500 dark:text-paper-600">
            Bring into Signals
          </span>
          {savingScope && <Loader2 size={11} className="animate-spin text-paper-400 dark:text-paper-600" />}
        </div>
        <div className="space-y-1.5">
          {SCOPE_OPTIONS.map((opt) => {
            const active = scope === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => handleScopeChange(opt.key)}
                disabled={savingScope}
                className={`
                  w-full text-left flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-colors disabled:cursor-wait
                  ${active
                    ? 'border-mint/40 bg-mint-50/60 dark:bg-mint-900/15'
                    : 'border-paper-300 dark:border-pitch-500 hover:border-paper-400 dark:hover:border-pitch-400'
                  }
                `}
              >
                <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center
                  ${active ? 'border-mint-600 dark:border-mint-400' : 'border-paper-400 dark:border-pitch-400'}`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-mint-600 dark:bg-mint-400" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-medium ${active ? 'text-pitch-800 dark:text-white' : 'text-pitch-700 dark:text-paper-300'}`}>
                    {opt.label}
                  </span>
                  <span className="block text-2xs text-paper-500 dark:text-paper-600 leading-snug">
                    {opt.desc}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-2xs text-paper-500 dark:text-paper-600 leading-snug">
          Syncs every 30 minutes into Signals for triage. Read-only, so Effro never writes to Jira. Changing this re-syncs now; issues already in Signals stay until you dismiss them.
        </p>
      </div>
    </div>
  )
}

function ConfigForm({ existing, onCancel, onSave, error }) {
  const [clientId, setClientId] = useState(existing?.client_id || '')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

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
      <SetupGuide guide={JIRA_GUIDE} open={showGuide} onClose={() => setShowGuide(false)} />
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="eyebrow text-mint-700 dark:text-mint-300 mb-1">
          One-time Atlassian setup
        </div>
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          You need a free Atlassian OAuth 2.0 app. It takes about 5 minutes. Follow the
          guided walk-through, then paste the values it gives you below. Your client secret
          is Fernet-encrypted before it touches disk.
        </div>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 text-mint-700 dark:text-mint-300 hover:border-mint/50 transition-colors"
        >
          <BookOpen size={12} /> Open setup guide
        </button>
      </div>

      <Field
        mono
        label="Client ID"
        hint='The "Client ID" from your Atlassian developer app.'
        value={clientId}
        onChange={setClientId}
        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        autoComplete="off"
      />

      <Field
        mono
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
          className="btn btn-md btn-primary flex-1"
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


function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
      <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
      {message}
    </div>
  )
}
