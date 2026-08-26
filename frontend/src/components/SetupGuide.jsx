import { useState } from 'react'
import { X, ExternalLink, Copy, Check, ChevronLeft, ChevronRight, Clock, Mail } from 'lucide-react'
import { openExternal } from '../api/tauri'

/**
 * In-app setup walkthrough. Replaces "go read this .md on GitHub" with a calm,
 * one-step-at-a-time guided flow that lives inside Effro. The exact values that
 * people fumble (callback URLs, OAuth scopes) are copy-to-clipboard chips, since
 * a mistyped callback is the single most common connection failure.
 *
 * A guide is plain data (see AZURE_GUIDE / JIRA_GUIDE below):
 *   { title, logo, accent, estMinutes, intro, steps: [
 *       { title, body, link?: {label, href}, copies?: [{label, value}] }
 *   ] }
 */
export default function SetupGuide({ guide, open, onClose }) {
  const [i, setI] = useState(0)
  if (!open || !guide) return null
  const steps = guide.steps
  const step = steps[i]
  const last = i === steps.length - 1
  const first = i === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-pitch-900/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-paper-200 dark:border-pitch-600">
          {guide.logo && <span className="flex-shrink-0 mt-0.5">{guide.logo}</span>}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-pitch-800 dark:text-white leading-tight">{guide.title}</h2>
            <p className="flex items-center gap-1.5 text-2xs font-mono text-paper-500 dark:text-paper-600 mt-1">
              <Clock size={11} /> About {guide.estMinutes} minute{guide.estMinutes === 1 ? '' : 's'}, one time only
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close setup guide"
            className="p-1 -mr-1 rounded text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-1.5">
            {steps.map((_, n) => (
              <span
                key={n}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  n <= i ? 'bg-mint-500' : 'bg-paper-200 dark:bg-pitch-600'
                }`}
              />
            ))}
          </div>
          <p className="eyebrow mt-2 text-paper-500 dark:text-paper-600">
            Step {i + 1} of {steps.length}
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {i === 0 && guide.intro && (
            <p className="text-sm text-paper-600 dark:text-paper-300 leading-relaxed mb-4">{guide.intro}</p>
          )}
          <h3 className="text-sm font-semibold text-pitch-800 dark:text-white mb-2">{step.title}</h3>
          <div className="text-sm text-paper-600 dark:text-paper-300 leading-relaxed space-y-2">
            {step.body}
          </div>

          {step.link && (
            <button
              type="button"
              onClick={() => openExternal(step.link.href)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 text-pitch-700 dark:text-paper-200 hover:border-paper-400 dark:hover:border-pitch-400 transition-colors"
            >
              {step.link.label} <ExternalLink size={12} />
            </button>
          )}

          {step.copies?.length > 0 && (
            <div className="mt-3 space-y-2">
              {step.copies.map((c) => (
                <CopyRow key={c.value} label={c.label} value={c.value} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-paper-200 dark:border-pitch-600">
          <button
            onClick={() => setI((n) => Math.max(0, n - 1))}
            disabled={first}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={15} /> Back
          </button>
          {last ? (
            <button
              onClick={onClose}
              className="btn btn-sm btn-primary"
            >
              <Check size={15} /> Done, let me paste
            </button>
          ) : (
            <button
              onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))}
              className="btn btn-sm btn-primary"
            >
              Next <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CopyRow({ label, value }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      /* clipboard blocked; the value is visible to copy by hand */
    }
  }
  return (
    <div className="rounded-lg border border-paper-300 dark:border-pitch-500 bg-paper-100 dark:bg-pitch-800 overflow-hidden">
      {label && (
        <div className="eyebrow px-3 pt-2 text-paper-500 dark:text-paper-600">{label}</div>
      )}
      <div className="flex items-center gap-2 px-3 py-2">
        <code className="flex-1 min-w-0 text-xs font-mono text-pitch-800 dark:text-paper-200 break-all">{value}</code>
        <button
          onClick={copy}
          className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-2xs font-medium transition-colors ${
            done ? 'text-mint-700 dark:text-mint-300' : 'text-paper-500 dark:text-paper-400 hover:text-pitch-700 dark:hover:text-paper-200'
          }`}
        >
          {done ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
    </div>
  )
}

// ─── Guide content (derived from docs/AZURE_SETUP.md & docs/JIRA_SETUP.md) ──────

const MicrosoftLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="10" height="10" fill="#F25022" />
    <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
    <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
    <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
  </svg>
)

const JiraLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#2684FF" aria-hidden="true">
    <path d="M11.53 2 2 11.53a1 1 0 0 0 0 1.41l9.53 9.53a.5.5 0 0 0 .7 0l2.3-2.3-4.06-4.06a3.5 3.5 0 0 1 0-4.95l4.06-4.06-2.3-2.3a.5.5 0 0 0-.7 0Z" opacity=".7" />
    <path d="M13.06 8.06 22.59 17.6a1 1 0 0 0 0-1.41L13.06 6.65l-.7.7a3.5 3.5 0 0 0 0 4.95l.7-.7Z" />
  </svg>
)

const AppleLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-pitch-800 dark:text-paper-100">
    <path d="M16.36 12.78c.02 2.46 2.16 3.28 2.18 3.29-.02.06-.34 1.17-1.13 2.31-.68.99-1.39 1.97-2.5 1.99-1.1.02-1.45-.65-2.7-.65s-1.64.63-2.68.67c-1.08.04-1.9-1.07-2.58-2.05-1.4-2.02-2.47-5.71-1.03-8.2.71-1.24 1.99-2.02 3.37-2.04 1.06-.02 2.06.71 2.7.71.65 0 1.86-.88 3.14-.75.53.02 2.03.21 2.99 1.62-.08.05-1.79 1.04-1.77 3.1ZM14.3 5.39c.57-.69.95-1.65.85-2.6-.82.03-1.81.55-2.4 1.23-.53.61-1 1.58-.87 2.51.91.07 1.85-.46 2.42-1.14Z"/>
  </svg>
)

const DropboxLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#0061FF" aria-hidden="true">
    <path d="M6 2 0 6l6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM0 14l6 4 6-4-6-4-6 4Zm18-4-6 4 6 4 6-4-6-4ZM6 19.5l6 4 6-4-6-4-6 4Z" />
  </svg>
)

const GoogleLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3a7.2 7.2 0 0 1-10.74-3.78H1.34v3.09A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.33 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l3.99-3.09Z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.99 11.99 0 0 0 1.34 6.6l3.99 3.09A7.2 7.2 0 0 1 12 4.75Z" />
  </svg>
)

export const AZURE_GUIDE = {
  title: 'Connect Microsoft 365',
  logo: <MicrosoftLogo />,
  accent: 'mint',
  estMinutes: 5,
  intro:
    'To read your Outlook calendar, Effro needs a free Azure app registration. You stay in control: you create the app, and Effro only ever sees the credentials you paste in. Follow along, copying values as you go.',
  steps: [
    {
      title: 'Open the Azure portal',
      body: <p>Sign in with your Microsoft account (personal or work). App registrations are free, with no credit card required.</p>,
      link: { label: 'Open portal.azure.com', href: 'https://portal.azure.com' },
    },
    {
      title: 'Create a new registration',
      body: (
        <p>In the top search bar, type <b>App registrations</b> and open it, then click <b>+ New registration</b>. Give it a name you will recognise, like <b>Effro - personal</b>.</p>
      ),
    },
    {
      title: 'Set account type and redirect URI',
      body: (
        <>
          <p>For <b>Supported account types</b>, pick <b>Accounts in any organizational directory and personal Microsoft accounts</b> for the most flexibility (this maps to the tenant value <b>common</b>).</p>
          <p>Under <b>Redirect URI</b>, choose <b>Web</b> and paste this exact value, then click <b>Register</b>:</p>
        </>
      ),
      copies: [{ label: 'Redirect URI', value: 'http://localhost:8000/api/microsoft/auth/callback' }],
    },
    {
      title: 'Copy the Client ID',
      body: (
        <p>On the Overview page, under <b>Essentials</b>, copy the <b>Application (client) ID</b>. If you chose single-tenant earlier, also copy the <b>Directory (tenant) ID</b>, otherwise your tenant is just <b>common</b>.</p>
      ),
    },
    {
      title: 'Create a client secret',
      body: (
        <p>Go to <b>Certificates &amp; secrets</b> → <b>Client secrets</b> → <b>+ New client secret</b>. Add it, then copy the <b>Value</b> immediately (not the Secret ID). It is shown only once.</p>
      ),
    },
    {
      title: 'Grant the permissions',
      body: (
        <>
          <p>Go to <b>API permissions</b> → <b>+ Add a permission</b> → <b>Microsoft Graph</b> → <b>Delegated permissions</b>, then add these three (no admin consent needed for personal use):</p>
        </>
      ),
      copies: [
        { label: 'Scope', value: 'Calendars.Read' },
        { label: 'Scope', value: 'User.Read' },
        { label: 'Scope', value: 'offline_access' },
      ],
    },
    {
      title: 'Paste into Effro',
      body: (
        <p>Back here, paste your <b>Client ID</b>, <b>Client secret</b> and <b>Tenant</b> (use <b>common</b> unless single-tenant), then <b>Save config</b> and <b>Sign in with Microsoft</b>. The first calendar sync runs straight away.</p>
      ),
    },
  ],
}

export const JIRA_GUIDE = {
  title: 'Connect Jira Cloud',
  logo: <JiraLogo />,
  accent: 'mint',
  estMinutes: 5,
  intro:
    'To read your Jira issues, Effro needs a free Atlassian OAuth app. You create it once and paste two values back here. Effro requests read-only access only.',
  steps: [
    {
      title: 'Open the Atlassian developer console',
      body: <p>Sign in with your Atlassian account, then click <b>Create</b> → <b>OAuth 2.0 integration</b>.</p>,
      link: { label: 'Open developer.atlassian.com', href: 'https://developer.atlassian.com' },
    },
    {
      title: 'Name the app',
      body: <p>Set the <b>App name</b> to <b>Effro</b> (or anything you will recognise), then click <b>Create</b>.</p>,
    },
    {
      title: 'Add OAuth 2.0 (3LO)',
      body: (
        <>
          <p>On the app page, open <b>Authorization</b> in the left sidebar and click <b>Add</b> next to <b>OAuth 2.0 (3LO)</b>. Paste this exact callback URL, then <b>Save changes</b>:</p>
          <p className="text-xs text-paper-500 dark:text-paper-600">Must be exact: <b>http</b> (not https), port <b>8000</b>, full path.</p>
        </>
      ),
      copies: [{ label: 'Callback URL', value: 'http://localhost:8000/api/jira/auth/callback' }],
    },
    {
      title: 'Add the scopes',
      body: (
        <p>Open <b>Permissions</b>, click <b>Add</b> next to <b>Jira API</b>, then <b>Configure</b>. Enable these two read-only scopes, then <b>Save changes</b>:</p>
      ),
      copies: [
        { label: 'Scope', value: 'read:jira-user' },
        { label: 'Scope', value: 'read:jira-work' },
      ],
    },
    {
      title: 'Copy the credentials',
      body: (
        <p>Open <b>Settings</b> in the left sidebar. Copy the <b>Client ID</b>. Under <b>Secret</b>, click <b>Create a new secret</b> and copy the value immediately, it is shown only once.</p>
      ),
    },
    {
      title: 'Paste into Effro',
      body: (
        <p>Back here, paste your <b>Client ID</b> and <b>Secret</b>, click <b>Save config</b>, then <b>Sign in with Atlassian</b> and consent to the two permissions. The first sync runs straight away.</p>
      ),
    },
  ],
}

export const GOOGLE_GUIDE = {
  title: 'Connect Google (Calendar, Gmail, Drive)',
  logo: <GoogleLogo />,
  accent: 'mint',
  estMinutes: 7,
  intro:
    'Effro needs a free Google Cloud OAuth app. You create it once and paste two values back here. One connection pulls your Calendar + starred Gmail into Signals and stores encrypted backups in your Drive. Read-only, plus files it creates itself.',
  steps: [
    {
      title: 'Create a Google Cloud project',
      body: <p>Sign in, then create a new project (or pick an existing one) using the project dropdown at the top. Projects are free.</p>,
      link: { label: 'Open Google Cloud Console', href: 'https://console.cloud.google.com/projectcreate' },
    },
    {
      title: 'Enable the APIs',
      body: (
        <p>Go to <b>APIs &amp; Services</b> → <b>Library</b> and enable the <b>Google Calendar API</b>, the <b>Gmail API</b>, and the <b>Google Drive API</b> (search each by name and click Enable).</p>
      ),
      link: { label: 'Open API Library', href: 'https://console.cloud.google.com/apis/library' },
    },
    {
      title: 'Configure the consent screen',
      body: (
        <>
          <p>Open <b>APIs &amp; Services</b> → <b>OAuth consent screen</b>. Choose <b>External</b>, give the app a name (e.g. <b>Effro</b>) and your email, and save.</p>
          <p>Important: while the app is in <b>Testing</b>, add your own Google address under <b>Test users</b>, otherwise sign-in is blocked with "access_denied".</p>
        </>
      ),
      link: { label: 'Open OAuth consent screen', href: 'https://console.cloud.google.com/apis/credentials/consent' },
    },
    {
      title: 'Create the OAuth client',
      body: (
        <>
          <p>Go to <b>APIs &amp; Services</b> → <b>Credentials</b> → <b>+ Create credentials</b> → <b>OAuth client ID</b>. Pick application type <b>Web application</b>.</p>
          <p>Under <b>Authorized redirect URIs</b>, add this exact value, then click <b>Create</b>:</p>
        </>
      ),
      copies: [{ label: 'Authorized redirect URI', value: 'http://localhost:8000/api/google/auth/callback' }],
      link: { label: 'Open Credentials', href: 'https://console.cloud.google.com/apis/credentials' },
    },
    {
      title: 'Copy the credentials',
      body: (
        <p>The dialog shows your <b>Client ID</b> and <b>Client secret</b>. Copy both (you can reopen the client later to see them again).</p>
      ),
    },
    {
      title: 'Paste into Effro and sign in',
      body: (
        <>
          <p>Back here, paste your <b>Client ID</b> and <b>Secret</b>, click <b>Save config</b>, then <b>Sign in with Google</b>.</p>
          <p>Because this is your own unverified app, Google shows a "Google hasn’t verified this app" screen. Click <b>Advanced</b> → <b>Go to Effro (unsafe)</b> to continue, then allow the permissions.</p>
        </>
      ),
    },
  ],
}

const GithubLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-pitch-800 dark:text-paper-100">
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"/>
  </svg>
)

export const GITHUB_GUIDE = {
  title: 'Connect GitHub',
  logo: <GithubLogo />,
  accent: 'mint',
  estMinutes: 2,
  intro:
    'Effro connects to GitHub with a personal access token (no OAuth app to register). It pulls PRs awaiting your review, issues and PRs assigned to you, and things you are mentioned in, into Signals. Read-only.',
  steps: [
    {
      title: 'Open GitHub token settings',
      body: <p>Sign in, then go to <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Tokens (classic)</b>.</p>,
      link: { label: 'Open GitHub token settings', href: 'https://github.com/settings/tokens/new' },
    },
    {
      title: 'Generate a token',
      body: (
        <>
          <p>Click <b>Generate new token (classic)</b>, name it <b>Effro</b>, and pick an expiry.</p>
          <p>Tick the <b>repo</b> scope (so private repos are included) and <b>read:user</b>. Then <b>Generate token</b>.</p>
        </>
      ),
    },
    {
      title: 'Paste into Effro',
      body: (
        <p>Copy the token (shown once, starts with <b>ghp_</b>) and paste it below, then click <b>Connect</b>. Your review requests, assignments and mentions will start arriving in Signals.</p>
      ),
    },
  ],
}

const TelegramLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="#26A5E4" />
    <path fill="#fff" d="M5.43 11.87 17.2 7.33c.55-.2 1.03.13.85.96l-2 9.45c-.15.67-.55.83-1.11.52l-3.05-2.25-1.47 1.42c-.16.16-.3.3-.61.3l.21-3.1 5.65-5.1c.25-.22-.05-.34-.38-.12l-6.98 4.39-3.01-.94c-.65-.2-.66-.65.13-.99Z" />
  </svg>
)

const MailLogo = ({ size = 18 }) => (
  <Mail size={size} aria-hidden="true" className="text-pitch-800 dark:text-paper-100" />
)

export const TELEGRAM_GUIDE = {
  title: 'Connect Telegram',
  logo: <TelegramLogo />,
  accent: 'mint',
  estMinutes: 1,
  intro:
    'Effro connects to Telegram through a personal bot you make once with @BotFather. Anything you message the bot (a thought, a link, a forwarded message) lands in Signals to triage. Effro polls Telegram for new messages, so nothing on your machine is exposed, and nothing is ever sent back.',
  steps: [
    {
      title: 'Message @BotFather',
      body: <p>Open Telegram and start a chat with <b>@BotFather</b> (the official bot with the blue tick). Send it <b>/newbot</b>.</p>,
      link: { label: 'Open @BotFather', href: 'https://t.me/BotFather' },
    },
    {
      title: 'Name your bot',
      body: (
        <>
          <p>BotFather asks for a display name (for example <b>My Effro inbox</b>), then a username ending in <b>bot</b> (for example <b>maya_effro_bot</b>).</p>
          <p>When it is done, BotFather replies with the bot's <b>token</b>.</p>
        </>
      ),
    },
    {
      title: 'Paste into Effro',
      body: (
        <>
          <p>Copy the token (looks like <b>123456789:AA…</b>) and paste it below, then click <b>Connect</b>. Open a chat with your new bot and send it anything. It arrives in Signals within a couple of minutes.</p>
          <p>One thing to know: bot usernames are public, so keep yours unguessable. Effro only listens to the first chat that messages the bot (yours), and ignores everyone else.</p>
        </>
      ),
    },
  ],
}

export const MAIL_GUIDE = {
  title: 'Connect a mailbox (IMAP)',
  logo: <MailLogo />,
  accent: 'mint',
  estMinutes: 3,
  intro:
    'Effro connects to any mailbox over IMAP with an app password (a one-off password just for Effro, not your main sign-in). It reads flagged mail only: star or flag an email in any mail app and it lands in Signals. Read-only, nothing in your mailbox is changed.',
  steps: [
    {
      title: 'Create an app password',
      body: (
        <>
          <p>In your mail provider's security settings, create an <b>app password</b> for Effro.</p>
          <p>Gmail calls these App passwords (2-step verification must be on). Fastmail has them in Settings under Privacy &amp; Security. iCloud users can use the dedicated iCloud integration instead.</p>
        </>
      ),
    },
    {
      title: 'Find your IMAP server',
      body: (
        <>
          <p>Common ones: <b>imap.gmail.com</b> (Gmail) and <b>imap.fastmail.com</b> (Fastmail). Your provider's help pages list it under IMAP settings.</p>
          <p>Microsoft mailboxes (Outlook.com, Microsoft 365) no longer allow app passwords for IMAP. Connect them through the <b>Microsoft 365</b> integration instead.</p>
        </>
      ),
    },
    {
      title: 'Connect and flag something',
      body: (
        <p>Enter the server, your email address and the app password below, then click <b>Connect</b>. Flag or star any email and press <b>Sync now</b>. It appears in Signals.</p>
      ),
    },
  ],
}

export const ICLOUD_GUIDE = {
  title: 'Connect iCloud (Calendar & Mail)',
  logo: <AppleLogo />,
  accent: 'mint',
  estMinutes: 3,
  intro:
    'iCloud has no "Sign in with Apple" for apps, so Effro connects with your Apple ID and an app-specific password (a one-off password just for Effro). It reads your Calendar and flagged Mail only. There is no iCloud Drive backup option, Apple provides no API for that.',
  steps: [
    {
      title: 'Open your Apple ID security settings',
      body: <p>Sign in with your Apple ID, then find <b>Sign-In and Security</b> → <b>App-Specific Passwords</b>.</p>,
      link: { label: 'Open appleid.apple.com', href: 'https://appleid.apple.com/account/manage' },
    },
    {
      title: 'Generate an app-specific password',
      body: (
        <>
          <p>Click <b>Generate an app-specific password</b> (you may be asked for your Apple ID password). Name it <b>Effro</b>.</p>
          <p>Copy the password it shows, it looks like <b>abcd-efgh-ijkl-mnop</b> and is shown only once.</p>
        </>
      ),
    },
    {
      title: 'Paste into Effro',
      body: (
        <p>Back here, enter your <b>Apple ID email</b> and the <b>app-specific password</b> (not your normal Apple password), then click <b>Connect</b>. Your Calendar and flagged Mail will start arriving in Signals.</p>
      ),
    },
  ],
}

export const DROPBOX_GUIDE = {
  title: 'Connect Dropbox',
  logo: <DropboxLogo />,
  accent: 'mint',
  estMinutes: 5,
  intro:
    'To back up to Dropbox, Effro needs a free Dropbox app. You create it once and paste two values back here. With "App folder" access, Effro only ever sees its own folder, nothing else in your Dropbox.',
  steps: [
    {
      title: 'Create a Dropbox app',
      body: (
        <>
          <p>Sign in, then <b>Create app</b>. Choose <b>Scoped access</b>, and for access type pick <b>App folder</b> (the safest - Effro gets its own folder only). Give it a name like <b>Effro</b>.</p>
        </>
      ),
      link: { label: 'Open Dropbox App Console', href: 'https://www.dropbox.com/developers/apps/create' },
    },
    {
      title: 'Set the permissions',
      body: (
        <p>On the app's <b>Permissions</b> tab, enable these scopes and click <b>Submit</b>:</p>
      ),
      copies: [
        { label: 'Scope', value: 'account_info.read' },
        { label: 'Scope', value: 'files.content.write' },
        { label: 'Scope', value: 'files.content.read' },
      ],
    },
    {
      title: 'Add the redirect URI',
      body: (
        <p>On the <b>Settings</b> tab, under <b>OAuth 2 → Redirect URIs</b>, paste this exact value and click <b>Add</b>:</p>
      ),
      copies: [{ label: 'Redirect URI', value: 'http://localhost:8000/api/dropbox/auth/callback' }],
    },
    {
      title: 'Copy the credentials',
      body: (
        <p>Still on the <b>Settings</b> tab, copy the <b>App key</b> and the <b>App secret</b> (click <b>Show</b> next to the secret).</p>
      ),
    },
    {
      title: 'Paste into Effro and connect',
      body: (
        <p>Back here, paste the <b>App key</b> and <b>App secret</b>, click <b>Save</b>, then <b>Connect Dropbox</b> and allow access. After that, pick a folder name and you are set.</p>
      ),
    },
  ],
}
