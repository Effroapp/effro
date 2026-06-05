import { useState, useEffect } from 'react'
import { Cpu, Cloud, Github, KanbanSquare, Plus, Check, Clock } from 'lucide-react'
import { getStorageConfig } from '../api/storage'
import { getMicrosoftProfile } from '../api/microsoft'
import { getJiraProfile } from '../api/jira'
import { getGoogleProfile } from '../api/google'
import { useAIConfigured } from '../hooks/useAIConfigured'

/**
 * Integrations Hub - the icon-tile directory at the top of Settings.
 *
 * Two goals:
 *   1. Give the user a single place to see WHAT they can connect Trace to,
 *      not a stack of unrelated cards scattered through Settings.
 *   2. Make every tile a clickable shortcut to the relevant setup flow -
 *      live integrations smooth-scroll-and-pulse the existing detail card
 *      below; planned ones briefly expand a "Coming in vX.Y" note.
 *
 * Adding a new integration here is data-only - append to the INTEGRATIONS
 * array. Wiring the actual setup happens in the matching detail card below
 * (with a matching `id` for the scroll target).
 */

// ─── Microsoft 4-square logo (lucide doesn't ship one) ──────────────────────
function MicrosoftLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1"  y="1"  width="10" height="10" fill="#F25022"/>
      <rect x="13" y="1"  width="10" height="10" fill="#7FBA00"/>
      <rect x="1"  y="13" width="10" height="10" fill="#00A4EF"/>
      <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
    </svg>
  )
}

// ─── Google multi-colour logo ───────────────────────────────────────────────
function GoogleLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3a7.2 7.2 0 0 1-10.74-3.78H1.34v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.33 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l3.99-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.99 11.99 0 0 0 1.34 6.6l3.99 3.09A7.2 7.2 0 0 1 12 4.75Z" />
    </svg>
  )
}

// status: 'connected' | 'unconfigured' | 'coming-soon'
const INTEGRATIONS = [
  {
    key: 'ai',
    name: 'AI Engine',
    tagline: 'Smart capture, summaries, suggestions',
    iconKey: 'cpu',
    sectionId: 'integration-ai',
    statusFn: (state) => state.aiConfigured ? 'connected' : 'unconfigured',
  },
  {
    key: 'storage',
    name: 'Cloud Storage',
    tagline: 'Encrypted backup, attachment sync',
    iconKey: 'cloud',
    sectionId: 'integration-storage',
    statusFn: (state) => state.storageConnected ? 'connected' : 'unconfigured',
  },
  {
    key: 'microsoft',
    name: 'Microsoft 365',
    tagline: 'Outlook calendar via Signals',
    iconKey: 'microsoft',
    sectionId: 'integration-microsoft',
    statusFn: (state) => state.microsoftConnected ? 'connected' : 'unconfigured',
  },
  {
    key: 'jira',
    name: 'Jira',
    tagline: 'Assigned, mentioned, sprint issues',
    iconKey: 'kanban',
    sectionId: 'integration-jira',
    statusFn: (state) => state.jiraConnected ? 'connected' : 'unconfigured',
  },
  {
    key: 'google',
    name: 'Google Docs',
    tagline: 'Docs as signals, attach, ingest, export',
    iconKey: 'google',
    sectionId: 'integration-google',
    statusFn: (state) => state.googleConnected ? 'connected' : 'unconfigured',
  },
  {
    key: 'github',
    name: 'GitHub',
    tagline: 'PR review requests, mentions',
    iconKey: 'github',
    sectionId: null,
    statusFn: () => 'coming-soon',
    comingIn: 'planned',
    learnMoreUrl: 'https://github.com/Effroapp/effro/issues',
  },
  {
    key: 'request',
    name: 'Suggest one',
    tagline: 'Open an issue and we will look at it',
    iconKey: 'plus',
    sectionId: null,
    statusFn: () => 'request',
    learnMoreUrl: 'https://github.com/Effroapp/effro/issues/new',
  },
]

// Lucide icon by key, kept as a tiny lookup so the data array stays serialisable.
function Icon({ which, size = 18 }) {
  switch (which) {
    case 'cpu':       return <Cpu size={size} />
    case 'cloud':     return <Cloud size={size} />
    case 'microsoft': return <MicrosoftLogo size={size} />
    case 'google':    return <GoogleLogo size={size} />
    case 'github':    return <Github size={size} />
    case 'kanban':    return <KanbanSquare size={size} />
    case 'plus':      return <Plus size={size} />
    default:          return null
  }
}

export default function IntegrationsHub() {
  // Each tile reads from independent state slots so a slow Storage probe
  // doesn't block the AI tile from rendering its real status. The AI hook
  // is global + event-driven, so saving the wizard below flips this tile's
  // pill from "set up" → "live" without a refetch here.
  const { configured: aiConfigured } = useAIConfigured()
  const [storageConnected, setStorageConnected] = useState(false)
  const [microsoftConnected, setMicrosoftConnected] = useState(false)
  const [jiraConnected, setJiraConnected] = useState(false)
  const [googleConnected, setGoogleConnected] = useState(false)

  useEffect(() => {
    getStorageConfig()
      .then((c) => setStorageConnected(Boolean(c?.is_connected)))
      .catch(() => setStorageConnected(false))
    getMicrosoftProfile()
      .then((p) => setMicrosoftConnected(Boolean(p?.connected)))
      .catch(() => setMicrosoftConnected(false))
    getJiraProfile()
      .then((p) => setJiraConnected(Boolean(p?.connected)))
      .catch(() => setJiraConnected(false))
    getGoogleProfile()
      .then((p) => setGoogleConnected(Boolean(p?.connected)))
      .catch(() => setGoogleConnected(false))
  }, [])

  const state = {
    aiConfigured: aiConfigured === true,
    storageConnected,
    microsoftConnected,
    jiraConnected,
    googleConnected,
  }

  return (
    <section className="
      rounded-xl border p-5
      bg-white dark:bg-pitch-700
      border-paper-300 dark:border-pitch-500
    ">
      <div className="mb-4">
        <h2 className="font-display font-medium text-base text-pitch-800 dark:text-white leading-tight">
          Integrations
        </h2>
        <p className="text-xs text-paper-500 dark:text-paper-600 mt-1 leading-snug">
          Connect Effro to the tools you already use. Pick one to set it up.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {INTEGRATIONS.map((integration) => (
          <Tile
            key={integration.key}
            integration={integration}
            status={integration.statusFn(state)}
          />
        ))}
      </div>
    </section>
  )
}

// ─── Tile ────────────────────────────────────────────────────────────────────

function Tile({ integration, status }) {
  const [expanded, setExpanded] = useState(false)

  const handleClick = () => {
    if (integration.sectionId) {
      // Scroll-and-pulse to the matching detail card below. Reuses the same
      // visual pattern Insights uses for ?entry= deep-links.
      const el = document.getElementById(integration.sectionId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('ring-2', 'ring-mint', 'ring-offset-2', 'dark:ring-offset-pitch-800')
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-mint', 'ring-offset-2', 'dark:ring-offset-pitch-800')
        }, 1800)
      }
      return
    }
    // Coming soon / request → toggle the inline note.
    setExpanded((v) => !v)
  }

  // Visual treatment per status.
  const isComingSoon = status === 'coming-soon'
  const isRequest = status === 'request'

  return (
    <div>
      <button
        onClick={handleClick}
        className={`
          group relative w-full text-left
          rounded-lg p-3.5
          border transition-all
          ${isComingSoon
            ? 'bg-paper-100/60 dark:bg-pitch-800/50 border-paper-200 dark:border-pitch-600 hover:border-paper-400 dark:hover:border-pitch-500'
            : isRequest
              ? 'bg-paper-100/40 dark:bg-pitch-800/30 border-dashed border-paper-300 dark:border-pitch-600 hover:border-mint dark:hover:border-mint hover:bg-paper-100 dark:hover:bg-pitch-700/50'
              : 'bg-paper-100 dark:bg-pitch-800 border-paper-300 dark:border-pitch-500 hover:border-mint dark:hover:border-mint hover:-translate-y-0.5'
          }
        `}
      >
        <div className="flex items-start gap-3">
          <div className={`
            flex items-center justify-center w-9 h-9 rounded-md flex-shrink-0
            ${isComingSoon
              ? 'bg-paper-200/50 dark:bg-pitch-700/50 text-paper-500 dark:text-paper-600'
              : isRequest
                ? 'bg-paper-200/30 dark:bg-pitch-700/30 text-paper-500 dark:text-paper-600'
                : 'bg-paper-200 dark:bg-pitch-700 text-pitch-700 dark:text-paper-200'
            }
          `}>
            <Icon which={integration.iconKey} size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`
                text-sm font-medium truncate
                ${isComingSoon || isRequest
                  ? 'text-paper-600 dark:text-paper-400'
                  : 'text-pitch-800 dark:text-white'}
              `}>
                {integration.name}
              </p>
              <StatusPill status={status} comingIn={integration.comingIn} />
            </div>
            <p className="text-[11px] text-paper-500 dark:text-paper-600 mt-0.5 leading-snug">
              {integration.tagline}
            </p>
          </div>
        </div>
      </button>

      {/* Inline expansion for "coming soon" / "request" tiles. Live integrations
          (sectionId set) scroll instead of expand, so this never fires for them. */}
      {expanded && !integration.sectionId && (
        <div className="
          mt-1.5 rounded-md p-2.5
          bg-paper-100 dark:bg-pitch-800/60
          border border-paper-200 dark:border-pitch-600
        ">
          {isRequest ? (
            <p className="text-[11px] text-pitch-700 dark:text-paper-300 leading-snug">
              Want Effro to integrate with something specific?{' '}
              <a
                href={integration.learnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-mint-700 dark:text-mint-300 font-medium hover:underline"
              >
                Open an issue
              </a>
              {' '}with the tool's name and the use case.
            </p>
          ) : (
            <p className="text-[11px] text-pitch-700 dark:text-paper-300 leading-snug">
              {integration.comingIn === 'v0.6.0'
                ? 'Shipping next as part of the Signals release.'
                : 'On the roadmap.'}
              {' '}
              <a
                href={integration.learnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-mint-700 dark:text-mint-300 font-medium hover:underline"
              >
                Track it on GitHub
              </a>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status, comingIn }) {
  if (status === 'connected') {
    return (
      <span className="
        inline-flex items-center gap-0.5
        text-[9px] font-mono uppercase tracking-wider
        text-mint-700 dark:text-mint-300
        flex-shrink-0
      ">
        <Check size={9} strokeWidth={3} /> live
      </span>
    )
  }
  if (status === 'unconfigured') {
    return (
      <span className="
        inline-flex items-center
        text-[9px] font-mono uppercase tracking-wider
        text-mustard
        flex-shrink-0
      ">
        set up
      </span>
    )
  }
  if (status === 'coming-soon') {
    return (
      <span className="
        inline-flex items-center gap-0.5
        text-[9px] font-mono uppercase tracking-wider
        text-paper-500 dark:text-paper-600
        flex-shrink-0
      ">
        <Clock size={9} /> {comingIn || 'soon'}
      </span>
    )
  }
  return null
}
