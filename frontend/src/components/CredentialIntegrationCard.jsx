import { useState, useEffect, useCallback } from 'react'
import { Check, BookOpen, Loader2, AlertCircle, RefreshCw, LogOut, CheckCircle2, XCircle } from 'lucide-react'
import PostConnectFlow from './PostConnectFlow'
import SetupGuide from './SetupGuide'

/**
 * The one credential-based integration card (GitHub, iCloud, Telegram, Mail).
 * Three states - loading, connected, setup form - with the sync/test/edit/
 * disconnect row and the shared error/result boxes. Each integration supplies
 * only what differs: its api client, its fields, its guide and its copy.
 *
 * props:
 *   api               { getConfig, getProfile, saveConfig, test, disconnect, syncNow }
 *   fields            [{ name, label, type, placeholder|fn(existing), hint, optional, initial: fn(existing) }]
 *                     saveConfig receives { [name]: trimmed value } (optional empties omitted)
 *   guide             SetupGuide data
 *   infoBox           JSX inside the setup form's intro box
 *   connectedTitle    fn(profile) -> headline in the connected chip
 *   connectedSubtitle fn(profile) -> mono line under it (last synced is appended)
 *   helpText          JSX paragraph under the connected actions
 *   disconnectConfirm window.confirm copy
 *   providerKey/providerName/providerLogo
 *                     identity for the post-connect flow (celebration, first
 *                     sync, go to Signals focused on this source)
 */
export default function CredentialIntegrationCard({
  api, fields, guide, infoBox, connectedTitle, connectedSubtitle, helpText, disconnectConfirm,
  providerKey, providerName, providerLogo,
}) {
  const [config, setConfig] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncSummary, setLastSyncSummary] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [testingConn, setTestingConn] = useState(false)
  // True right after a fresh connect (not an edit) - shows the post-connect
  // flow: celebration, first-sync invitation, summary, go to Signals.
  const [justConnected, setJustConnected] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.getConfig(), api.getProfile()])
      setConfig(c); setProfile(p)
    } catch (e) { setError(e.message || 'Failed to load') }
  }, [api])

  useEffect(() => { refresh() }, [refresh])

  const handleSyncNow = async () => {
    setIsSyncing(true); setError(null)
    try { setLastSyncSummary(await api.syncNow()); await refresh() }
    catch (e) { setError(e.message || 'Sync failed') } finally { setIsSyncing(false) }
  }
  const handleTest = async () => {
    setTestingConn(true); setTestResult(null)
    try { setTestResult(await api.test()) }
    catch (e) { setTestResult({ ok: false, message: e.message }) } finally { setTestingConn(false) }
  }
  const handleDisconnect = async () => {
    if (!window.confirm(disconnectConfirm)) return
    try { await api.disconnect(); await refresh() } catch (e) { setError(e.message) }
  }

  if (!config || !profile) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper-500 dark:text-paper-600 italic">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (justConnected) {
    return (
      <PostConnectFlow
        providerKey={providerKey}
        providerName={providerName}
        providerLogo={providerLogo}
        syncNow={api.syncNow}
        onClose={() => { setJustConnected(false); refresh() }}
      />
    )
  }

  if (editing || !config.is_configured) {
    const isFirstConnect = !config.is_configured
    return (
      <ConfigForm
        api={api} fields={fields} guide={guide} infoBox={infoBox} existing={config}
        onCancel={config.is_configured ? () => setEditing(false) : null}
        onSaved={() => {
          // A fresh credential invalidates whatever the old one reported.
          setEditing(false); setTestResult(null); setLastSyncSummary(null); setError(null)
          if (isFirstConnect) setJustConnected(true)   // celebrate + offer first sync
          refresh()
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
        <Check size={14} className="text-mint flex-shrink-0" strokeWidth={3} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-pitch-800 dark:text-white truncate">{connectedTitle(profile) || 'Connected'}</p>
          <p className="text-2xs font-mono text-paper-500 dark:text-paper-600 mt-0.5 truncate">
            {connectedSubtitle(profile)}
            {profile.last_synced && <> · last synced {new Date(profile.last_synced).toLocaleString()}</>}
          </p>
        </div>
      </div>

      {lastSyncSummary && !lastSyncSummary.skipped && (
        <div className="text-2xs text-paper-500 dark:text-paper-600 px-1">
          Sync OK: +{lastSyncSummary.added || 0} new, {lastSyncSummary.updated || 0} updated.
        </div>
      )}
      {testResult && (
        <div className={`flex items-start gap-2 p-2 rounded-md text-xs border ${testResult.ok
          ? 'bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 border-mint/40'
          : 'bg-terracotta/10 dark:bg-terracotta/15 text-terracotta border-terracotta/30'}`}>
          {testResult.ok ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" /> : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
          {testResult.message}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleSyncNow} disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 disabled:opacity-40 font-display uppercase tracking-wide transition-colors">
          {isSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {isSyncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button onClick={handleTest} disabled={testingConn}
          className="px-3 py-1.5 rounded-md text-xs text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 disabled:opacity-40 font-display uppercase tracking-wide transition-colors">
          {testingConn ? 'Testing…' : 'Test'}
        </button>
        <button onClick={() => setEditing(true)}
          className="px-3 py-1.5 rounded-md text-xs text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 font-display uppercase tracking-wide transition-colors">
          Edit
        </button>
        <button onClick={handleDisconnect}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-terracotta/80 hover:text-terracotta hover:bg-terracotta/10 font-display uppercase tracking-wide transition-colors">
          <LogOut size={11} /> Disconnect
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {helpText}
    </div>
  )
}

function ConfigForm({ api, fields, guide, infoBox, existing, onCancel, onSaved }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial ? f.initial(existing) || '' : ''])))
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [error, setError] = useState('')

  const ready = fields.every((f) => f.optional || values[f.name].trim())

  const submit = async (e) => {
    e?.preventDefault()
    if (!ready) return
    setSaving(true); setError('')
    try {
      const payload = {}
      for (const f of fields) {
        const v = values[f.name].trim()
        if (v || !f.optional) payload[f.name] = v
      }
      await api.saveConfig(payload)
      onSaved()
    } catch (e2) { setError(e2.message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SetupGuide guide={guide} open={showGuide} onClose={() => setShowGuide(false)} />
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">{infoBox}</div>
        <button type="button" onClick={() => setShowGuide(true)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 text-mint-700 dark:text-mint-300 hover:border-mint/50 transition-colors">
          <BookOpen size={12} /> Open setup guide
        </button>
      </div>

      {fields.map((f) => (
        <div key={f.name}>
          <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">{f.label}</label>
          <input
            type={f.type || 'text'}
            value={values[f.name]}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={typeof f.placeholder === 'function' ? f.placeholder(existing) : f.placeholder}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
          />
          {f.hint && <p className="mt-1 text-2xs text-paper-500 dark:text-paper-600">{f.hint}</p>}
        </div>
      ))}

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={saving || !ready}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {saving ? (<><Loader2 size={12} className="animate-spin" /> Connecting…</>) : 'Connect'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
