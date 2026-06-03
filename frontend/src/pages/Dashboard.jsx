import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, ArrowRight, RefreshCw, Clock, Sparkles, RotateCcw, Leaf, ChevronDown, X } from 'lucide-react'
import { formatDistanceToNow, format, differenceInDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { areasApi, entriesApi } from '../api/client'
import { getTodayNudge, getRandomNudge } from '../api/nudges'
import StatusBadge from '../components/StatusBadge'
import WeeklyRoundupModal from '../components/WeeklyRoundupModal'
import { AreaIcon } from '../components/IconPicker'
import { getAreaStatus } from '../utils/status'
import { useDisplayName } from '../hooks/useDisplayName'
import { useAIConfigured } from '../hooks/useAIConfigured'

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
            <h1 className="font-display font-medium text-3xl tracking-tight text-pitch-800 dark:text-white leading-tight">
              {getTimeGreeting()}
              {firstName(displayName) && (
                <>, <span className="text-pitch-600 dark:text-paper-300">{firstName(displayName)}</span></>
              )}
            </h1>
            <p className="text-xs font-mono uppercase tracking-[0.25em] text-paper-500 dark:text-paper-600 mt-2">
              {format(new Date(), 'EEEE, d MMMM')}
            </p>
          </div>

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
        {/* Daily nudge - a calm, rotating usage reminder. Quiet by design:
            soft tint, titled "Helpful insight", a shuffle icon to flick
            through the pool, and a subtle dismiss cross (scoped to today). */}
        {nudge?.text && !nudgeDismissed && (
          <div className="
            mb-6 px-4 py-3 rounded-xl
            bg-mint-50/60 dark:bg-mint-900/10
            border border-mint/20
          ">
            {/* Title row: label left, controls right */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Leaf size={12} className="text-mint-700/80 dark:text-mint-300/80" />
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-mint-700/90 dark:text-mint-300/90">
                  Helpful insight
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleShuffleNudge}
                  disabled={shufflingNudge}
                  title="Show another"
                  aria-label="Show another insight"
                  className="
                    p-1 rounded text-paper-500 dark:text-paper-600
                    hover:text-pitch-700 dark:hover:text-paper-300
                    opacity-50 hover:opacity-100
                    disabled:cursor-not-allowed transition-all
                  "
                >
                  <RefreshCw size={12} className={shufflingNudge ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={dismissNudge}
                  title="Dismiss for today"
                  aria-label="Dismiss insight"
                  className="
                    p-1 rounded text-paper-500 dark:text-paper-600
                    hover:text-pitch-700 dark:hover:text-paper-300
                    opacity-50 hover:opacity-100 transition-all
                  "
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-pitch-600 dark:text-paper-300">
              {nudge.text}
            </p>
          </div>
        )}

        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {displayAreas.map((area) => (
            <AreaCard key={area.id} area={area} />
          ))}
        </div>
      </main>

      {/* ── Below-fold sections ── */}
      <div className="max-w-[1600px] mx-auto px-8 pb-12">
        <ComingUpStrip />
      </div>

      <WeeklyRoundupModal isOpen={roundupOpen} onClose={() => setRoundupOpen(false)} />
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
  const relativeTime   = formatDistanceToNow(new Date(area.updated_at), { addSuffix: true })
  const daysSinceUpdate = differenceInDays(new Date(), new Date(area.updated_at))
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
          boxShadow: `0 1px 8px ${config.dot}60`,
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
            <h2 className="font-display font-bold text-base uppercase tracking-wider text-pitch-800 dark:text-white truncate">
              {area.name}
            </h2>
          </div>
          <StatusBadge status={area.status} type="area" size="xs" />
        </div>

        {/* Summary */}
        <p className="text-sm text-paper-600 dark:text-paper-500 leading-relaxed flex-1 line-clamp-3 mb-4">
          {area.summary || (
            <span className="italic text-paper-400 dark:text-paper-700">
              No summary yet - click to add one.
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
                <span className="flex items-center gap-1 font-mono text-xs text-amber-500 dark:text-amber-400">
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
        <p className="text-sm text-red-500 mb-3">{message}</p>
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
                <p className={`font-mono uppercase tracking-widest text-[10px] mb-1.5 ${colorClass}`}>
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
                      <span className="font-display uppercase tracking-wide text-[11px] text-pitch-700 dark:text-paper-200 flex-shrink-0">
                        {t.area_name}
                      </span>
                      <span className="text-paper-400 dark:text-paper-700 text-xs flex-shrink-0">/</span>
                      <span className="flex-1 text-xs text-pitch-600 dark:text-paper-300 truncate">
                        {t.content}
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

