import { useState, useEffect, useCallback } from 'react'
import { Check, BookOpen, Loader2, AlertCircle, LogOut } from 'lucide-react'
import {
  getGoogleConfig, saveGoogleConfig,
  getGoogleProfile, loginUrl, disconnectGoogle,
} from '../api/google'
import SetupGuide, { GOOGLE_GUIDE } from './SetupGuide'

/**
 * Google Drive/Docs settings card. Same two-phase shape as the Microsoft card:
 *   1. Configure - paste the Google Cloud OAuth client_id / client_secret.
 *   2. Connect   - full-page redirect to Google, token exchange on callback.
 * Connected state polls /google/profile so the card flips after the round-trip.
 */
const GoogleLogo = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3a7.2 7.2 0 0 1-10.74-3.78H1.34v3.09A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.33 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l3.99-3.09Z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.99 11.99 0 0 0 1.34 6.6l3.99 3.09A7.2 7.2 0 0 1 12 4.75Z" />
  </svg>
)

export default function GoogleIntegration() {
  const [config, setConfig] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editingConfig, setEditingConfig] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([getGoogleConfig(), getGoogleProfile()])
      setConfig(c)
      setProfile(p)
    } catch (e) {
      setError(e.message || 'Failed to load')
    }
  }, [])

  useEffect(() => {
    refresh()
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('google_error')) {
      const raw = params.get('google_error').replace(/_/g, ' ')
      setError(`Google sign-in failed: ${raw}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConnect = () => {
    setError(null)
    window.location.href = loginUrl()
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your Google account? Docs already linked into Effro stay; new ones will stop arriving.')) return
    try {
      await disconnectGoogle()
      await refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleSaveConfig = async (payload) => {
    setError(null)
    try {
      const updated = await saveGoogleConfig(payload)
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
          Google OAuth app configured. Sign in to connect your Drive and Docs.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleConnect}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-white text-pitch-800 border border-paper-300 hover:bg-paper-100 transition-colors"
          >
            <GoogleLogo size={14} />
            Sign in with Google
          </button>
          <button
            onClick={() => setEditingConfig(true)}
            className="text-xs text-paper-500 hover:text-paper-700 dark:hover:text-paper-300 transition-colors"
          >
            Edit Google config
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
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setEditingConfig(true)}
          className="px-3 py-1.5 rounded-md text-xs text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 font-display uppercase tracking-wide transition-colors"
        >
          Edit config
        </button>
        <button
          onClick={handleDisconnect}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-terracotta/80 hover:text-terracotta hover:bg-terracotta/10 font-display uppercase tracking-wide transition-colors"
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
        One Google connection powers everything: attach Docs to threads, ingest a Doc's text, export content to a
        new Doc, and (under Settings → Storage) encrypted backups to Google Drive. It only reads the Docs you choose
        and creates files it owns, nothing else.
      </p>
    </div>
  )
}

// ─── Config form ─────────────────────────────────────────────────────────────

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
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <SetupGuide guide={GOOGLE_GUIDE} open={showGuide} onClose={() => setShowGuide(false)} />
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-[10px] font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
          One-time Google setup
        </div>
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          You need a free Google Cloud OAuth app. It takes about 7 minutes. Follow the guided
          walk-through, then paste the values it gives you below. Your client secret is
          Fernet-encrypted before it touches disk.
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
        hint="The OAuth 2.0 Client ID from Google Cloud → Credentials."
        value={clientId}
        onChange={setClientId}
        placeholder="xxxxxxxx.apps.googleusercontent.com"
        autoComplete="off"
      />

      <Field
        label="Client secret"
        hint="The client secret from the same OAuth client. Stored Fernet-encrypted."
        value={clientSecret}
        onChange={setClientSecret}
        type="password"
        placeholder={existing?.client_secret_masked || 'Paste the client secret here'}
        autoComplete="off"
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
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? (<><Loader2 size={12} className="animate-spin" /> Saving…</>) : 'Save config'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm text-paper-700 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors"
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
      <label className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
      />
      {hint && <p className="mt-1 text-[10px] text-paper-500 dark:text-paper-600">{hint}</p>}
    </div>
  )
}
