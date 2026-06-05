import { useState, useEffect, useCallback } from 'react'
import { Check, BookOpen, Loader2, AlertCircle, RefreshCw, LogOut } from 'lucide-react'
import {
  getMicrosoftConfig, saveMicrosoftConfig,
  getMicrosoftProfile, loginUrl, disconnectMicrosoft, syncNow,
} from '../api/microsoft'
import SetupGuide, { AZURE_GUIDE } from './SetupGuide'

/**
 * Microsoft 365 settings card.
 *
 * Two phases:
 *   1. Configure - paste Azure app credentials (client_id / secret / tenant).
 *      Pre-connect prerequisite per docs/AZURE_SETUP.md. Without this, the
 *      "Connect" step has nothing to talk to.
 *   2. Connect - opens the system browser to Microsoft, exchanges the
 *      authorisation code for tokens, and stores an encrypted refresh token.
 *      We poll /microsoft/profile every 2s until connected=true flips, so
 *      the card flips state even on desktop where the auth window is in a
 *      separate browser process and never sends us a "done" event.
 *
 * The connect button uses Tauri's shell.open when available so the OAuth
 * happens in the system browser (genuine address bar = user can verify
 * they're on a real Microsoft URL before consenting). In the browser/Docker
 * build it falls back to window.location.href.
 */
const MicrosoftLogo = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1"  y="1"  width="10" height="10" fill="#F25022"/>
    <rect x="13" y="1"  width="10" height="10" fill="#7FBA00"/>
    <rect x="1"  y="13" width="10" height="10" fill="#00A4EF"/>
    <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
  </svg>
)

export default function MicrosoftIntegration() {
  // null = loading; otherwise the latest config + profile snapshots.
  const [config, setConfig] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editingConfig, setEditingConfig] = useState(false)
  const [error, setError] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncSummary, setLastSyncSummary] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([getMicrosoftConfig(), getMicrosoftProfile()])
      setConfig(c)
      setProfile(p)
    } catch (e) {
      setError(e.message || 'Failed to load')
    }
  }, [])

  useEffect(() => {
    refresh()
    // Handle the post-OAuth redirect query params (web flow). Microsoft's
    // callback bounces through /api/microsoft/auth/callback which then 302s
    // to /settings?ms_connected=true or ?ms_error=... - strip those after
    // reading so a refresh doesn't re-trigger.
    const params = new URLSearchParams(window.location.search)
    if (params.get('ms_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname)
      // The browser tab is the OAuth tab - in desktop builds the user is in
      // a separate browser process so this branch is rarely hit, but it's
      // harmless to refresh on both.
    }
    if (params.get('ms_error')) {
      // params.get() already URL-decodes once. We still swap underscores to
      // spaces for legacy ms_error values (v0.6.x used underscores instead
      // of percent-encoding before v0.6.4).
      const raw = params.get('ms_error').replace(/_/g, ' ')
      setError(`Microsoft sign-in failed: ${raw}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConnect = () => {
    setError(null)
    // Same-tab navigation in both desktop and browser builds. The webview
    // (or browser tab) hits the backend's /auth/login, which 302s to
    // Microsoft. After consent, MS 302s back to /auth/callback, which
    // exchanges the code for tokens and redirects to /settings?ms_connected=true
    // - so the user lands right back on this page in the connected state.
    window.location.href = loginUrl()
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your Microsoft account? Synced calendar items will stay in Signals; new ones will stop arriving.')) return
    try {
      await disconnectMicrosoft()
      await refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      const result = await syncNow()
      setLastSyncSummary(result)
      await refresh()
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSaveConfig = async (payload) => {
    setError(null)
    try {
      const updated = await saveMicrosoftConfig(payload)
      setConfig(updated)
      setEditingConfig(false)
    } catch (e) {
      setError(e.message)
    }
  }

  if (!config || !profile) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper-500 dark:text-paper-600 italic">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }

  // Three top-level states:
  //   - Config missing: show the Azure setup prompt + paste-credentials form.
  //   - Config ok but not connected: show the Connect button.
  //   - Connected: show "connected as <email>" + manage actions.

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
          Azure app configured. Sign in to start syncing your Outlook calendar.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleConnect}
            className="
              flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
              bg-white text-pitch-800 border border-paper-300
              hover:bg-paper-100
              transition-colors
            "
          >
            <MicrosoftLogo size={14} />
            Sign in with Microsoft
          </button>
          <button
            onClick={() => setEditingConfig(true)}
            className="text-xs text-paper-500 hover:text-paper-700 dark:hover:text-paper-300 transition-colors"
          >
            Edit Azure config
          </button>
        </div>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </div>
    )
  }

  // Connected.
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
            {profile.last_synced && <> · last synced {new Date(profile.last_synced).toLocaleString()}</>}
          </p>
        </div>
      </div>

      {lastSyncSummary && !lastSyncSummary.skipped && (
        <div className="text-[11px] text-paper-500 dark:text-paper-600 px-1">
          Sync OK: +{lastSyncSummary.added || 0} new, {lastSyncSummary.updated || 0} updated
          {lastSyncSummary.ai_suggested > 0 && <>, {lastSyncSummary.ai_suggested} AI-suggested</>}
          {lastSyncSummary.dismissed > 0 && <>, {lastSyncSummary.dismissed} dropped</>}.
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
          {isSyncing
            ? <Loader2 size={11} className="animate-spin" />
            : <RefreshCw size={11} />
          }
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
            text-terracotta/80 hover:text-terracotta
            hover:bg-terracotta/10
            font-display uppercase tracking-wide transition-colors
          "
        >
          <LogOut size={11} />
          Disconnect
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <p className="text-[11px] text-paper-500 dark:text-paper-600 leading-snug">
        Effro reads your Outlook calendar (titles, times, organisers, locations) every 30 minutes
        and stages new events in <strong className="font-medium">Signals</strong> for you to triage.
        Nothing is written back to Outlook. Mail, files, and Teams are never accessed.
      </p>
    </div>
  )
}

// ─── Config form ─────────────────────────────────────────────────────────────

function ConfigForm({ existing, onCancel, onSave, error }) {
  const [clientId, setClientId] = useState(existing?.client_id || '')
  const [clientSecret, setClientSecret] = useState('')
  const [tenantId, setTenantId] = useState(existing?.tenant_id || 'common')
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!clientId.trim() || !clientSecret.trim()) return
    setSaving(true)
    try {
      await onSave({ client_id: clientId, client_secret: clientSecret, tenant_id: tenantId })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <SetupGuide guide={AZURE_GUIDE} open={showGuide} onClose={() => setShowGuide(false)} />
      {/* What is this */}
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-[10px] font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
          One-time Azure setup
        </div>
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          You need a free Azure app registration. It takes about 5 minutes. Follow the
          guided walk-through, then paste the values it gives you below. Your client secret
          is encrypted before it touches disk.
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
        label="Client ID"
        hint='The "Application (client) ID" GUID from the Azure portal.'
        value={clientId}
        onChange={setClientId}
        placeholder="00000000-0000-0000-0000-000000000000"
        autoComplete="off"
      />

      <Field
        label="Client secret"
        hint="The secret VALUE (not the secret ID) from Certificates & secrets. Stored Fernet-encrypted."
        value={clientSecret}
        onChange={setClientSecret}
        type="password"
        placeholder={existing?.client_secret_masked || 'Paste the secret value here'}
        autoComplete="off"
      />

      <Field
        label="Tenant"
        hint='"common" for personal + work accounts, "organizations" for work only, or a tenant GUID for single-org.'
        value={tenantId}
        onChange={setTenantId}
        placeholder="common"
      />

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

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
          {saving
            ? (<><Loader2 size={12} className="animate-spin" /> Saving…</>)
            : 'Save config'
          }
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
      {hint && (
        <p className="mt-1 text-[10px] text-paper-500 dark:text-paper-600">{hint}</p>
      )}
    </div>
  )
}
