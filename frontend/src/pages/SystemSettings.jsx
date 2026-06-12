import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Settings as SettingsIcon, ArrowLeft, Cpu, FolderOpen, RefreshCw,
  AlertCircle, Download, Zap, ChevronRight, ChevronLeft,
  CheckCircle2, XCircle, Loader2, ExternalLink,
  Database, CloudOff, Plug, Info, Users, ShieldCheck, Sparkles, KeyRound,
} from 'lucide-react'
import {
  isTauri,
  getDataDir,
  pickDataDir,
  migrateAndSetDataDir,
  relaunch,
  openExternal,
} from '../api/tauri'
import {
  getAIConfig, getAIPresets, saveAIConfig, testAIConfig,
} from '../api/settings'
import { getStorageConfig } from '../api/storage'
import StorageSetupModal from '../components/StorageSetupModal'
import IntroPanel, { Key } from '../components/IntroPanel'
import IntegrationsPanel from '../components/IntegrationsPanel'
import PostConnectFlow from '../components/PostConnectFlow'
import ProviderLogo from '../components/ProviderLogos'
import { syncNow as msSyncNow } from '../api/microsoft'
import { syncNow as googleSyncNow } from '../api/google'
import { jiraSyncNow } from '../api/jira'
import { useAppVersion } from '../hooks/useAppVersion'
import { notifyAIConfigChanged } from '../hooks/useAIConfigured'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { adminApi } from '../api/client'
import UsersSection from '../components/UsersSection'
import AccountSection from '../components/AccountSection'

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
// The four settings categories. Each has a one-line explainer so the
// distinction between them (especially Storage vs Integrations) is always
// on screen. Tabs mirror the Insights page for a consistent feel.
const SETTINGS_TABS = [
  {
    key: 'ai', label: 'AI', Icon: Cpu, introTitle: 'The AI engine',
    body: (
      <>
        The brain behind smart capture, summaries and gentle suggestions, running on your{' '}
        <Key>own API key</Key>. You choose the <Key>provider</Key>, the <Key>model</Key>, the cost,
        and where your prompts go. Nothing is forced on you, and your key and data never route through us.
      </>
    ),
  },
  {
    key: 'storage', label: 'Storage', Icon: Database, introTitle: 'Storage',
    body: (
      <>
        Where your data lives day to day, and where it is backed up. Keep it{' '}
        <Key>somewhere you choose</Key>, with <Key>encrypted backups</Key> you can restore anywhere.
        Your data is yours: Effro never reads your files or your backups.
      </>
    ),
  },
  {
    key: 'integrations', label: 'Integrations', Icon: Plug, introTitle: 'Integrations',
    body: (
      <>
        The apps you already work in: <Key>calendar, email, Jira, GitHub</Key> and more. Their meetings,
        flagged emails and assigned issues flow in as <Key>work items</Key>, filed by area.
        We sit alongside your tools, never replacing them.
      </>
    ),
  },
  {
    key: 'about', label: 'About', Icon: Info,
    intro: 'App version, updates, and links.',
  },
]

// Shown only to admins on an auth-enabled (hosted/team) instance - never on the
// single-user desktop build, where the synthetic local admin has nobody to manage.
const USERS_TAB = {
  key: 'users', label: 'Users', Icon: Users,
  intro: 'Invite teammates and manage their access. Admins only.',
}

// Personal account settings, shown to any signed-in user when auth is on.
const ACCOUNT_TAB = {
  key: 'account', label: 'Account', Icon: ShieldCheck,
  intro: 'Your password, active sessions, and your data.',
}

// Licence status + renewal, shown to admins only when a licence is required
// (hosted enterprise deployments) - never on the desktop build.
const LICENCE_TAB = {
  key: 'licence', label: 'Licence', Icon: KeyRound,
  intro: 'Your edition, seats, expiry, and renewal. Admins only.',
}

export default function SystemSettings({ updater }) {
  const { user } = useAuth()
  const showUsers = user?.role === 'admin' && user?.auth_enabled
  const showAccount = !!user?.auth_enabled
  const showLicence = user?.role === 'admin' && !!user?.licence?.licence_required
  // Keep About last; slot Users (admin), Account, then Licence before it.
  const tabs = [
    ...SETTINGS_TABS.filter((t) => t.key !== 'about'),
    ...(showUsers ? [USERS_TAB] : []),
    ...(showAccount ? [ACCOUNT_TAB] : []),
    ...(showLicence ? [LICENCE_TAB] : []),
    ...SETTINGS_TABS.filter((t) => t.key === 'about'),
  ]
  const [tab, setTab] = useState('ai')
  // A just-finished OAuth connection (provider redirected back) - drives the
  // post-connect flow: celebration, first-sync invitation, go to Signals.
  const [postConnect, setPostConnect] = useState(null)
  const active = tabs.find((t) => t.key === tab) || tabs[0]

  // Land on the right tab after an OAuth round-trip back to /settings, and
  // greet a successful connection with the post-connect flow.
  useEffect(() => {
    const s = window.location.search
    const tabParam = new URLSearchParams(s).get('tab')
    if (tabParam) setTab(tabParam)
    else if (/dropbox_(connected|error)/.test(s)) setTab('storage')
    else if (/(google|ms|jira)_(connected|error)/.test(s)) setTab('integrations')
    const m = s.match(/(google|ms|jira)_connected/)
    if (m) {
      const flows = {
        google: { providerKey: 'google', providerName: 'Google', providerLogo: 'google', syncNow: googleSyncNow },
        ms: { providerKey: 'microsoft', providerName: 'Microsoft 365', providerLogo: 'microsoft', syncNow: msSyncNow },
        jira: { providerKey: 'jira', providerName: 'Jira', providerLogo: 'jira', syncNow: jiraSyncNow },
      }
      setPostConnect(flows[m[1]])
    }
  }, [])

  const closePostConnect = () => {
    setPostConnect(null)
    // Drop the ?x_connected param so a refresh doesn't re-celebrate.
    window.history.replaceState({}, '', '/settings?tab=integrations')
  }

  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800">
      {postConnect && (
        <PostConnectFlow standalone {...postConnect} onClose={closePostConnect} />
      )}
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

      <main className="max-w-5xl mx-auto px-8 py-8">
        <SettingsTabs tabs={tabs} tab={tab} onChange={setTab} />
        {active.body
          ? <IntroPanel icon={active.Icon} title={active.introTitle || active.label} storageKey={`effro.introPanel.${active.key}`}>{active.body}</IntroPanel>
          : <p className="text-sm text-paper-500 dark:text-paper-500 mb-5 leading-relaxed">{active.intro}</p>}

        <div className="space-y-6 animate-rise motion-reduce:animate-none" key={tab}>
          {tab === 'ai' && <AISection />}
          {tab === 'storage' && <StorageSection />}
          {tab === 'integrations' && <IntegrationsPanel />}
          {tab === 'users' && <UsersSection />}
          {tab === 'account' && <AccountSection />}
          {tab === 'licence' && <LicenceSection />}
          {tab === 'about' && (
            <>
              {isTauri() && <UpdateSection updater={updater} />}
              {user?.demo_available && <DemoDataSection />}
              <AboutSection />
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function SettingsTabs({ tabs, tab, onChange }) {
  return (
    <div className="flex items-stretch gap-1 p-1 mb-4 rounded-lg bg-paper-200 dark:bg-pitch-700/60 border border-paper-300 dark:border-pitch-500">
      {tabs.map(({ key, label, Icon }) => {
        const active = tab === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
              active
                ? 'bg-white dark:bg-pitch-800 shadow-sm text-pitch-800 dark:text-white'
                : 'text-paper-600 dark:text-paper-400 hover:text-pitch-700 dark:hover:text-paper-200 hover:bg-paper-100/60 dark:hover:bg-pitch-800/40'
            }`}
          >
            <Icon size={15} className={active ? 'text-mint-600 dark:text-mint-400' : 'text-paper-500 dark:text-paper-600'} />
            {label}
          </button>
        )
      })}
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
          <p className="text-2xs font-mono text-paper-500 dark:text-paper-600 mt-0.5 truncate">
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
                      <span className="text-2xs font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-paper-200 dark:bg-pitch-600 text-paper-700 dark:text-paper-300">
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
        <div className="text-2xs font-display uppercase tracking-widest text-mint-700 dark:text-mint-300 mb-1">
          {guide.icon} {selected === 'gemini' ? 'Google Gemini' : selected === 'custom' ? 'Custom / Enterprise' : selected.charAt(0).toUpperCase() + selected.slice(1)} · {guide.time}
        </div>
        <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">{guide.what}</div>
      </div>

      {/* Steps */}
      {guide.steps && (
        <div>
          <div className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
            {guide.keyLabel ? 'To get your key' : 'To get started'}
          </div>
          <div className="space-y-2">
            {guide.steps.map((s, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-5 h-5 rounded-full bg-mint-700 text-white text-2xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
                  {s.text}{' '}
                  {s.link && (
                    <a
                      href={s.link.url}
                      onClick={(e) => { e.preventDefault(); openExternal(s.link.url) }}
                      className="text-mint-700 dark:text-mint-300 font-medium hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      {s.link.label}
                      <ExternalLink size={10} />
                    </a>
                  )}
                  {s.suffix && ` ${s.suffix}`}
                  {s.code && (
                    <code className="ml-1 px-1.5 py-0.5 rounded bg-pitch-800 dark:bg-black text-mint-300 text-2xs font-mono">
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
        <p className="text-center text-2xs text-paper-500 dark:text-paper-600">
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
        <p className="mt-1 text-2xs text-paper-500 dark:text-paper-600">{hint}</p>
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
            <p className="text-2xs text-paper-500 dark:text-paper-600 mt-0.5">
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
  const [modalInitialProvider, setModalInitialProvider] = useState(null)

  useEffect(() => {
    if (isTauri()) getDataDir().then(setDataDir)
    getStorageConfig().then(setStorageConfig).catch(() => setStorageConfig(null))
    // Returning from a Dropbox OAuth redirect: reopen the modal at the Dropbox
    // step so the user can finish (pick a folder + save).
    const params = new URLSearchParams(window.location.search)
    if (params.get('dropbox_connected') === 'true' || params.get('dropbox_error')) {
      setModalInitialProvider('dropbox')
      setShowStorageModal(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
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

  const openStorage = (provider) => { setModalInitialProvider(provider || null); setShowStorageModal(true) }
  const STORAGE_OPTIONS = [
    { key: 'nextcloud', name: 'Nextcloud' }, { key: 'google_drive', name: 'Google Drive' },
    { key: 'dropbox', name: 'Dropbox' }, { key: 's3', name: 'S3' }, { key: 'webdav', name: 'WebDAV' },
    { key: 'onedrive', name: 'OneDrive', soon: true }, { key: 'sharepoint', name: 'SharePoint', soon: true },
  ]

  return (
    <>
      {/* All options - icon row */}
      <div className="mb-4">
        <div className="font-mono uppercase tracking-widest text-2xs text-paper-500 dark:text-paper-600 mb-2">All storage</div>
        <div className="flex flex-wrap gap-2">
          {STORAGE_OPTIONS.map((o) => {
            const active = storageConfig?.provider === o.key
            return (
              <button
                key={o.key}
                onClick={() => !o.soon && openStorage(o.key)}
                disabled={o.soon}
                title={o.soon ? `${o.name} (coming with Microsoft 365)` : o.name}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                  o.soon
                    ? 'border-dashed border-paper-200 dark:border-pitch-600 opacity-50 cursor-not-allowed'
                    : active
                      ? 'border-mint/50 bg-mint/5'
                      : 'border-paper-300 dark:border-pitch-500 bg-paper-100 dark:bg-pitch-800 hover:border-mint dark:hover:border-mint hover:-translate-y-0.5'
                }`}
              >
                <ProviderLogo provider={o.key} size={18} />
                <span className="text-sm text-pitch-700 dark:text-paper-200">{o.name}</span>
                {active && <CheckCircle2 size={12} className="text-mint-600 dark:text-mint-400" />}
              </button>
            )
          })}
        </div>
      </div>

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
                <p className="text-2xs text-paper-500 dark:text-paper-600 mt-0.5">
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
              <p className="text-2xs text-paper-500 dark:text-paper-600 mt-0.5">
                Backed up {new Date(storageConfig.last_backup_at).toLocaleDateString()}
              </p>
            )}
            {!storageConfig?.is_connected && (
              <p className="text-2xs text-paper-500 dark:text-paper-600 mt-0.5">
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

        <p className="mt-3 text-center text-2xs text-paper-500 dark:text-paper-600">
          Coming soon - Dropbox · OneDrive · SharePoint
        </p>
      </Card>

      {showStorageModal && (
        <StorageSetupModal
          currentConfig={storageConfig}
          initialProvider={modalInitialProvider}
          onClose={() => { setShowStorageModal(false); setModalInitialProvider(null) }}
          onSaved={() => reloadStorage()}
        />
      )}
    </>
  )
}

// ─── Licence (admins, licence-required deployments only) ─────────────────────

function LicenceSection() {
  const toast = useToast()
  const [lic, setLic] = useState(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => adminApi.getLicence().then(setLic).catch(() => {})
  useEffect(() => { load() }, [])

  const apply = async () => {
    if (!key.trim()) return
    setSaving(true)
    setError('')
    try {
      const next = await adminApi.saveLicence(key.trim())
      setLic(next)
      setKey('')
      toast('Licence updated.')
      // The capabilities on /auth/me changed too; a reload picks them up app-wide.
      setTimeout(() => window.location.reload(), 700)
    } catch (e) {
      setError(e.message || 'That key could not be applied.')
      setSaving(false)
    }
  }

  const stateCopy = {
    valid: 'Active',
    grace: 'Expired, in the renewal window',
    read_only: 'Read-only (expired or invalid)',
  }

  return (
    <Card>
      <CardHeader
        icon={KeyRound}
        title="Licence"
        subtitle="Your edition, seats and expiry. Paste a renewal key to update in place."
      />
      {lic ? (
        <dl className="space-y-2 text-sm mb-5">
          <Row label="Edition" value={lic.edition === 'enterprise' ? 'Enterprise' : 'Pro'} />
          {lic.customer_name && <Row label="Licensed to" value={lic.customer_name} />}
          <Row
            label="Seats"
            value={lic.seats == null ? 'Unlimited' : `${lic.seats_used} of ${lic.seats} in use`}
          />
          <Row
            label="Expires"
            value={
              lic.expires_at
                ? `${lic.expires_at}${lic.days_remaining != null && lic.days_remaining >= 0 ? ` (${lic.days_remaining} days)` : ''}`
                : 'No expiry'
            }
          />
          <Row label="Status" value={stateCopy[lic.state] || lic.state} />
        </dl>
      ) : (
        <p className="text-sm text-paper-500 dark:text-paper-600 mb-5">Loading licence…</p>
      )}

      {lic?.state === 'grace' && (
        <div className="rounded-lg p-3 mb-4 bg-amber-muted/10 border border-amber-muted/40 text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          The licence has expired but everything still works. Renew soon to avoid
          the workspace becoming read-only.
        </div>
      )}
      {lic?.state === 'read_only' && (
        <div className="rounded-lg p-3 mb-4 bg-terracotta/10 border border-terracotta/40 text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          The workspace is read-only. Paste a renewal key below and it returns to
          normal immediately. Reading and exporting your data always works.
        </div>
      )}
      {lic?.seat_state === 'over_seat' && (
        <div className="rounded-lg p-3 mb-4 bg-amber-muted/10 border border-amber-muted/40 text-xs text-pitch-700 dark:text-paper-300 leading-relaxed">
          There are more active users ({lic.seats_used}) than seats ({lic.seats}).
          Everyone keeps working; adding or reactivating people is paused until you
          deactivate {lic.seats_used - lic.seats} {lic.seats_used - lic.seats === 1 ? 'person' : 'people'} or renew with more seats.
        </div>
      )}

      <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
        Renewal key
      </label>
      <textarea
        value={key}
        onChange={(e) => setKey(e.target.value)}
        rows={3}
        placeholder="effro-lic-v1."
        spellCheck={false}
        className="
          w-full px-3 py-2 text-xs font-mono rounded-lg resize-y
          bg-paper-100 dark:bg-pitch-800
          border border-paper-300 dark:border-pitch-500
          text-pitch-800 dark:text-white
          placeholder:text-paper-400 dark:placeholder:text-paper-700
          focus:outline-none focus:ring-2 focus:ring-mint-500
        "
      />
      {error && (
        <p className="text-sm text-terracotta mt-2" role="alert">{error}</p>
      )}
      <button
        onClick={apply}
        disabled={saving || !key.trim()}
        className="
          mt-3 flex items-center justify-center gap-2
          px-4 py-2.5 rounded-lg text-sm font-semibold
          bg-mint-700 hover:bg-mint-800 text-white
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors
        "
      >
        {saving ? (<><Loader2 size={14} className="animate-spin" /> Applying…</>) : 'Apply key'}
      </button>
    </Card>
  )
}

// ─── Demo data (showcase only) ────────────────────────────────────────────────
// Only rendered when /auth/me reports demo_available (admin on an empty or
// already-demo instance), so it can never appear where it could clobber real
// work. The matching server guard lives in routers/admin.load_demo_data.

function DemoDataSection() {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    try {
      const r = await adminApi.loadDemoData()
      toast(`Demo data loaded (${r.areas} areas, ${r.entries} entries). Refreshing…`)
      setTimeout(() => window.location.reload(), 700)
    } catch (e) {
      toast(e.message || 'Could not load the demo data', 'error')
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <Card>
      <CardHeader
        icon={Sparkles}
        title="Demo data"
        subtitle="Fill this instance with a realistic sample workspace for showing Effro to others."
      />
      <p className="text-sm text-paper-600 dark:text-paper-400 mb-4 leading-relaxed">
        Loads one coherent example: a few areas, threads, to-dos, meetings, signals to triage and a
        working rhythm, all dated around today so Insights looks alive. It only appears on an empty
        or demo instance, so it cannot overwrite real work, and it leaves users, settings and
        sign-in untouched. Run it again any time to refresh the dates.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="
            flex items-center justify-center gap-2
            px-4 py-2.5 rounded-lg text-sm font-semibold
            bg-mint-700 hover:bg-mint-800 text-white transition-colors
          "
        >
          <Sparkles size={14} />
          Load demo data
        </button>
      ) : (
        <div className="rounded-lg p-4 bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
          <p className="text-sm text-pitch-700 dark:text-paper-300 mb-3 leading-relaxed">
            This replaces everything currently in this instance with the demo dataset. Continue?
          </p>
          <div className="flex gap-2">
            <button
              onClick={load}
              disabled={busy}
              className="
                flex items-center justify-center gap-2
                px-4 py-2.5 rounded-lg text-sm font-semibold
                bg-mint-700 hover:bg-mint-800 text-white
                disabled:opacity-40 disabled:cursor-not-allowed transition-colors
              "
            >
              {busy
                ? (<><Loader2 size={14} className="animate-spin" /> Loading…</>)
                : 'Yes, load demo data'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="
                px-4 py-2.5 rounded-lg text-sm
                text-paper-700 dark:text-paper-300
                hover:bg-paper-200 dark:hover:bg-pitch-700
                disabled:opacity-40 transition-colors
              "
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
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
              onClick={(e) => { e.preventDefault(); openExternal('https://effro.io') }}
              className="text-mint-700 dark:text-mint-300 hover:underline cursor-pointer"
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
              onClick={(e) => { e.preventDefault(); openExternal('https://github.com/Effroapp/effro/releases') }}
              className="text-mint-700 dark:text-mint-300 hover:underline cursor-pointer"
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
              onClick={(e) => { e.preventDefault(); openExternal('https://github.com/Effroapp/effro') }}
              className="text-mint-700 dark:text-mint-300 hover:underline cursor-pointer"
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

