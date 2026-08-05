import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, ArrowRight, RefreshCw, Clock, Sparkles, RotateCcw, Leaf, ChevronDown, X, Plus, LayoutGrid } from 'lucide-react'
import { formatDistanceToNow, format, differenceInDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { parseUTC } from '../utils/time.js'
import { areasApi, entriesApi } from '../api/client'
import { getTodayNudge, getRandomNudge } from '../api/nudges'
import StatusBadge from '../components/StatusBadge'
import WeeklyRoundupModal from '../components/WeeklyRoundupModal'
import NewAreaModal from '../components/NewAreaModal'
import { AreaIcon } from '../components/IconPicker'
import { getAreaStatus } from '../utils/status'
import { stripMarkdown } from '../utils/markdownEditing'
import { useDisplayName } from '../hooks/useDisplayName'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { BionicText } from '../utils/bionic.jsx'

const INACTIVITY_THRESHOLD_DAYS = 7

// Priority order: blocked (most urgent) → on hold → active → stable (least urgent)
const STATUS_PRIORITY = { blocked: 0, review: 1, active: 2, stable: 3 }

const VIEW_MODES = [
  { key: 'default',  label: 'All' },
  { key: 'priority', label: 'Priority' },
  { key: 'focus',    label: 'Focus' },
]

// Time-of-day greeting boundaries. Local hour, not UTC, because the dashboard
// is for the person sitting at the machine. Tweaked to feel natural:
//   05–11  morning
//   12–16  afternoon
//   17–21  evening
//   22–04  night (covers late-night work + pre-dawn)
function getTimeGreeting(date = new Date()) {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 22) return 'Good evening'
  return 'Working late'   // 22:00–04:59 - softer than "good night"
}

// Strip a display name down to its first token so the greeting reads
// "Good morning, Luke" rather than "Good morning, Luke Keogh".
function firstName(displayName) {
  if (!displayName) return ''
  const trimmed = displayName.trim().split(/\s+/)[0]
  return trimmed || ''
}

export default function Dashboard() {
  const [areas, setAreas]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const { displayName } = useDisplayName()
  const { configured: aiConfigured } = useAIConfigured()

  const [roundupOpen, setRoundupOpen] = useState(false)
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  // { id, text } | null — store id too so the "show another" button can
  // ask the backend for a nudge that isn't the one currently on screen.
  const [nudge, setNudge] = useState(null)
  const [shufflingNudge, setShufflingNudge] = useState(false)
  // Dismissed-for-today flag. The nudge rotates daily, so a dismissal is
  // scoped to the current date — it reappears (with a fresh nudge) tomorrow.
  const todayKey = () => new Date().toISOString().slice(0, 10)
  const [nudgeDismissed, setNudgeDismissed] = useState(
    () => localStorage.getItem('nudgeDismissed') === todayKey()
  )

  const dismissNudge = () => {
    localStorage.setItem('nudgeDismissed', todayKey())
    setNudgeDismissed(true)
  }

  useEffect(() => {
    getTodayNudge()
      .then((n) => setNudge(n?.text ? { id: n.id, text: n.text } : null))
      .catch(() => setNudge(null))
  }, [])

  const handleShuffleNudge = async () => {
    if (shufflingNudge) return
    setShufflingNudge(true)
    try {
      const next = await getRandomNudge(nudge?.id)
      if (next?.text) setNudge({ id: next.id, text: next.text })
    } catch {
      // best-effort - leave the current nudge on screen
    } finally {
      setShufflingNudge(false)
    }
  }

  // View mode persisted to localStorage
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('dashboardView') || 'default'
  )

  const handleViewMode = (mode) => {
    setViewMode(mode)
    localStorage.setItem('dashboardView', mode)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setAreas(await areasApi.list())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Filtered/sorted areas based on view mode
  const displayAreas = viewMode === 'priority'
    ? [...areas].sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 9
        const pb = STATUS_PRIORITY[b.status] ?? 9
        if (pa !== pb) return pa - pb
        return new Date(b.updated_at) - new Date(a.updated_at)
      })
    : viewMode === 'focus'
      ? areas.filter((a) => ['blocked', 'review', 'active'].includes(a.status))
      : areas

  if (loading) return <DashboardSkeleton />
  if (error)   return <ErrorState message={error} onRetry={load} />

  const filterNotice = (() => {
    if (viewMode === 'priority') return 'Priority order - blocked first'
    if (viewMode === 'focus')    return 'Focus mode - stable areas hidden'
    return null
  })()

  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      {/* ── Sub-toolbar (page-level, no brand) ── */}
      <header className="
        sticky top-0 z-10 px-8 py-5
        bg-paper-100/90 dark:bg-pitch-800/90 backdrop-blur-md
        border-b border-paper-300 dark:border-pitch-700
      ">
        <div className="max-w-[1600px] mx-auto flex items-start justify-between gap-6 pr-14">
          <div className="min-w-0">
            {/* Greeting + date. Personal anchor - orients the eye and the
                hour. First-name only so the line stays short and warm. */}
            <h1 className="font-display font-semibold text-xl tracking-[-0.01em] text-paper-900 dark:text-pitch-50 leading-tight">
              {getTimeGreeting()}
              {firstName(displayName) && (
                <>, <span className="text-pitch-600 dark:text-paper-300">{firstName(displayName)}</span></>
              )}
            </h1>
            <p className="text-xs font-mono uppercase tracking-[0.25em] text-paper-500 dark:text-paper-600 mt-2">
              {format(new Date(), 'EEEE, d MMMM')}
            </p>
          </div>

          {/* View + roundup controls only make sense once at least one area
              exists; on a fresh install the empty state below carries the page. */}
          {areas.length > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0 pt-1">
            <ViewSegmentedControl viewMode={viewMode} onChange={handleViewMode} />
            <button
              onClick={() => setRoundupOpen(true)}
              disabled={aiConfigured === false}
              title={aiConfigured === false ? 'Set up an AI engine in Settings to use this' : undefined}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-md
                bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200
                hover:bg-paper-300 dark:hover:bg-pitch-600 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-paper-200 dark:disabled:hover:bg-pitch-700
              "
            >
              <Sparkles size={13} />
              <span className="text-xs font-display uppercase tracking-wide">Weekly Roundup</span>
            </button>
          </div>
          )}
        </div>

        {filterNotice && (
          <div className="max-w-[1600px] mx-auto mt-3 flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-paper-500 dark:text-paper-600">
              {filterNotice}
            </span>
            <button
              onClick={() => handleViewMode('default')}
              className="
                inline-flex items-center gap-1 text-xs font-mono
                text-paper-500 dark:text-paper-600
                hover:text-paper-700 dark:hover:text-paper-200
                transition-colors
              "
            >
              <RotateCcw size={11} /> reset
            </button>
          </div>
        )}
      </header>

      {/* ── Area grid ── */}
      <main className="max-w-[1600px] mx-auto px-8 py-8">
        {/* Daily insight - ambient by design: one muted, italic line on the
            page background (no box, no tint), a small leaf mark, and quiet
            controls that surface on hover. Minimal real-estate. */}
        {areas.length > 0 && nudge?.text && !nudgeDismissed && (
          <div className="group flex items-start gap-2 mb-5 text-sm leading-snug text-paper-500 dark:text-pitch-100">
            <Leaf size={13} className="flex-shrink-0 mt-[3px] text-mint-600/70 dark:text-mint-400/60" />
            <p className="flex-1 italic">{nudge.text}</p>
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleShuffleNudge}
                disabled={shufflingNudge}
                title="Show another"
                aria-label="Show another insight"
                className="p-0.5 rounded text-paper-500 dark:text-pitch-100 hover:text-paper-700 dark:hover:text-paper-300 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw size={11} className={shufflingNudge ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={dismissNudge}
                title="Dismiss for today"
                aria-label="Dismiss insight"
                className="p-0.5 rounded text-paper-500 dark:text-pitch-100 hover:text-paper-700 dark:hover:text-paper-300 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {areas.length === 0 ? (
          <EmptyState onCreate={() => setNewAreaOpen(true)} />
        ) : displayAreas.length === 0 ? (
          /* Focus mode with every area stable - a good day, not an error. */
          <p className="py-10 text-center text-sm italic text-paper-500 dark:text-paper-600">
            Everything is stable right now. Nothing needs your focus.
          </p>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          >
            {displayAreas.map((area) => (
              <AreaCard key={area.id} area={area} />
            ))}
            <NewAreaTile onClick={() => setNewAreaOpen(true)} />
          </div>
        )}
      </main>

      {/* ── Below-fold sections ── */}
      <div className="max-w-[1600px] mx-auto px-8 pb-12">
        <ComingUpStrip />
      </div>

      <WeeklyRoundupModal isOpen={roundupOpen} onClose={() => setRoundupOpen(false)} />
      <NewAreaModal isOpen={newAreaOpen} onClose={() => setNewAreaOpen(false)} />
    </div>
  )
}

// ─── New-area affordances ─────────────────────────────────────────────────────

// Ghost tile at the end of the grid - a quiet, always-present way to add an
// area without leaving the dashboard. Dashed border keeps it clearly distinct
// from real area cards.
function NewAreaTile({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="
        group flex flex-col items-center justify-center gap-2 rounded-xl
        min-h-[11rem] border-2 border-dashed
        border-paper-300 dark:border-pitch-500
        text-paper-500 dark:text-paper-600
        hover:border-mint-500/60 dark:hover:border-mint-400/40
        hover:text-mint-700 dark:hover:text-mint-300
        hover:bg-mint-50/40 dark:hover:bg-mint-900/10
        transition-colors animate-fade-in
      "
    >
      <Plus size={18} className="transition-transform duration-200 group-hover:scale-110" />
      <span className="text-xs font-display uppercase tracking-wide">New area</span>
    </button>
  )
}

// First-run empty state. Explains what an area is before asking the user to
// make one, in the calm what -> how format. The sidebar's add row still works,
// but this is the affordance a brand-new user actually sees.
function EmptyState({ onCreate }) {
  return (
    <div className="max-w-md mx-auto mt-16 text-center animate-fade-in">
      <div className="w-12 h-12 mx-auto mb-5 rounded-xl bg-mint-50 dark:bg-mint-900/20 flex items-center justify-center text-mint-700 dark:text-mint-300">
        <LayoutGrid size={20} />
      </div>
      <h2 className="font-display font-bold text-lg text-pitch-800 dark:text-white mb-2">
        Set up your first area
      </h2>
      <p className="text-sm text-paper-600 dark:text-paper-500 leading-relaxed mb-6">
        Areas are the big buckets your work lives in, like a product, a team or
        a client. Threads and updates sit inside them, so everything you capture
        has a home.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-mint-700 hover:bg-mint-800 text-white transition-colors"
      >
        <Plus size={15} />
        Create your first area
      </button>
    </div>
  )
}

// ─── View mode segmented control ──────────────────────────────────────────────

function ViewSegmentedControl({ viewMode, onChange }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-paper-200 dark:bg-pitch-700/60 border border-paper-300 dark:border-pitch-500">
      {VIEW_MODES.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`
            px-3 py-1 rounded text-xs font-display uppercase tracking-wide transition-colors
            ${viewMode === key
              ? 'bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 shadow-sm'
              : 'text-paper-600 dark:text-paper-500 hover:text-pitch-700 dark:hover:text-paper-300'
            }
          `}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Area card ────────────────────────────────────────────────────────────────

function AreaCard({ area }) {
  const config         = getAreaStatus(area.status)
  const relativeTime   = formatDistanceToNow(parseUTC(area.updated_at), { addSuffix: true })
  const daysSinceUpdate = differenceInDays(new Date(), parseUTC(area.updated_at))
  // Stable areas recede so the urgent ones carry the eye. Present but quiet;
  // full weight returns on hover.
  const isStable = area.status === 'stable'

  return (
    <Link
      to={`/area/${area.id}`}
      className={`
        group relative flex flex-col rounded-xl border overflow-hidden
        bg-white dark:bg-pitch-700
        border-paper-300 dark:border-pitch-500
        hover:border-paper-400 dark:hover:border-paper-700
        hover:shadow-lg dark:hover:shadow-pitch-900/60
        hover:-translate-y-0.5
        transition-all duration-200
        animate-fade-in
        ${isStable ? 'opacity-60 hover:opacity-100' : ''}
      `}
    >
      {/* Status accent stripe */}
      <div
        className="h-1"
        style={{
          backgroundColor: config.dot,
          boxShadow: `0 1px 8px color-mix(in srgb, ${config.dot} 38%, transparent)`,
        }}
      />

      <div className="p-5 flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {area.icon && (
              <span className="text-paper-700 dark:text-paper-200 flex-shrink-0">
                <AreaIcon name={area.icon} size={18} />
              </span>
            )}
            <h2 className="font-display font-bold text-base text-pitch-800 dark:text-white truncate">
              {area.name}
            </h2>
          </div>
          <StatusBadge status={area.status} type="area" size="xs" />
        </div>

        {/* Card text: the current overview when there is one, else the stable
            description - a freshly created area shows its description here
            until an overview is written or generated. */}
        <p className="text-sm text-paper-600 dark:text-paper-500 leading-relaxed flex-1 line-clamp-3 mb-4">
          {(area.summary || area.description) ? (
            <BionicText>{stripMarkdown(area.summary || area.description)}</BionicText>
          ) : (
            <span className="italic text-paper-400 dark:text-paper-700">
              No overview yet - click to add one.
            </span>
          )}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-paper-200 dark:border-pitch-500">
          <span className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-paper-600">
            <MessageSquare size={12} />
            <span className="font-mono">
              {area.open_thread_count}
              <span className="text-paper-400 dark:text-pitch-500">/{area.thread_count}</span>
            </span>
            <span className="text-paper-400 dark:text-pitch-500">active</span>
          </span>

          <div className="flex items-center gap-2">
              {daysSinceUpdate >= INACTIVITY_THRESHOLD_DAYS && area.status !== 'stable' && (
                <span className="flex items-center gap-1 font-mono text-xs text-mustard">
                  <Clock size={11} />
                  {daysSinceUpdate}d quiet
                </span>
              )}
            <span className="text-xs font-mono text-paper-400 dark:text-paper-700">{relativeTime}</span>
            <ArrowRight
              size={13}
              className="text-paper-400 dark:text-paper-700 group-hover:text-paper-700 group-hover:translate-x-0.5 transition-all"
            />
          </div>
        </div>
      </div>
    </Link>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      <div
        className="max-w-[1600px] mx-auto px-8 py-8 grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex-1 flex items-center justify-center min-h-screen bg-paper-100 dark:bg-pitch-800">
      <div className="text-center">
        <p className="text-sm text-terracotta mb-3">{message}</p>
        <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 rounded-md bg-paper-200 dark:bg-pitch-700 text-sm text-pitch-500 dark:text-paper-300 hover:bg-paper-300 dark:hover:bg-pitch-500 transition-colors mx-auto">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  )
}

// ─── Coming Up (upcoming todos) ───────────────────────────────────────────────

const TODAY = new Date()

function getDueGroup(dueDateStr) {
  if (!dueDateStr) return 'later'
  const diff = differenceInCalendarDays(parseISO(dueDateStr), TODAY)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 6) return 'week'
  return 'later'
}

// One calm line counting what's due, bucketed overdue / today / this week.
// The detail still lives in each thread, one click away - and a chevron
// expands the strip inline so the user can scan the actual items without
// leaving the dashboard. Collapsed state persists across reloads so the
// view stays predictable (ADHD: predictable destinations beat surprises).
// Hides entirely when nothing is due. Counts use the functional status
// palette (terracotta, amber-muted), never brand mint.
function ComingUpStrip() {
  const [todos, setTodos] = useState([])
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('comingUpCollapsed') !== 'false'
  )

  useEffect(() => {
    entriesApi.getUpcoming(50).then(setTodos).catch(() => {})
  }, [])

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem('comingUpCollapsed', String(next))
      return next
    })
  }

  // Bucket the todos once, derive counts from the buckets.
  const buckets = { overdue: [], today: [], week: [] }
  todos.forEach((t) => {
    const g = getDueGroup(t.due_date)
    if (g === 'overdue' || g === 'today' || g === 'week') buckets[g].push(t)
  })
  const counts = {
    overdue: buckets.overdue.length,
    today:   buckets.today.length,
    week:    buckets.week.length,
  }

  const nothing = counts.overdue + counts.today + counts.week === 0
  if (nothing) return null

  const SECTIONS = [
    { key: 'overdue', label: 'Overdue',   colorClass: 'text-terracotta' },
    { key: 'today',   label: 'Today',     colorClass: 'text-amber-muted' },
    { key: 'week',    label: 'This Week', colorClass: 'text-paper-600 dark:text-paper-500' },
  ]

  return (
    <div className="rounded-xl bg-paper-200 dark:bg-pitch-700 overflow-hidden">
      {/* Strip header - click anywhere to expand/collapse */}
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        className="
          w-full flex items-center gap-4 px-4 py-3 text-sm
          hover:bg-paper-300/60 dark:hover:bg-pitch-600/60
          transition-colors
        "
      >
        <span className="font-mono uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600">
          Coming Up
        </span>
        {counts.overdue > 0 && (
          <span className="font-medium text-terracotta">{counts.overdue} overdue</span>
        )}
        {counts.today > 0 && (
          <span className="font-medium text-amber-muted">{counts.today} today</span>
        )}
        {counts.week > 0 && (
          <span className="text-paper-600 dark:text-paper-500">{counts.week} this week</span>
        )}
        <ChevronDown
          size={15}
          className={`ml-auto flex-shrink-0 text-paper-500 dark:text-paper-600 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>

      {/* Expanded list - bucketed items, each linking to its thread */}
      {!collapsed && (
        <div className="border-t border-paper-300/70 dark:border-pitch-600/70 divide-y divide-paper-300/60 dark:divide-pitch-600/60">
          {SECTIONS.map(({ key, label, colorClass }) => {
            const items = buckets[key]
            if (items.length === 0) return null
            return (
              <div key={key} className="px-4 py-2.5">
                <p className={`font-mono uppercase tracking-widest text-2xs mb-1.5 ${colorClass}`}>
                  {label}
                </p>
                <div className="space-y-0.5">
                  {items.map((t) => (
                    <Link
                      key={t.id}
                      to={`/thread/${t.thread_id}`}
                      className="
                        flex items-center gap-3 px-2 py-1.5 rounded-md
                        hover:bg-paper-300/60 dark:hover:bg-pitch-600/60
                        transition-colors
                      "
                    >
                      <span className="font-display uppercase tracking-wide text-2xs text-pitch-700 dark:text-paper-200 flex-shrink-0">
                        {t.area_name}
                      </span>
                      <span className="text-paper-400 dark:text-paper-700 text-xs flex-shrink-0">/</span>
                      <span className="flex-1 text-xs text-pitch-600 dark:text-paper-300 truncate">
                        <BionicText>{stripMarkdown(t.content)}</BionicText>
                      </span>
                      {t.due_date && (
                        <span className="font-mono text-xs text-paper-500 dark:text-paper-600 flex-shrink-0">
                          {format(parseISO(t.due_date), 'EEE d MMM')}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

