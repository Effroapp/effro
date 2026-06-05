import { useState, useEffect, useCallback } from 'react'
import { Check, BookOpen, Loader2, AlertCircle, RefreshCw, LogOut, CheckCircle2, XCircle } from 'lucide-react'
import {
  getIcloudConfig, saveIcloudConfig, getIcloudProfile,
  testIcloud, disconnectIcloud, syncNow,
} from '../api/icloud'
import SetupGuide, { ICLOUD_GUIDE } from './SetupGuide'

/**
 * iCloud settings card. Credential-based (Apple ID + app-specific password) over
 * CalDAV + IMAP - Apple has no OAuth for consumer iCloud, so it's a form, not a
 * "Sign in" redirect. Pulls Calendar + flagged Mail into Signals.
 */
export default function IcloudIntegration() {
  const [config, setConfig] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncSummary, setLastSyncSummary] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [testingConn, setTestingConn] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([getIcloudConfig(), getIcloudProfile()])
      setConfig(c)
      setProfile(p)
    } catch (e) {
      setError(e.message || 'Failed to load')
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleSyncNow = async () => {
    setIsSyncing(true); setError(null)
    try {
      setLastSyncSummary(await syncNow())
      await refresh()
    } catch (e) { setError(e.message || 'Sync failed') } finally { setIsSyncing(false) }
  }

  const handleTest = async () => {
    setTestingConn(true); setTestResult(null)
    try { setTestResult(await testIcloud()) }
    catch (e) { setTestResult({ ok: false, message: e.message }) }
    finally { setTestingConn(false) }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect iCloud? Your Apple ID and app password will be removed.')) return
    try { await disconnectIcloud(); await refresh() } catch (e) { setError(e.message) }
  }

  if (!config || !profile) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper-500 dark:text-paper-600 italic">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (editing || !config.is_configured) {
    return (
      <ConfigForm
        existing={config}
        onCancel={config.is_configured ? () => setEditing(false) : null}
        onSaved={() => { setEditing(false); refresh() }}
      />
    )
  }

  // Connected.
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
        <Check size={14} className="text-mint flex-shrink-0" strokeWidth={3} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-pitch-800 dark:text-white truncate">{profile.apple_id || 'Connected'}</p>
          <p className="text-[11px] font-mono text-paper-500 dark:text-paper-600 mt-0.5 truncate">
            iCloud
            {profile.last_synced && <> · last synced {new Date(profile.last_synced).toLocaleString()}</>}
          </p>
        </div>
      </div>

      {lastSyncSummary && !lastSyncSummary.skipped && (
        <div className="text-[11px] text-paper-500 dark:text-paper-600 px-1">
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

      <p className="text-[11px] text-paper-500 dark:text-paper-600 leading-snug">
        Pulls your iCloud <strong className="font-medium">Calendar</strong> events and <strong className="font-medium">flagged Mail</strong> into
        Signals to triage. Read-only, over CalDAV and IMAP. iCloud Drive isn’t available as a backup target (Apple has no API for it).
      </p>
    </div>
  )
}

function ConfigForm({ existing, onCancel, onSaved }) {
  const [appleId, setAppleId] = useState(existing?.apple_id || '')
  const [appPassword, setAppPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e?.preventDefault()
    if (!appleId.trim() || !appPassword.trim()) return
    setSaving(true); setError('')
    try {
      await saveIcloudConfig({ apple_id: appleId, app_password: appPassword })
      onSaved()
    } catch (e2) { setError(e2.message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SetupGuide guide={ICLOUD_GUIDE} open={showGuide} onClose={() => setShowGuide(false)} />
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          iCloud has no "Sign in with Apple" for apps. Connect with your Apple ID and an
          app-specific password (about 3 minutes). Calendar + flagged Mail only. The password
          is encrypted before it touches disk.
        </div>
        <button type="button" onClick={() => setShowGuide(true)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 text-mint-700 dark:text-mint-300 hover:border-mint/50 transition-colors">
          <BookOpen size={12} /> Open setup guide
        </button>
      </div>

      <Field label="Apple ID" hint="The email address you sign in to iCloud with." value={appleId} onChange={setAppleId} placeholder="you@icloud.com" type="email" />
      <Field label="App-specific password" hint="Generated at appleid.apple.com, not your normal Apple password. Stored encrypted." value={appPassword} onChange={setAppPassword} placeholder={existing?.app_password_masked || 'abcd-efgh-ijkl-mnop'} type="password" />

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={saving || !appleId.trim() || !appPassword.trim()}
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

function Field({ label, hint, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
      />
      {hint && <p className="mt-1 text-[10px] text-paper-500 dark:text-paper-600">{hint}</p>}
    </div>
  )
}
