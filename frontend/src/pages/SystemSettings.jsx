import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Settings as SettingsIcon, ArrowLeft, Cpu, FolderOpen, RefreshCw,
  AlertCircle, Download, Zap, ChevronRight, ChevronLeft,
  CheckCircle2, XCircle, Loader2, ExternalLink,
  Database, CloudOff,
} from 'lucide-react'
import {
  isTauri,
  getDataDir,
  pickDataDir,
  migrateAndSetDataDir,
  relaunch,
} from '../api/tauri'
import {
  getAIConfig, getAIPresets, saveAIConfig, testAIConfig,
} from '../api/settings'
import { getStorageConfig } from '../api/storage'
import StorageSetupModal from '../components/StorageSetupModal'
import IntegrationsHub from '../components/IntegrationsHub'
import MicrosoftIntegration from '../components/MicrosoftIntegration'
import JiraIntegration from '../components/JiraIntegration'
import GoogleIntegration from '../components/GoogleIntegration'
import { useAppVersion } from '../hooks/useAppVersion'
import { notifyAIConfigChanged } from '../hooks/useAIConfigured'

/**
 * System Settings - a dedicated page (was a popover; promoted because
 * it now houses the AI engine wizard, data storage, updates, and About).
 *
 * Layout: one card per concern, stacked. AI Engine sits at the top
 * because it's the most-changed setting and most consequential to AI
 * features working at all.
 *
 * The AI Engine card stays collapsed (summary view) until the user clicks
 * "Set up" / "Change" - only then does the three-step wizard appear,
 * inline on the page. Keeping the wizard inline (not in a sub-modal)
 * avoids the "modal-on-popover" stacking that the popover version had,
 * which fights with the way ADHD brains track state.
 */
export default function SystemSettings({ updater }) {
  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      <header className="
        sticky top-0 z-10 px-8 py-5
        bg-paper-100/90 dark:bg-pitch-800/90 backdrop-blur-md
        border-b border-paper-300 dark:border-pitch-700
      ">
        <div className="max-w-5xl mx-auto pr-14">
          <Link
            to="/"
            className="
              inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest
              text-paper-500 dark:text-paper-600
              hover:text-pitch-700 dark:hover:text-paper-200
              transition-colors mb-3
            "
          >
            <ArrowLeft size={11} /> Back
          </Link>
          <div className="flex items-center gap-3">
            <SettingsIcon size={20} strokeWidth={1.75} className="text-paper-500 dark:text-pitch-100 flex-shrink-0" />
            <h1 className="font-display font-semibold text-xl tracking-[-0.01em] text-paper-900 dark:text-pitch-50 leading-tight">
              Settings
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8 space-y-6">
        <IntegrationsHub />
        <AISection id="integration-ai" />
        <StorageSection id="integration-storage" />
        <MicrosoftSection id="integration-microsoft" />
        <JiraSection id="integration-jira" />
        <GoogleSection id="integration-google" />
        {isTauri() && <UpdateSection updater={updater} />}
        <AboutSection />
      </main>
    </div>
  )
}

// ─── AI Engine ────────────────────────────────────────────────────────────────

function AISection({ id }) {
  const [config, setConfig] = useState(null)
  const [editing, setEditing] = useState(false)

  const refresh = () => {
    getAIConfig().then(setConfig).catch(() => setConfig(null))
  }

  useEffect(() => { refresh() }, [])

  return (
    <Card id={id}>
      <CardHeader
        icon={Cpu}
        title="AI Engine"
        subtitle="Powers smart capture, area summaries, and the weekly roundup."
      />

      {!editing && (
        <AISummaryCard
          config={config}
          onEdit={() => setEditing(true)}
        />
      )}

      {editing && (
        <AIWizard
          currentConfig={config}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); refresh() }}
        />
      )}
    </Card>
  )
}

function AISummaryCard({ config, onEdit }) {
  // Three visual states:
  //   1. Loading - config is null + we haven't decided yet (skip dot)
  //   2. Unconfigured - show prompt + "Set up" CTA
  //   3. Configured - show provider/model/masked key + "Change" button
  if (config === null) {
    return (
      <div className="text-xs text-paper-500 dark:text-paper-600 italic">
        Loading…
      </div>
    )
  }

  if (!config.is_configured) {
    return (
      <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
        <div className="flex items-start gap-3 min-w-0">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-mustard" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-pitch-800 dark:text-white">
              AI not configured yet
            </p>
            <p className="text-xs text-paper-500 dark:text-paper-600 mt-0.5">
              Smart capture and area summaries need an AI provider to work.
            </p>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="
            flex-shrink-0 px-4 py-2 rounded-md text-xs
            bg-mint-700 hover:bg-mint-800 text-white
            font-display uppercase tracking-wide transition-colors
          "
        >
          Set up
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-2 h-2 rounded-full bg-mint flex-shrink-0 mt-2" aria-label="Configured" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-pitch-800 dark:text-white capitalize">
            {config.provider}
          </p>
          <p className="text-[11px] font-mono text-paper-500 dark:text-paper-600 mt-0.5 truncate">
            {config.model || '(default model)'}
            {config.api_key_masked && (
              <> · <span className="text-paper-400 dark:text-paper-700">{config.api_key_masked}</span></>
            )}
          </p>
        </div>
      </div>
      <button
        onClick={onEdit}
        className="
          flex-shrink-0 px-3 py-1.5 rounded-md text-xs
          text-paper-700 dark:text-paper-300
          hover:bg-paper-200 dark:hover:bg-pitch-700
          font-display uppercase tracking-wide transition-colors
        "
      >
        Change
      </button>
    </div>
  )
}

// ─── AI Wizard (inline on the page) ───────────────────────────────────────────

// Per-provider guide content. Same copy as the kit's modal version, just
// reflowed onto the page. Keeping it as data makes future copy edits a
// one-place change.
const GUIDES = {
  claude: {
    badge: 'Paid',
    icon: '🟠',
    what: "The AI built into Effro by default. Strongest results for smart capture, area summaries, and the weekly roundup. Needs an Anthropic API key.",
    time: 'About 3 minutes',
    steps: [
      { text: 'Go to', link: { label: 'console.anthropic.com', url: 'https://console.anthropic.com' } },
      { text: 'Click API Keys in the left sidebar' },
      { text: 'Click Create Key - copy it and paste below' },
    ],
    keyLabel: 'Anthropic API key',
    keyHint: 'Starts with "sk-ant-"',
    keyPlaceholder: 'sk-ant-••••••••••',
    urlNeeded: false,
    modelLabel: 'Model',
    modelHint: 'Leave as default unless you have a specific reason to change.',
    defaultModel: 'claude-sonnet-4-6',
  },
  groq: {
    badge: 'Free tier',
    icon: '⚡',
    what: "Fast, free AI service. The free tier gives you 14,400 requests per day - more than enough for personal use. No credit card required.",
    time: 'About 2 minutes',
    steps: [
      { text: 'Go to', link: { label: 'console.groq.com', url: 'https://console.groq.com' }, suffix: 'and sign up (free)' },
      { text: 'Click API Keys in the left menu' },
      { text: 'Click Create API Key - copy it and paste below' },
    ],
    keyLabel: 'Groq API key',
    keyHint: 'Starts with "gsk_"',
    keyPlaceholder: 'gsk_••••••••••',
    urlNeeded: false,
    modelLabel: 'Model',
    modelHint: 'llama-3.1-8b-instant is fast and free. llama-3.3-70b-versatile is better quality, still free.',
    defaultModel: 'llama-3.1-8b-instant',
  },
  gemini: {
    badge: 'Free tier',
    icon: '✦',
    what: "Google's AI. Gemini 1.5 Flash is free with no billing required. Good general-purpose model for summaries and extraction.",
    time: 'About 2 minutes',
    steps: [
      { text: 'Go to', link: { label: 'aistudio.google.com', url: 'https://aistudio.google.com' } },
      { text: 'Click Get API key (top left of the page)' },
      { text: 'Click Create API key - copy it and paste below' },
    ],
    keyLabel: 'Gemini API key',
    keyHint: 'Starts with "AIza"',
    keyPlaceholder: 'AIza••••••••••',
    urlNeeded: false,
    modelLabel: 'Model',
    modelHint: 'gemini-1.5-flash is free and fast. gemini-1.5-pro has better quality but lower free limits.',
    defaultModel: 'gemini-1.5-flash',
  },
  ollama: {
    badge: '100% local',
    icon: '🦙',
    what: "Runs entirely on your machine. No account, no API key, no cost, and your data never leaves your device. Requires Ollama installed locally.",
    time: 'About 5 minutes (plus model download)',
    steps: [
      { text: 'Go to', link: { label: 'ollama.com/download', url: 'https://ollama.com/download' }, suffix: 'and install Ollama' },
      { text: 'Open a terminal and run:', code: 'ollama pull llama3' },
      { text: 'Click Test below - no key needed' },
    ],
    keyLabel: null,
    urlNeeded: false,
    modelLabel: 'Model',
    modelHint: 'Must match a model you have pulled. Run "ollama list" to see what\'s available.',
    defaultModel: 'llama3',
  },
  custom: {
    badge: 'Enterprise',
    icon: '⚙️',
    what: "Any service with an OpenAI-compatible API. Use this for Azure OpenAI, OpenRouter, or a private model your organisation provides.",
    time: 'Details from your provider or IT team',
    steps: [
      { text: 'Get the base URL from your provider (e.g. your Azure OpenAI endpoint)' },
      { text: 'Get your API key from the same place' },
      { text: 'Enter the model name your provider has given you access to' },
    ],
    keyLabel: 'API key',
    keyHint: 'From your provider or IT team',
    keyPlaceholder: 'Enter your API key',
    urlNeeded: true,
    urlLabel: 'Base URL',
    urlHint: 'e.g. https://your-resource.openai.azure.com/openai or https://openrouter.ai/api/v1',
    urlPlaceholder: 'https://…',
    modelLabel: 'Model name',
    modelHint: 'Exact model name as given by your provider.',
    defaultModel: '',
  },
}

const PROVIDER_ORDER = ['claude', 'groq', 'gemini', 'ollama', 'custom']

function AIWizard({ currentConfig, onCancel, onSaved }) {
  // Stage: 'pick' (provider selection) or 'setup' (guide + form + test/save)
  const [stage, setStage] = useState(currentConfig?.is_configured ? 'setup' : 'pick')
  const [selected, setSelected] = useState(currentConfig?.provider || 'claude')
  const [presets, setPresets] = useState({})
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAIPresets().then(setPresets).catch(() => {})
  }, [])

  // When the user picks a provider, reset all the form fields to defaults
  // - model defaults to the preset's default, URL defaults to preset's URL,
  // API key is blank (user must enter or echo the existing masked one).
  useEffect(() => {
    const guide = GUIDES[selected] || GUIDES.custom
    const preset = presets[selected] || {}
    // If user is editing the CURRENTLY configured provider, prefill the
    // masked key + actual model so they can verify or tweak without
    // retyping. The PUT endpoint detects the masked echo and preserves
    // the stored key.
    if (currentConfig && currentConfig.provider === selected) {
      setApiKey(currentConfig.api_key_masked || '')
      setBaseUrl(currentConfig.base_url || preset.base_url || '')
      setModel(currentConfig.model || preset.default_model || guide.defaultModel || '')
    } else {
      setApiKey('')
      setBaseUrl(preset.base_url || '')
      setModel(preset.default_model || guide.defaultModel || '')
    }
    setTestResult(null)
    setError('')
  }, [selected, presets, currentConfig])

  const guide = GUIDES[selected] || GUIDES.custom
  const preset = presets[selected] || {}

  function buildConfig() {
    return {
      provider: selected,
      model: model || guide.defaultModel || null,
      base_url: baseUrl || preset.base_url || null,
      api_key: apiKey || null,
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const result = await testAIConfig(buildConfig())
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
      await saveAIConfig(buildConfig())
      // Tell every open page that the AI engine is now (re)configured -
      // Smart Generate flips off its empty state, Suggest Summary + Weekly
      // Roundup buttons un-disable themselves, all without a reload.
      notifyAIConfigChanged()
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Validation: Ollama doesn't need a key. Custom needs both. Masked echo
  // counts as having a key (the server will substitute the real one).
  const keyOK = (selected === 'ollama')
    ? true
    : (apiKey.length > 4 || (apiKey && [...apiKey].every(c => c === '•')))
  const urlOK = guide.urlNeeded ? baseUrl.length > 4 : true
  const canTest = keyOK && urlOK
  const canSave = canTest && testResult?.ok === true

  if (stage === 'pick') {
    return (
      <div className="space-y-3">
        <p className="text-xs text-paper-500 dark:text-paper-600">
          Pick a provider. You can change this any time.
        </p>
        <div className="space-y-1.5">
          {PROVIDER_ORDER.map((key) => {
            const g = GUIDES[key]
            return (
              <button
                key={key}
                onClick={() => { setSelected(key); setStage('setup') }}
                className="
                  w-full text-left rounded-lg border-2 p-3 transition-all
                  border-paper-200 dark:border-pitch-500
                  hover:border-mint dark:hover:border-mint
                  hover:bg-paper-100 dark:hover:bg-pitch-600/40
                "
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 bg-paper-100 dark:bg-pitch-800">
                    {g.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-pitch-800 dark:text-white capitalize">
                        {key === 'gemini' ? 'Google Gemini' : key === 'custom' ? 'Custom / Enterprise' : key}
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-paper-200 dark:bg-pitch-600 text-paper-700 dark:text-paper-300">
                        {g.badge}
                      </span>
                    </div>
                    <div className="text-xs text-paper-500 dark:text-paper-600 mt-0.5 leading-snug">
                      {g.what.split('.')[0]}.
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-paper-400 flex-shrink-0" />
                </div>
              </button>
            )
          })}
        </div>
        <div className="flex justify-end pt-2">
          <button
            onClick={onCancel}
            className="text-xs text-paper-500 hover:text-paper-700 dark:hover:text-paper-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // stage === 'setup'
  return (
    <div className="space-y-4">
      <button
        onClick={() => setStage('pick')}
        className="flex items-center gap-1 text-xs text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
      >
        <ChevronLeft size={12} /> Choose a different provider
      </button>

      {/* What is this */}
      <div className="rounded-lg p-3 bg-paper-100 dark:bg-pitch-800 border-l-4 border-mint">
        <div className="text-[10px] font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
          {guide.icon} {selected === 'gemini' ? 'Google Gemini' : selected === 'custom' ? 'Custom / Enterprise' : selected.charAt(0).toUpperCase() + selected.slice(1)} · {guide.time}
        </div>
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">{guide.what}</div>
      </div>

      {/* Steps */}
      {guide.steps && (
        <div>
          <div className="text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
            {guide.keyLabel ? 'To get your key' : 'To get started'}
          </div>
          <div className="space-y-2">
            {guide.steps.map((s, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-5 h-5 rounded-full bg-mint-700 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
                  {s.text}{' '}
                  {s.link && (
                    <a
                      href={s.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-mint-700 dark:text-mint-300 font-medium hover:underline inline-flex items-center gap-0.5"
                    >
                      {s.link.label}
                      <ExternalLink size={10} />
                    </a>
                  )}
                  {s.suffix && ` ${s.suffix}`}
                  {s.code && (
                    <code className="ml-1 px-1.5 py-0.5 rounded bg-pitch-800 dark:bg-black text-mint-300 text-[11px] font-mono">
                      {s.code}
                    </code>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-paper-200 dark:border-pitch-500" />

      {guide.urlNeeded && (
        <Field
          label={guide.urlLabel || 'Base URL'}
          hint={guide.urlHint}
          value={baseUrl}
          onChange={(v) => { setBaseUrl(v); setTestResult(null) }}
          placeholder={guide.urlPlaceholder}
          type="url"
        />
      )}

      {guide.keyLabel && (
        <Field
          label={guide.keyLabel}
          hint={guide.keyHint}
          value={apiKey}
          onChange={(v) => { setApiKey(v); setTestResult(null) }}
          placeholder={guide.keyPlaceholder}
          type="password"
          autoComplete="off"
        />
      )}

      {guide.modelLabel && (
        <Field
          label={guide.modelLabel}
          hint={guide.modelHint}
          value={model}
          onChange={(v) => { setModel(v); setTestResult(null) }}
          placeholder={guide.defaultModel || 'Model name'}
        />
      )}

      <button
        onClick={handleTest}
        disabled={testing || !canTest}
        className="
          w-full flex items-center justify-center gap-2
          px-4 py-2.5 rounded-lg text-sm font-medium
          border-2 border-mint
          text-mint-700 dark:text-mint-300
          hover:bg-mint-50 dark:hover:bg-mint-900/20
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {testing
          ? (<><Loader2 size={14} className="animate-spin" /> Testing…</>)
          : 'Test connection'
        }
      </button>

      {testResult && (
        <div className={`
          flex items-start gap-2 p-3 rounded-lg text-xs leading-snug
          ${testResult.ok
            ? 'bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 border border-mint/40'
            : 'bg-terracotta/10 dark:bg-terracotta/15 text-terracotta border border-terracotta/30'
          }
        `}>
          {testResult.ok
            ? <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
            : <XCircle size={14} className="flex-shrink-0 mt-0.5" />
          }
          {testResult.message}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 text-xs text-terracotta">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="
            flex-1 flex items-center justify-center gap-2
            px-4 py-2.5 rounded-lg text-sm font-semibold
            bg-mint-700 hover:bg-mint-800
            text-white
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
        >
          {saving
            ? (<><Loader2 size={14} className="animate-spin" /> Saving…</>)
            : 'Save and use this engine'
          }
        </button>
        <button
          onClick={onCancel}
          className="
            px-4 py-2.5 rounded-lg text-sm
            text-paper-700 dark:text-paper-300
            hover:bg-paper-200 dark:hover:bg-pitch-700
            transition-colors
          "
        >
          Cancel
        </button>
      </div>

      {!testResult?.ok && (
        <p className="text-center text-[10px] text-paper-500 dark:text-paper-600">
          Test the connection first to enable Save.
        </p>
      )}
    </div>
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

// ─── Updates ──────────────────────────────────────────────────────────────────

function UpdateSection({ updater }) {
  const version = useAppVersion()
  const hasUpdateBanner = (
    updater?.status === 'available' || updater?.status === 'dismissed'
  ) && updater.available

  return (
    <Card>
      <CardHeader
        icon={Download}
        title="Updates"
        subtitle="Check for and install new versions."
      />

      {/* Available banner - same UX as the toast, just permanently surfaced
          on the settings page. Visible for 'available' AND 'dismissed' so
          the cog → settings path always shows the install option. */}
      {hasUpdateBanner && (
        <div className="
          rounded-lg p-3 mb-4
          bg-mint-50 dark:bg-mint-900/20
          border border-mint/40
        ">
          <div className="flex items-start gap-2 mb-2">
            <Zap size={14} className="flex-shrink-0 mt-0.5 text-mint" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-display uppercase tracking-wide text-mint-700 dark:text-mint-300">
                Update available
              </p>
              <p className="text-sm text-pitch-700 dark:text-paper-300 mt-0.5">
                {updater.available.currentVersion} → <strong>{updater.available.version}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={updater.install}
            className="
              w-full flex items-center justify-center gap-1.5
              px-3 py-2 rounded-md text-xs
              bg-mint-700 hover:bg-mint-800 text-white
              font-display uppercase tracking-wide transition-colors
            "
          >
            <Download size={11} />
            Install &amp; restart
          </button>
        </div>
      )}

      {updater?.status === 'downloading' && (
        <div className="rounded-lg p-3 mb-4 bg-mint-50 dark:bg-mint-900/20 border border-mint/40 flex items-center gap-2">
          <Download size={12} className="text-mint animate-pulse" />
          <p className="text-xs text-pitch-700 dark:text-paper-300">
            Downloading update
            {updater.progress?.contentLength
              ? ` (${Math.round(100 * updater.progress.downloaded / updater.progress.contentLength)}%)`
              : '…'}
          </p>
        </div>
      )}

      {updater?.status === 'error' && (
        <div className="rounded-lg p-3 mb-4 bg-terracotta/10 dark:bg-terracotta/15 border border-terracotta/30 flex items-start gap-2">
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-terracotta" />
          <p className="text-xs text-terracotta leading-snug">
            Update failed: {updater.error}
          </p>
        </div>
      )}

      {/* Current version row. No "Check now" button yet because useUpdater
          doesn't expose a `check()` callback or `lastCheckedAt` timestamp -
          the hook only runs its check once per hour at mount. Extend the
          hook in a future change if we want a manual recheck.
          TODO(updates): wire check-now action once useUpdater exposes it. */}
      {!hasUpdateBanner && (
        <div className="
          flex items-center gap-3 px-3 py-2.5 rounded-lg
          bg-paper-100 dark:bg-pitch-800
          border border-paper-300 dark:border-pitch-500
        ">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-pitch-700 dark:text-paper-300">
              Currently on <strong className="font-medium">v{version || '-'}</strong>
            </p>
            <p className="text-[11px] text-paper-500 dark:text-paper-600 mt-0.5">
              {updater?.status === 'checking'
                ? 'Checking for updates…'
                : updater?.status === 'none'
                  ? 'Up to date.'
                  : "Effro checks for updates automatically at launch."}
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Storage ──────────────────────────────────────────────────────────────────
// Combined card covering both the local data path (Tauri only) and the cloud
// sync row (everyone). Replaces the older Tauri-only DataStorageSection - the
// rows share a card so the user's mental model of "where my data lives" is
// one place to look, not two.

function StorageSection({ id }) {
  // Local data path state
  const [dataDir, setDataDir] = useState(null)
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState('')
  const [restartPending, setRestartPending] = useState(false)

  // Cloud sync state
  const [storageConfig, setStorageConfig] = useState(null)
  const [showStorageModal, setShowStorageModal] = useState(false)

  useEffect(() => {
    if (isTauri()) getDataDir().then(setDataDir)
    getStorageConfig().then(setStorageConfig).catch(() => setStorageConfig(null))
  }, [])

  const handleChangeDataDir = async () => {
    setError('')
    try {
      const chosen = await pickDataDir()
      if (!chosen) return
      setMigrating(true)
      await migrateAndSetDataDir(chosen)
      setDataDir(chosen)
      setRestartPending(true)
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Migration failed. Your data was not moved.')
    } finally {
      setMigrating(false)
    }
  }

  const reloadStorage = () => {
    getStorageConfig().then(setStorageConfig).catch(() => setStorageConfig(null))
  }

  // Format the cloud-sync row's host hint if the server URL is available -
  // strips the protocol so "https://cloud.example.com" reads as "cloud.example.com".
  const displayHost = (() => {
    if (!storageConfig?.is_connected || !storageConfig?.server_url) return null
    try {
      return new URL(storageConfig.server_url).host
    } catch {
      return storageConfig.server_url
    }
  })()

  return (
    <>
      <Card id={id}>
        <CardHeader
          icon={Database}
          title="Storage"
          subtitle="Local data on disk. Encrypted backup and attachments to cloud."
        />

        {/* Local data path - Tauri only. Browser dev hides this row entirely
            because Tauri APIs (folder picker, migration) don't work there. */}
        {isTauri() && (
          <>
            <div className="
              flex items-center gap-3 px-3 py-2.5 rounded-lg
              bg-paper-100 dark:bg-pitch-800
              border border-paper-300 dark:border-pitch-500
            ">
              <FolderOpen size={13} className="flex-shrink-0 text-paper-500 dark:text-paper-600" />
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-mono truncate text-pitch-700 dark:text-paper-300"
                  title={dataDir || ''}
                >
                  {dataDir || '…'}
                </p>
                <p className="text-[11px] text-paper-500 dark:text-paper-600 mt-0.5">
                  Database, settings, attachments
                </p>
              </div>
              <button
                onClick={handleChangeDataDir}
                disabled={migrating}
                className="
                  flex-shrink-0 px-3 py-1.5 rounded-md text-xs
                  text-paper-700 dark:text-paper-300
                  hover:bg-paper-200 dark:hover:bg-pitch-700
                  disabled:opacity-40 transition-colors
                  font-display uppercase tracking-wide
                "
              >
                {migrating ? 'Moving…' : 'Change…'}
              </button>
            </div>

            {error && (
              <div className="mt-2 flex items-start gap-1.5">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5 text-terracotta" />
                <p className="text-xs text-terracotta leading-snug">{error}</p>
              </div>
            )}

            {restartPending && (
              <div className="mt-2 rounded-lg p-3 bg-mustard/10 dark:bg-mustard/15 border border-mustard/30">
                <p className="text-sm text-mustard mb-2 leading-snug">
                  Data moved. Effro needs to restart to use the new location.
                </p>
                <button
                  onClick={relaunch}
                  className="
                    w-full flex items-center justify-center gap-1.5
                    px-3 py-2 rounded-md text-xs
                    bg-amber-500 hover:bg-amber-600 text-white
                    font-display uppercase tracking-wide transition-colors
                  "
                >
                  <RefreshCw size={11} />
                  Restart now
                </button>
              </div>
            )}
          </>
        )}

        {/* Cloud sync row - always rendered (browser + Tauri). Gated by
            is_connected so the same row shows either a connect CTA or a
            connected provider summary. */}
        <div className={`
          flex items-center gap-3 px-3 py-2.5 rounded-lg
          bg-paper-100 dark:bg-pitch-800
          border border-paper-300 dark:border-pitch-500
          ${isTauri() ? 'mt-2' : ''}
        `}>
          {storageConfig?.is_connected ? (
            <span className="w-2 h-2 rounded-full bg-mint flex-shrink-0" aria-label="Connected" />
          ) : (
            <CloudOff size={13} className="flex-shrink-0 text-paper-500 dark:text-paper-600" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-pitch-800 dark:text-white capitalize">
              {storageConfig?.is_connected
                ? `${storageConfig.provider}${displayHost ? ` · ${displayHost}` : ''}`
                : 'No cloud sync'}
            </p>
            {storageConfig?.is_connected && storageConfig.last_backup_at && (
              <p className="text-[11px] text-paper-500 dark:text-paper-600 mt-0.5">
                Backed up {new Date(storageConfig.last_backup_at).toLocaleDateString()}
              </p>
            )}
            {!storageConfig?.is_connected && (
              <p className="text-[11px] text-paper-500 dark:text-paper-600 mt-0.5">
                Encrypted backup, attachment sync
              </p>
            )}
          </div>
          <button
            onClick={() => setShowStorageModal(true)}
            className="
              flex-shrink-0 px-3 py-1.5 rounded-md text-xs
              text-paper-700 dark:text-paper-300
              hover:bg-paper-200 dark:hover:bg-pitch-700
              font-display uppercase tracking-wide transition-colors
            "
          >
            {storageConfig?.is_connected ? 'Manage' : 'Connect'}
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-paper-500 dark:text-paper-600">
          Coming soon - Dropbox · OneDrive · SharePoint
        </p>
      </Card>

      {showStorageModal && (
        <StorageSetupModal
          currentConfig={storageConfig}
          onClose={() => setShowStorageModal(false)}
          onSaved={() => reloadStorage()}
        />
      )}
    </>
  )
}

// ─── Microsoft 365 ────────────────────────────────────────────────────────────

function MicrosoftSection({ id }) {
  return (
    <Card id={id}>
      <CardHeader
        icon={MicrosoftLogo}
        title="Microsoft 365"
        subtitle="Outlook calendar via Signals. Read-only, encrypted tokens."
      />
      <MicrosoftIntegration />
    </Card>
  )
}

// Microsoft 4-square logo. Inline SVG (lucide doesn't ship one) so the card
// header reads instantly as "Microsoft" without dropping back to a generic icon.
function MicrosoftLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flex-shrink-0 mt-1">
      <rect x="1"  y="1"  width="10" height="10" fill="#F25022"/>
      <rect x="13" y="1"  width="10" height="10" fill="#7FBA00"/>
      <rect x="1"  y="13" width="10" height="10" fill="#00A4EF"/>
      <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
    </svg>
  )
}

// ─── Jira ─────────────────────────────────────────────────────────────────────

function JiraSection({ id }) {
  return (
    <Card id={id}>
      <CardHeader
        icon={JiraLogo}
        title="Jira"
        subtitle="Assigned issues, mentions, and current sprint via Signals. Read-only."
      />
      <JiraIntegration />
    </Card>
  )
}

function JiraLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="flex-shrink-0 mt-1">
      <path d="M15.975 2L8 17.05l4.975 5.563L19.95 14.1 15.975 2z" fill="#2684FF"/>
      <path d="M15.975 2L12 14.1l3.975 8.513L23.95 9.563 15.975 2z" fill="url(#jira-a)"/>
      <path d="M15.975 30L24 14.95l-4.975-5.563L12.05 17.9 15.975 30z" fill="#2684FF"/>
      <path d="M15.975 30L19.95 17.9l-3.975-8.513L8.05 22.437 15.975 30z" fill="url(#jira-b)"/>
      <defs>
        <linearGradient id="jira-a" x1="15.975" y1="8" x2="21" y2="14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0052CC"/>
          <stop offset="1" stopColor="#2684FF"/>
        </linearGradient>
        <linearGradient id="jira-b" x1="15.975" y1="24" x2="11" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0052CC"/>
          <stop offset="1" stopColor="#2684FF"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

// ─── Google ───────────────────────────────────────────────────────────────────

function GoogleSection({ id }) {
  return (
    <Card id={id}>
      <CardHeader
        icon={GoogleLogo}
        title="Google Docs"
        subtitle="Attach Docs from Drive, ingest text, and export to Docs."
      />
      <GoogleIntegration />
    </Card>
  )
}

function GoogleLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="flex-shrink-0 mt-1">
      <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3a7.2 7.2 0 0 1-10.74-3.78H1.34v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.33 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l3.99-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.99 11.99 0 0 0 1.34 6.6l3.99 3.09A7.2 7.2 0 0 1 12 4.75Z" />
    </svg>
  )
}

// ─── About ────────────────────────────────────────────────────────────────────

function AboutSection() {
  const version = useAppVersion()
  return (
    <Card>
      <CardHeader icon={SettingsIcon} title="About" />
      <dl className="space-y-2 text-sm">
        <Row label="Version" value={version ? `v${version}` : '-'} />
        <Row
          label="Web"
          value={
            <a
              href="https://effro.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mint-700 dark:text-mint-300 hover:underline"
            >
              effro.io ↗
            </a>
          }
        />
        <Row
          label="What's new"
          value={
            <a
              href="https://github.com/Effroapp/effro/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mint-700 dark:text-mint-300 hover:underline"
            >
              Release notes ↗
            </a>
          }
        />
        <Row
          label="Source"
          value={
            <a
              href="https://github.com/Effroapp/effro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mint-700 dark:text-mint-300 hover:underline"
            >
              github.com/Effroapp/effro ↗
            </a>
          }
        />
        <Row label="Made by" value="LKEOGH QA LTD" />
      </dl>
    </Card>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-paper-500 dark:text-paper-600">{label}</dt>
      <dd className="font-mono text-pitch-700 dark:text-paper-300">{value}</dd>
    </div>
  )
}

// ─── Layout primitives ────────────────────────────────────────────────────────

function Card({ children, id }) {
  return (
    <section
      id={id}
      className="
        rounded-xl border p-5
        bg-white dark:bg-pitch-700
        border-paper-300 dark:border-pitch-500
        ring-offset-paper-100 dark:ring-offset-pitch-800
        transition-shadow duration-300
        scroll-mt-24
      "
    >
      {children}
    </section>
  )
}

function CardHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <Icon size={16} className="flex-shrink-0 mt-1 text-paper-500 dark:text-paper-600" />
      <div className="flex-1 min-w-0">
        <h2 className="font-display font-medium text-base text-pitch-800 dark:text-white leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-paper-500 dark:text-paper-600 mt-1 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}

