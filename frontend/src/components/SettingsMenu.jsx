import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, Moon, Check, Upload, X, Info, ChevronDown, LogOut, ShieldCheck, Compass } from 'lucide-react'
import { getInitials } from '../hooks/useDisplayName'
import { FONT_OPTIONS } from '../hooks/useFont'
import { TEXT_SIZES } from '../hooks/useTextSize'
import { Tooltip } from './Tooltip'
import { useAuth } from '../contexts/AuthContext'
import { useOnboarding } from './OnboardingWizard'
import SectionStyleGlyph from './SectionStyleGlyph'
// .dz-tokens, which the tile picker uses to draw its glyphs in the theme.
import '../styles/dashboard-zones.css'
import { DASHBOARD_LAYOUTS, SECTION_STYLES, useDashboardStyling } from '../hooks/useDashboardStyling'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024  // 2 MB

/**
 * Personal settings - avatar button in the top-right of the screen.
 *
 * Houses *personal/visual* preferences only: profile photo, display name,
 * theme, font, text size. Anything about the app's *system state* (AI
 * engine, data directory, update channel, version, etc.) lives on the
 * dedicated /settings page accessed via the cog in the sidebar.
 *
 * The split is by user intent: "how do I want this app to look/feel?" vs
 * "how does the app store/update itself?". Same rationale as macOS putting
 * "System Settings" under the Apple menu and "Preferences" under each app.
 *
 * One exception sits at the bottom: replaying the welcome tour. It is a help
 * action rather than a preference, but this menu is where people look for
 * anything about themselves, and there is no other help surface yet.
 */
export default function SettingsMenu({
  avatar,
  onChangeAvatar,
  displayName,
  onChangeDisplayName,
  dark,
  onToggleTheme,
  font,
  onChangeFont,
  textSize,
  onChangeTextSize,
}) {
  const { layout, setLayout, sectionStyle, setSectionStyle } = useDashboardStyling()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const fileInputRef = useRef(null)
  const [uploadError, setUploadError] = useState('')
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const { resetOnboarding } = useOnboarding()

  const goAccount = () => { setOpen(false); navigate('/settings?tab=account') }
  // Clearing the stored completion is the whole trigger. Shell watches the same
  // prefs store, so the wizard reopens on its own a beat later.
  const replayTour = () => { setOpen(false); resetOnboarding() }
  const handleLogout = async () => { setOpen(false); await logout(); navigate('/login', { replace: true }) }

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const initials = getInitials(displayName)
  // Locally-uploaded photo wins; otherwise the IdP/SSO photo from /auth/me.
  const shownAvatar = avatar || user?.avatar || ''

  const handlePickFile = () => fileInputRef.current?.click()

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-uploading the same filename later
    setUploadError('')
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Pick an image file (PNG, JPG, WEBP).')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setUploadError(`Image too large (max ${MAX_AVATAR_BYTES / 1024 / 1024} MB).`)
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      onChangeAvatar(ev.target.result)
    }
    reader.onerror = () => setUploadError('Could not read that file.')
    reader.readAsDataURL(file)
  }

  return (
    <div ref={ref} className="fixed top-4 right-4 z-30">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Personal settings"
        className={`
          w-10 h-10 rounded-full overflow-hidden flex items-center justify-center
          font-display font-semibold text-sm
          shadow-md ring-2 transition-all
          ${shownAvatar
            ? 'ring-paper-300/80 dark:ring-pitch-500/80'
            : 'bg-[var(--clay-tint)] text-clay-glyph ring-[var(--clay-edge)]'
          }
          ${open ? 'ring-mint-500/60 dark:ring-mint-500/60' : ''}
          hover:ring-mint-500/40
        `}
      >
        {shownAvatar ? (
          <img src={shownAvatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>{initials}</span>
        )}
      </button>

      {/* Hidden input for photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      {open && (
        <div className="
          absolute right-0 top-full mt-2 w-72
          rounded-lg shadow-2xl
          bg-white dark:bg-pitch-700
          border border-paper-300 dark:border-pitch-500
          p-3 space-y-3
          animate-fade-in
        ">
          {/* Identity (auth-enabled deployments only) */}
          {user?.auth_enabled && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-pitch-800 dark:text-pitch-50 truncate">
                    {user.display_name || user.email}
                  </div>
                  <div className="text-2xs text-paper-500 dark:text-paper-600 truncate">{user.email}</div>
                </div>
                <span className="flex-shrink-0 text-2xs px-1.5 py-0.5 rounded bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200">
                  {user.role}
                </span>
              </div>
              <button
                onClick={goAccount}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs
                           bg-paper-200 dark:bg-pitch-800 text-pitch-700 dark:text-paper-200
                           hover:bg-paper-300 dark:hover:bg-pitch-500
                           font-display uppercase tracking-wide transition-colors"
              >
                <ShieldCheck size={11} /> Account &amp; security
              </button>
            </div>
          )}

          {/* Profile photo */}
          <Section label="Profile">
            <div className="flex items-center gap-3">
              <span className="
                w-12 h-12 rounded-full overflow-hidden flex-shrink-0
                flex items-center justify-center
                bg-paper-300 dark:bg-pitch-600 text-paper-700 dark:text-paper-200 font-display font-semibold text-base
              ">
                {shownAvatar
                  ? <img src={shownAvatar} alt="" className="w-full h-full object-cover" />
                  : <span>{initials}</span>
                }
              </span>
              <div className="flex-1 flex flex-col gap-1">
                <button
                  onClick={handlePickFile}
                  className="
                    flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs
                    bg-paper-200 dark:bg-pitch-800
                    text-pitch-700 dark:text-paper-200
                    hover:bg-paper-300 dark:hover:bg-pitch-500
                    font-display uppercase tracking-wide transition-colors
                  "
                >
                  <Upload size={11} />
                  {avatar ? 'Change photo' : 'Upload photo'}
                </button>
                {avatar && (
                  <button
                    onClick={() => onChangeAvatar('')}
                    className="
                      flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs
                      text-paper-600 dark:text-paper-500
                      hover:bg-paper-100 dark:hover:bg-pitch-800
                      font-display uppercase tracking-wide transition-colors
                    "
                  >
                    <X size={11} />
                    Remove
                  </button>
                )}
              </div>
            </div>
            {uploadError && (
              <p className="mt-1.5 text-2xs text-terracotta font-mono">
                {uploadError}
              </p>
            )}
          </Section>

          {/* Display name */}
          <Section label="Display name">
            <input
              value={displayName}
              onChange={(e) => onChangeDisplayName(e.target.value)}
              placeholder="Your name"
              className="
                w-full px-2.5 py-1.5 text-sm rounded-md
                bg-paper-100 dark:bg-pitch-800
                border border-paper-300 dark:border-pitch-500
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />
          </Section>

          {/* Theme */}
          <Section label="Theme">
            <Segmented
              value={dark ? 'dark' : 'light'}
              options={[
                { key: 'light', label: 'Light', icon: Sun },
                { key: 'dark',  label: 'Dark',  icon: Moon },
              ]}
              onChange={(key) => {
                if ((key === 'dark') !== dark) onToggleTheme()
              }}
            />
          </Section>

          {/* Font */}
          <Section label="Font">
            <FontSelect value={font} options={FONT_OPTIONS} onChange={onChangeFont} />
          </Section>

          {/* Text size */}
          <Section label="Text size">
            <Segmented
              value={textSize}
              options={TEXT_SIZES.map((s) => ({ key: s.key, label: s.label }))}
              onChange={onChangeTextSize}
            />
          </Section>

          {/* Dashboard styling */}
          <Section label="Dashboard styling">
            <SubLabel>Layout</SubLabel>
            <Segmented
              value={layout}
              options={DASHBOARD_LAYOUTS}
              onChange={setLayout}
            />

            <SubLabel className="mt-3">Section style</SubLabel>
            <SectionStylePicker value={sectionStyle} onChange={setSectionStyle} />

            <p className="mt-2 text-2xs text-paper-500 dark:text-paper-600">
              Applies to the dashboard only.
            </p>
          </Section>

          {/* Replay the welcome tour */}
          <button
            onClick={replayTour}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs
                       text-paper-600 dark:text-paper-400
                       hover:bg-paper-200 dark:hover:bg-pitch-700
                       hover:text-pitch-700 dark:hover:text-paper-200
                       font-display uppercase tracking-wide transition-colors"
          >
            <Compass size={12} /> Replay the tour
          </button>

          {/* Log out (auth-enabled deployments only) */}
          {user?.auth_enabled && (
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs
                         text-terracotta hover:bg-terracotta/10
                         font-display uppercase tracking-wide transition-colors"
            >
              <LogOut size={12} /> Log out
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// A quiet heading inside a Section, for a setting with more than one control.
function SubLabel({ children, className = '' }) {
  return (
    <div className={`text-2xs text-paper-500 dark:text-paper-600 mb-1.5 ${className}`}>
      {children}
    </div>
  )
}

/**
 * The seven section styles, as tiles.
 *
 * A picture of each is worth more than its name here, since the names are only
 * meaningful once you have seen what they do. Arrow keys move the selection,
 * the way a radiogroup should.
 */
function SectionStylePicker({ value, onChange }) {
  const move = (e, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = (index + step + SECTION_STYLES.length) % SECTION_STYLES.length
    onChange(SECTION_STYLES[next].key)
  }

  return (
    // Three columns, and a grid rather than a wrap, so the seventh tile is a
    // tile rather than a stripe across the last line. .dz-tokens carries the
    // dashboard's theme-aware set, which is what the glyphs are drawn in.
    <div
      role="radiogroup"
      aria-label="Section style"
      className="dz-tokens grid grid-cols-3 gap-1.5"
    >
      {SECTION_STYLES.map((style, i) => {
        const selected = style.key === value
        return (
          <button
            key={style.key}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => move(e, i)}
            onClick={() => onChange(style.key)}
            className={`flex flex-col items-center rounded-md border px-2 pb-1.5 pt-2 transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500/50
              ${selected
                ? 'border-mint ring-1 ring-mint bg-paper-100 dark:bg-pitch-800'
                : 'border-paper-300 dark:border-pitch-500 hover:bg-paper-100 dark:hover:bg-pitch-800'}`}
          >
            <SectionStyleGlyph style={style.key} />
            <span className="mt-1.5 text-2xs text-paper-600 dark:text-paper-400">{style.label}</span>
            {/* Under the name rather than over the glyph, which it covered. */}
            <span className="font-mono text-2xs text-paper-500 dark:text-paper-600">
              {style.key === 'inset' ? 'Default' : ' '}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div>
      <div className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}

// Font dropdown: each option previewed in its own typeface, with an info "i"
// (hover tooltip) explaining what the font is and who it helps.
function FontSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const current = options.find((o) => o.key === value) || options[0]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500 hover:border-paper-400 dark:hover:border-pitch-400 transition-colors"
      >
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span style={{ fontFamily: current.stack }} className="text-sm text-pitch-800 dark:text-white truncate">{current.label}</span>
          <span className="font-mono text-2xs text-paper-500 dark:text-paper-600 flex-shrink-0">{current.hint}</span>
        </span>
        <ChevronDown size={13} className={`flex-shrink-0 text-paper-500 dark:text-paper-600 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg shadow-xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 p-1 animate-fade-in">
          {options.map((opt) => {
            const active = opt.key === value
            return (
              <div
                key={opt.key}
                className={`flex items-center rounded-md ${active ? 'bg-paper-200 dark:bg-pitch-800' : 'hover:bg-paper-100 dark:hover:bg-pitch-800'}`}
              >
                <button
                  onClick={() => { onChange(opt.key); setOpen(false) }}
                  className="flex-1 flex items-center gap-2 px-2 py-2 text-left min-w-0"
                >
                  <Check size={12} className={`flex-shrink-0 ${active ? 'opacity-100 text-mint-600 dark:text-mint-400' : 'opacity-0'}`} />
                  <span style={{ fontFamily: opt.stack }} className="flex-1 text-sm text-pitch-700 dark:text-paper-200 truncate">{opt.label}</span>
                  <span className="font-mono text-2xs text-paper-500 dark:text-paper-600 flex-shrink-0">{opt.hint}</span>
                </button>
                <Tooltip content={opt.desc} side="left">
                  <span
                    tabIndex={0}
                    aria-label={opt.desc}
                    className="px-2 py-2 flex-shrink-0 text-paper-400 dark:text-paper-600 hover:text-pitch-600 dark:hover:text-paper-300 cursor-help focus:outline-none"
                  >
                    <Info size={13} />
                  </span>
                </Tooltip>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Segmented({ value, options, onChange, renderLabel }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md w-full bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
      {options.map((opt) => {
        const Icon = opt.icon
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={`
              flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
              ${active
                ? 'bg-white dark:bg-pitch-700 text-pitch-800 dark:text-white shadow-sm'
                : 'text-paper-600 dark:text-paper-500 hover:text-pitch-700 dark:hover:text-paper-200'
              }
            `}
          >
            {Icon && <Icon size={12} />}
            {renderLabel ? renderLabel(opt) : (
              <span className="font-display uppercase tracking-wide">{opt.label}</span>
            )}
            {active && !Icon && <Check size={11} className="opacity-60" />}
          </button>
        )
      })}
    </div>
  )
}
