import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, History, BrainCircuit, Search, Plus,
  ChevronLeft, ChevronRight, Settings, Keyboard, Telescope, Radar,
} from 'lucide-react'
import { getAreaStatus } from '../utils/status'
import { MOD_KEY } from '../utils/platform'
import { AreaIcon } from './IconPicker'
import { listSignals } from '../api/signals'
import Logo from './Logo'

const MIN_WIDTH = 200
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 240
const COLLAPSED_WIDTH = 60

export default function Sidebar({
  areas,
  onOpenSwitcher,
  onOpenNewArea,
  systemSettingsBadge = false,
}) {
  const { areaId } = useParams()
  const location = useLocation()
  const settingsActive = location.pathname === '/settings'
  const logActive = location.pathname === '/log'

  // ─── Signals pending count (sidebar badge) ─────────────────────────────────
  // Poll every 60s so the badge updates without a refresh after the
  // scheduler's 30-min sync drops new pending items. Cheap query - just a
  // count, no payload. Failures (e.g. backend down at boot) are swallowed.
  const [signalsPending, setSignalsPending] = useState(0)
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const r = await listSignals()
        if (!cancelled) setSignalsPending(r?.pending_count || 0)
      } catch { /* swallow */ }
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [location.pathname])  // re-poll on nav so accept/dismiss reflects fast

  // ─── Collapse state ────────────────────────────────────────────────────────
  // Persisted across sessions. Ctrl/Cmd+B toggles (VSCode convention).
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  )
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(collapsed))
  }, [collapsed])

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ─── Resizable width (only when expanded) ──────────────────────────────────
  const [width, setWidth] = useState(() => {
    const stored = parseInt(localStorage.getItem('sidebarWidth') || '', 10)
    if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) return stored
    return DEFAULT_WIDTH
  })
  const draggingRef = useRef(false)

  useEffect(() => {
    localStorage.setItem('sidebarWidth', String(width))
  }, [width])

  const onMouseDownHandle = useCallback((e) => {
    if (collapsed) return  // no resize when collapsed
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [collapsed])

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
      setWidth(next)
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : width

  return (
    <aside
      style={{ width: `${effectiveWidth}px` }}
      className="
        flex-shrink-0 flex flex-col h-screen sticky top-0 relative
        bg-paper-100 dark:bg-pitch-900
        border-r border-paper-300 dark:border-pitch-700
        transition-[width] duration-150 ease-out
      "
    >
      {/* Brand - mark + wordmark with mint dot + slogan.
          Wrapped in `group` so the Logo's SVG paths can react on hover
          (defined in Logo.jsx via group-hover). Mint dot replaces the
          full stop after "Effro" - same character, brand-coloured. */}
      <div className={`
        ${collapsed ? 'px-3 py-4 flex justify-center' : 'px-4 py-5'}
        border-b border-paper-300 dark:border-pitch-700
      `}>
        <Link
          to="/"
          className={`group flex items-center ${collapsed ? '' : 'gap-3'} min-w-0`}
          title={collapsed ? 'Effro.' : undefined}
        >
          {collapsed ? (
            <Logo size={28} />
          ) : (
            <>
              <Logo size={28} />
              <div className="min-w-0 flex flex-col">
                <span
                  className="font-display font-medium text-xl tracking-tightest text-pitch-800 dark:text-white leading-none inline-flex items-baseline"
                >
                  Effro
                  {/* Mint dot acting as the full stop. Same character, brand colour. */}
                  <span
                    aria-hidden="true"
                    className="inline-block w-[6px] h-[6px] rounded-full bg-mint ml-[3px] flex-shrink-0"
                  />
                </span>
                {/* Slogan - tight tracking + light opacity so it sits behind the brand. */}
                <span className="mt-1 font-mono uppercase tracking-[0.12em] text-2xs text-paper-400 dark:text-paper-700 truncate">
                  Stay across everything.
                </span>
              </div>
            </>
          )}
        </Link>
      </div>

      {/* Quick switcher trigger (hidden when collapsed - search icon serves as a hint via the nav rail) */}
      {!collapsed && (
        <div className="px-3 pt-3">
          <button
            onClick={onOpenSwitcher}
            className="
              w-full flex items-center gap-2 px-3 py-2 rounded-md
              bg-white dark:bg-pitch-800 border border-paper-300 dark:border-pitch-700
              text-paper-500 dark:text-paper-600
              hover:border-paper-400 dark:hover:border-pitch-500
              hover:text-paper-700 dark:hover:text-paper-400
              transition-colors
            "
          >
            <Search size={13} />
            <span className="text-xs flex-1 text-left">Jump to…</span>
            <span className="text-xs font-mono text-paper-400 dark:text-paper-700 whitespace-nowrap">
              {MOD_KEY} K
            </span>
          </button>
        </div>
      )}
      {collapsed && (
        <div className="px-2 pt-3">
          <CollapsedIconButton
            icon={Search}
            label={`Jump to… (${MOD_KEY}+K)`}
            onClick={onOpenSwitcher}
          />
        </div>
      )}

      {/* Top nav links - primary destinations only. Audit Log moved to the
          footer utility row (it's a look-back tool, not everyday navigation). */}
      <div className={`${collapsed ? 'px-2' : 'px-3'} pt-3 pb-1 space-y-0.5`}>
        <NavLink to="/" icon={LayoutDashboard} label="Dashboard" active={location.pathname === '/'} collapsed={collapsed} />
        <NavLink to="/insights" icon={Telescope} label="Insights" active={location.pathname === '/insights'} collapsed={collapsed} />
        <div data-onboarding="signals-nav">
          <NavLink
            to="/signals"
            icon={Radar}
            label="Signals"
            active={location.pathname === '/signals'}
            collapsed={collapsed}
            badge={signalsPending}
          />
        </div>
        <div data-onboarding="smart-gen-nav">
          <NavLink to="/process" icon={BrainCircuit} label="Smart Generate" active={location.pathname === '/process'} collapsed={collapsed} />
        </div>
      </div>

      {/* Areas section header (hidden when collapsed - icons alone provide the hierarchy) */}
      {!collapsed && (
        <div className="px-4 pt-3 pb-1">
          <span className="text-xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-700">
            Areas
          </span>
        </div>
      )}

      {/* Area list + inline Add area */}
      <nav data-onboarding="sidebar-areas" className={`flex-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'} pb-3 space-y-0.5 ${collapsed ? 'pt-3' : ''}`}>
        {areas.map((area) => {
          const config = getAreaStatus(area.status)
          const isActive = areaId && parseInt(areaId) === area.id

          if (collapsed) {
            return (
              <Link
                key={area.id}
                to={`/area/${area.id}`}
                title={`${area.name}${area.open_thread_count > 0 ? ` (${area.open_thread_count})` : ''}`}
                className={`
                  relative flex items-center justify-center p-2 rounded-md transition-colors
                  ${isActive
                    ? 'bg-paper-200 dark:bg-pitch-700 text-pitch-800 dark:text-white'
                    : 'text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-700 hover:text-pitch-700 dark:hover:text-paper-200'
                  }
                `}
              >
                {area.icon ? (
                  <AreaIcon name={area.icon} size={16} />
                ) : (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: config.dot }}
                  />
                )}
                {/* Status dot in the corner */}
                <span
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: config.dot }}
                />
              </Link>
            )
          }

          return (
            <Link
              key={area.id}
              to={`/area/${area.id}`}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors group
                ${isActive
                  ? 'bg-paper-200 dark:bg-pitch-700 text-pitch-800 dark:text-white'
                  : 'text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-700 hover:text-pitch-700 dark:hover:text-paper-200'
                }
              `}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: config.dot,
                  boxShadow: isActive ? `0 0 5px ${config.dot}` : 'none',
                }}
              />
              {area.icon ? (
                <AreaIcon name={area.icon} size={13} className="flex-shrink-0" />
              ) : null}
              <span className="flex-1 truncate font-medium text-xs font-display">
                {area.name}
              </span>
              {area.open_thread_count > 0 && (
                <span className="text-xs font-mono text-paper-500 dark:text-paper-600">
                  {area.open_thread_count}
                </span>
              )}
            </Link>
          )
        })}

        {/* Subtle add-area row - sits directly under the last area entry */}
        {collapsed ? (
          <CollapsedIconButton
            icon={Plus}
            label={areas.length === 0 ? 'Add your first area' : 'Add area'}
            onClick={onOpenNewArea}
          />
        ) : (
          <button
            onClick={onOpenNewArea}
            className="
              w-full flex items-center gap-2 px-3 py-1.5 rounded-md mt-0.5
              text-xs text-paper-500 dark:text-paper-700
              hover:text-paper-700 dark:hover:text-paper-500
              hover:bg-paper-200/60 dark:hover:bg-pitch-700/40
              transition-colors
            "
          >
            <Plus size={12} className="flex-shrink-0" />
            <span className="font-display uppercase tracking-wide">
              {areas.length === 0 ? 'Add your first area' : 'Add area'}
            </span>
          </button>
        )}
      </nav>

      {/* Footer - icon-only Audit Log + System + keyboard shortcuts. Names and
          shortcuts show on hover; stacked when collapsed, side-by-side when
          expanded. Version lives in Settings -> System, so it's not repeated here. */}
      <div className={`
        ${collapsed ? 'px-2 py-2' : 'px-4 py-2'}
        border-t border-paper-300 dark:border-pitch-700
      `}>
        <div className={`flex ${collapsed ? 'flex-col items-center gap-2' : 'items-center gap-1'}`}>
          <FooterIconLink to="/log" icon={History} label="Audit Log" active={logActive} />
          <FooterIconLink to="/settings" icon={Settings} label="System" active={settingsActive} badge={systemSettingsBadge} />
          <FooterShortcuts />
        </div>
      </div>

      {/* Collapse / expand toggle.
          Vertically centred on the sidebar's right edge - Notion-style -
          so it's a steady, predictable target. The chevron always points
          in the direction the panel will move: left when expanded (to
          collapse), right when collapsed (to expand). Sits half on the
          sidebar, half on the canvas - discoverable on hover. */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (${MOD_KEY}+B)`}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} sidebar`}
        className="
          group/toggle
          absolute top-1/2 -translate-y-1/2 -right-3 z-20
          flex items-center justify-center
          w-6 h-12 rounded-md
          bg-paper-200 dark:bg-pitch-700
          border border-paper-300 dark:border-pitch-500
          text-paper-500 dark:text-paper-600
          shadow-sm
          opacity-40 hover:opacity-100
          hover:text-pitch-700 dark:hover:text-paper-200
          hover:border-paper-400 dark:hover:border-paper-700
          transition-opacity duration-150
        "
      >
        {collapsed
          ? <ChevronRight size={14} />
          : <ChevronLeft size={14} />
        }
      </button>

      {/* Resize handle - disabled when collapsed */}
      {!collapsed && (
        <div
          onMouseDown={onMouseDownHandle}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          title="Drag to resize · double-click to reset"
          className="
            absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize
            hover:bg-paper-300 dark:hover:bg-pitch-600
            transition-colors
          "
        />
      )}
    </aside>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavLink({ to, icon: Icon, label, active, collapsed, badge }) {
  const showBadge = typeof badge === 'number' && badge > 0
  if (collapsed) {
    return (
      <Link
        to={to}
        title={`${label}${showBadge ? ` · ${badge}` : ''}`}
        className={`
          relative flex items-center justify-center p-2 rounded-md transition-colors
          ${active
            ? 'bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 ring-1 ring-mint/30'
            : 'text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-700 hover:text-pitch-700 dark:hover:text-paper-200'
          }
        `}
      >
        <Icon size={16} />
        {showBadge && (
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-mint" aria-label={`${badge} pending`} />
        )}
      </Link>
    )
  }
  return (
    <Link
      to={to}
      className={`
        flex items-center gap-2 pr-3 py-2 rounded-md text-sm font-medium transition-colors
        border-l-2
        ${active
          ? 'bg-mint-50 dark:bg-mint-900/20 border-mint text-mint-700 dark:text-mint-300 pl-[10px]'
          : 'border-transparent pl-3 text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-700 hover:text-pitch-700 dark:hover:text-paper-200'
        }
      `}
    >
      <Icon size={15} className="flex-shrink-0" />
      <span className="font-display uppercase tracking-wide text-xs flex-1">{label}</span>
      {showBadge && (
        <span className="
          ml-auto text-2xs font-mono px-1.5 py-0.5 rounded-full
          bg-mint-50 dark:bg-mint-900/30 text-mint-700 dark:text-mint-300
          min-w-[18px] text-center
        ">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
}

function CollapsedIconButton({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="
        w-full flex items-center justify-center p-2 rounded-md
        text-paper-500 dark:text-paper-600
        hover:bg-paper-200 dark:hover:bg-pitch-700
        hover:text-pitch-700 dark:hover:text-paper-200
        transition-colors
      "
    >
      <Icon size={15} />
    </button>
  )
}

// Icon-only footer utility link. The name lives in the tooltip, not the rail -
// these are occasional destinations (Audit Log, System), not everyday nav.
// `badge` shows a mint dot (used for a pending update on System).
function FooterIconLink({ to, icon: Icon, label, active, badge = false }) {
  return (
    <Link
      to={to}
      title={badge ? `${label} (update available)` : label}
      aria-label={label}
      className={`
        relative flex items-center justify-center p-2 rounded-md transition-colors
        ${active
          ? 'bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 ring-1 ring-mint/30'
          : 'text-paper-500 dark:text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-700 hover:text-pitch-700 dark:hover:text-paper-200'
        }
      `}
    >
      <Icon size={15} />
      {badge && (
        <span
          className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-mint ring-2 ring-paper-100 dark:ring-pitch-900"
          aria-label="Update available"
        />
      )}
    </Link>
  )
}

function ShortcutHint({ label, keys }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs text-paper-500 dark:text-paper-700">
      <span className="font-display uppercase tracking-wide">{label}</span>
      <span className="flex items-center gap-0.5">
        {keys.map((k) => (
          <kbd
            key={k}
            className="px-1.5 py-0.5 rounded bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 font-mono text-paper-600 dark:text-paper-500 text-2xs"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  )
}

// Keyboard-shortcut affordance for the footer: a single icon that reveals the
// shortcut list on hover, instead of two permanent rows. Opens upward (the
// footer sits at the bottom of the rail).
function FooterShortcuts() {
  return (
    <div className="relative group/keys">
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        className="
          flex items-center justify-center p-2 rounded-md
          text-paper-500 dark:text-paper-600
          hover:bg-paper-200 dark:hover:bg-pitch-700
          hover:text-pitch-700 dark:hover:text-paper-200
          transition-colors
        "
      >
        <Keyboard size={15} />
      </button>

      {/* Hover popover */}
      <div className="
        absolute bottom-full left-0 mb-2 z-30 w-44
        p-2.5 rounded-lg space-y-1.5
        bg-white dark:bg-pitch-700
        border border-paper-300 dark:border-pitch-500 shadow-lg
        opacity-0 translate-y-1 pointer-events-none
        group-hover/keys:opacity-100 group-hover/keys:translate-y-0
        transition-all duration-150
      ">
        <p className="font-display uppercase tracking-widest text-2xs text-paper-400 dark:text-paper-600 mb-1.5">
          Shortcuts
        </p>
        <ShortcutHint label="Capture" keys={['N']} />
        <ShortcutHint label="Switcher" keys={[MOD_KEY, 'K']} />
      </div>
    </div>
  )
}
