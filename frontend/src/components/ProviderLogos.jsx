import { Server, Mail } from 'lucide-react'

/**
 * Official-ish brand logos for storage + integration providers, in one place so
 * the icon rows, pickers and section headers all use the same marks. Inline
 * SVGs (no network), sized via the `size` prop. Generic providers (WebDAV) fall
 * back to a neutral Lucide glyph.
 */
export default function ProviderLogo({ provider, size = 18, className = '' }) {
  const L = LOGOS[provider]
  if (!L) return <Server size={size} className={className} />
  return <L size={size} className={className} />
}

const Microsoft = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
    <rect x="1" y="1" width="10" height="10" fill="#F25022" />
    <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
    <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
    <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
  </svg>
)

const Google = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3a7.2 7.2 0 0 1-10.74-3.78H1.34v3.09A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.33 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l3.99-3.09Z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.99 11.99 0 0 0 1.34 6.6l3.99 3.09A7.2 7.2 0 0 1 12 4.75Z" />
  </svg>
)

const GoogleDrive = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 87 78" aria-hidden="true" className={className}>
    <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
    <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" />
    <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
    <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
    <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
    <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
  </svg>
)

const Dropbox = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#0061FF" aria-hidden="true" className={className}>
    <path d="M6 2 0 6l6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM0 14l6 4 6-4-6-4-6 4Zm18-4-6 4 6 4 6-4-6-4ZM6 19.5l6 4 6-4-6-4-6 4Z" />
  </svg>
)

const Nextcloud = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 16" aria-hidden="true" className={className}>
    <g fill="#0082C9">
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="#0082C9" strokeWidth="1.6" />
      <circle cx="4.4" cy="8" r="2.1" />
      <circle cx="19.6" cy="8" r="2.1" />
    </g>
  </svg>
)

const S3 = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="#E25444" d="M5 5h14l-1.2 13.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 5Z" />
    <path fill="#7B1D13" d="M12 5h7l-1.2 13.2a2 2 0 0 1-2 1.8H12V5Z" opacity=".5" />
    <ellipse cx="12" cy="5" rx="7" ry="1.6" fill="#E25444" />
  </svg>
)

const Apple = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={`text-pitch-800 dark:text-paper-100 ${className}`}>
    <path d="M16.36 12.78c.02 2.46 2.16 3.28 2.18 3.29-.02.06-.34 1.17-1.13 2.31-.68.99-1.39 1.97-2.5 1.99-1.1.02-1.45-.65-2.7-.65s-1.64.63-2.68.67c-1.08.04-1.9-1.07-2.58-2.05-1.4-2.02-2.47-5.71-1.03-8.2.71-1.24 1.99-2.02 3.37-2.04 1.06-.02 2.06.71 2.7.71.65 0 1.86-.88 3.14-.75.53.02 2.03.21 2.99 1.62-.08.05-1.79 1.04-1.77 3.1ZM14.3 5.39c.57-.69.95-1.65.85-2.6-.82.03-1.81.55-2.4 1.23-.53.61-1 1.58-.87 2.51.91.07 1.85-.46 2.42-1.14Z" />
  </svg>
)

const Github = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={`text-pitch-800 dark:text-paper-100 ${className}`}>
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
  </svg>
)

const Jira = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
    <path d="M15.975 2 8 17.05l4.975 5.563L19.95 14.1 15.975 2z" fill="#2684FF" />
    <path d="M15.975 30 24 14.95l-4.975-5.563L12.05 17.9 15.975 30z" fill="#2684FF" />
  </svg>
)

const Telegram = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <circle cx="12" cy="12" r="12" fill="#26A5E4" />
    <path
      fill="#fff"
      d="M5.43 11.87 17.2 7.33c.55-.2 1.03.13.85.96l-2 9.45c-.15.67-.55.83-1.11.52l-3.05-2.25-1.47 1.42c-.16.16-.3.3-.61.3l.21-3.1 5.65-5.1c.25-.22-.05-.34-.38-.12l-6.98 4.39-3.01-.94c-.65-.2-.66-.65.13-.99Z"
    />
  </svg>
)

// Generic email has no brand mark; the neutral Lucide glyph keeps the row
// consistent (same approach as WebDAV's Server fallback, but explicit).
const MailGlyph = ({ size = 18, className = '' }) => (
  <Mail size={size} aria-hidden="true" className={`text-pitch-800 dark:text-paper-100 ${className}`} />
)

const LOGOS = {
  microsoft: Microsoft,
  onedrive: Microsoft,
  sharepoint: Microsoft,
  google: Google,
  google_drive: GoogleDrive,
  dropbox: Dropbox,
  nextcloud: Nextcloud,
  s3: S3,
  apple: Apple,
  icloud: Apple,
  github: Github,
  jira: Jira,
  telegram: Telegram,
  mail: MailGlyph,
  // webdav -> Server fallback
}
