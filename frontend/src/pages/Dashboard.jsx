import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageSquare, ArrowRight, RefreshCw, Clock, Sparkles, RotateCcw, Leaf, ChevronDown, X, Plus, LayoutGrid } from 'lucide-react'
import { format, differenceInDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { parseUTC, compactAge } from '../utils/time.js'
import { areasApi, entriesApi } from '../api/client'
import { getTodayNudge, getRandomNudge } from '../api/nudges'
import InHandStrip from '../components/InHandStrip'
import { useEntriesChanged } from '../utils/entryEvents'
import { displayTitle } from '../utils/entries'
import WeeklyRoundupModal from '../components/WeeklyRoundupModal'
import NewAreaModal from '../components/NewAreaModal'
import { AreaIcon } from '../components/IconPicker'
import { getAreaStatus } from '../utils/status'
import { stripMarkdown } from '../utils/markdownEditing'
import { useDisplayName } from '../hooks/useDisplayName'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { BionicText } from '../utils/bionic.jsx'
import Zone from '../components/Zone'
import { useDashboardStyling } from '../hooks/useDashboardStyling'
import '../styles/dashboard-zones.css'

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

  // The dashboard owns the upcoming to-dos, because two things read them: the
  // status line counts them and Coming Up lists them.
  const [upcomingTodos, setUpcomingTodos] = useState([])
  const [inHandCount, setInHandCount] = useState(0)

  const loadUpcoming = useCallback(() => {
    entriesApi.getUpcoming(100).then(setUpcomingTodos).catch(() => {})
  }, [])
  useEffect(() => { loadUpcoming() }, [loadUpcoming])
  useEntriesChanged(loadUpcoming)

  // Layout and section style, both per device. They land on the root as data
  // attributes and one CSS file does the rest.
  const { layout, sectionStyle } = useDashboardStyling()


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

  // One deterministic line under the date, built from what is already on the
  // page. No AI, and nothing that needs fetching.
  const dueThisWeek = upcomingTodos.filter((t) => {
    const g = getDueGroup(t.due_date)
    return g === 'today' || g === 'week'
  }).length
  const statusLine = (() => {
    const parts = []
    if (inHandCount > 0) parts.push(`${inHandCount} in hand`)
    if (dueThisWeek > 0) parts.push(`${dueThisWeek} due this week`)
    return parts.length ? `${parts.join(', ')}.` : null
  })()

  // "12" normally, "4 of 12" when Focus is hiding some.
  const areaCountLabel = areas.length === 0
    ? null
    : displayAreas.length === areas.length
      ? String(areas.length)
      : `${displayAreas.length} of ${areas.length}`


  return (
    <div
      className="dashboard flex-1 min-h-screen"
      data-layout={layout}
      data-section-style={sectionStyle}
    >
      {/* Sub-toolbar (page-level, no brand). The chrome is .topbar in
          dashboard-zones.css, on the same --dz-* set as the zones, rather than
          a second set of Tailwind classes saying the same thing twice. */}
      <header className="topbar sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto w-full flex items-start justify-between gap-6 pr-14">
          <div className="min-w-0">
            {/* Greeting + date. Personal anchor - orients the eye and the
                hour. First-name only so the line stays short and warm. */}
            <h1 className="greet">
              {getTimeGreeting()}
              {firstName(displayName) && (
                <>, <span className="text-clay-text">{firstName(displayName)}</span></>
              )}
            </h1>
            <div className="status">
              <p className="date">
                {format(new Date(), 'EEEE, d MMMM')}
              </p>
              {/* Deterministic, from what is already on the page. Nothing here
                  is a nag: it is a count, not a demand. */}
              {statusLine && <p className="line">{statusLine}</p>}
            </div>
            {/* Clay hairline closing the personal block. Fades out rather than
                running the full width, so it reads as a flourish and not as a
                second divider under the header's own border. */}
            <span
              className="block h-px mt-2 max-w-[280px]"
              style={{
                background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--clay-500) 48%, transparent), transparent 62%)',
              }}
            />
          </div>

          {/* View + roundup controls only make sense once at least one area
              exists; on a fresh install the empty state below carries the page. */}
          {areas.length > 0 && (
          <div className="topbar-actions flex-shrink-0 pt-1">
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
              <span className="text-xs font-sans font-medium uppercase tracking-wide">Weekly Roundup</span>
            </button>
          </div>
          )}
        </div>

      </header>

      {/* ── Zones ── */}
      <div className="zones">
        {/* In Hand renders nothing at all when nothing is pinned. */}
        <InHandStrip onCount={setInHandCount} />

        {/* Coming Up and Areas share a band. Split turns it into two columns,
            the other two layouts leave it alone. */}
        <div className="band">
          <ComingUpStrip todos={upcomingTodos} />

          <Zone
            id="areas"
            title="Areas"
            count={areaCountLabel}
            bodyClass="area-grid"
            actions={<ViewSegmentedControl viewMode={viewMode} onChange={handleViewMode} />}
          >
            {areas.length === 0 ? (
              <EmptyState onCreate={() => setNewAreaOpen(true)} />
            ) : displayAreas.length === 0 ? (
              /* Focus mode with every area stable - a good day, not an error. */
              <p className="py-10 text-center text-sm italic text-paper-500 dark:text-paper-600">
                Everything is stable right now. Nothing needs your focus.
              </p>
            ) : (
              <>
                {displayAreas.map((area) => (
                  <AreaCard key={area.id} area={area} />
                ))}
                <NewAreaTile onClick={() => setNewAreaOpen(true)} />
              </>
            )}
          </Zone>
        </div>
      </div>

        {/* Daily insight - ambient by design: one muted, italic line on the
            page background (no box, no tint), a small leaf mark, and quiet
            controls that surface on hover. Minimal real-estate. */}
        {areas.length > 0 && nudge?.text && !nudgeDismissed && (
          <footer className="nudge group">
            <Leaf size={14} className="flex-shrink-0 mt-[3px] text-clay-fill" />
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
          </footer>
        )}


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
        newtile group flex flex-col items-center justify-center gap-2 rounded-xl
        min-h-[11rem] border-2 border-dashed
        border-paper-300 dark:border-pitch-500
        text-paper-500 dark:text-paper-600
        hover:border-mint-500/60 dark:hover:border-mint-400/40
        hover:text-mint-700 dark:hover:text-mint-300
        hover:bg-mint-50/40 dark:hover:bg-mint-900/10
        transition-colors animate-fade-in
      "
    >
      <Plus size={18} />
      <span className="text-xs font-sans font-medium uppercase tracking-wide">New area</span>
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
      <h2 className="title-section text-pitch-800 dark:text-white mb-2">
        Set up your first area
      </h2>
      <p className="text-sm text-paper-600 dark:text-paper-500 leading-relaxed mb-6">
        Areas are the big buckets your work lives in, like a product, a team or
        a client. Threads and updates sit inside them, so everything you capture
        has a home.
      </p>
      <button
        onClick={onCreate}
        className="btn btn-md btn-primary"
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
    <div className="seg inline-flex items-center gap-0.5 p-0.5 rounded-md bg-paper-200 dark:bg-pitch-700/60 border border-paper-300 dark:border-pitch-500">
      {VIEW_MODES.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`
            px-3 py-1 rounded text-xs font-sans font-medium uppercase tracking-wide transition-colors
            ${viewMode === key
              ? 'is-on bg-mint-50 dark:bg-mint-900/20 text-mint-700 dark:text-mint-300 shadow-sm'
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
  const config = getAreaStatus(area.status)
  const daysSinceUpdate = differenceInDays(new Date(), parseUTC(area.updated_at))
  // Stable areas recede so the urgent ones carry the eye. Present but quiet;
  // full weight returns on hover.
  const isStable = area.status === 'stable'
  const overview = area.summary || area.description

  return (
    <Link
      to={`/area/${area.id}`}
      // The accent and the badge follow the area's status. Blocked reads as
      // mustard here rather than its usual terracotta, because the dashboard
      // is where the day starts and nothing on it is allowed to alarm.
      style={{ '--acc': area.status === 'blocked' ? 'var(--mustard)' : config.dot }}
      className={`acard animate-fade-in ${isStable ? 'opacity-60 hover:opacity-100' : ''}`}
    >
      <div className="ahead">
        <AreaIcon name={area.icon || 'Folder'} size={16} className="ic" />
        <h3 className="atitle">{area.name}</h3>
        <span className="badge">{config.label}</span>
        {daysSinceUpdate >= INACTIVITY_THRESHOLD_DAYS && !isStable && (
          <span className="quiet flex flex-shrink-0 items-center gap-1 font-mono text-xs text-mustard">
            <Clock size={11} />
            {daysSinceUpdate}d quiet
          </span>
        )}
      </div>

      {/* The current overview when there is one, else the stable description,
          so a freshly created area says something until an overview exists. */}
      {overview ? (
        <p className="abody"><BionicText>{stripMarkdown(overview)}</BionicText></p>
      ) : (
        <p className="abody empty">No overview yet - click to add one.</p>
      )}

      <div className="afoot">
        <span className="l">
          <MessageSquare size={13} className="ic" />
          <span className="n">{area.open_thread_count}</span>/{area.thread_count} active
        </span>
        <span className="r">
          {compactAge(area.updated_at)}
          <ArrowRight size={13} className="ic" />
        </span>
      </div>
    </Link>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dashboard flex-1 min-h-screen">
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
function ComingUpStrip({ todos }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [showPast, setShowPast] = useState(false)

  // Bucket once, derive everything from the buckets.
  const buckets = { overdue: [], today: [], week: [] }
  todos.forEach((t) => {
    const g = getDueGroup(t.due_date)
    if (g === 'overdue' || g === 'today' || g === 'week') buckets[g].push(t)
  })

  const soon = [...buckets.today, ...buckets.week].sort((a, b) => {
    const byDate = String(a.due_date).localeCompare(String(b.due_date))
    return byDate !== 0 ? byDate : String(a.created_at).localeCompare(String(b.created_at))
  })
  const overdue = buckets.overdue

  // The existing rule: nothing coming and nothing late means nothing to show.
  if (soon.length === 0 && overdue.length === 0) return null

  const shown = expanded ? soon : soon.slice(0, 5)
  const weekLabel = soon.length > 0 ? `${soon.length} this week` : null
  const seeAll = soon.length > 5 ? (
    <button type="button" className="zact" onClick={() => setExpanded((v) => !v)}>
      {expanded ? 'Show fewer' : 'See all'}
    </button>
  ) : null

  const open = (t) => navigate(`/thread/${t.thread_id}?highlight=${t.id}`)

  return (
    <Zone id="coming" title="Coming up" count={weekLabel} bodyClass="card" actions={seeAll}>
      {shown.map((t) => (
        <ComingUpRow key={t.id} todo={t} onOpen={open} />
      ))}

      {/* Late items sit at the foot rather than the top, and never in red.
          Nothing here is an alarm. */}
      {overdue.length > 0 && (
        <>
          <div className="past">
            <span className="dot" />
            <span>
              {overdue.length === 1 ? '1 past its date' : `${overdue.length} past their date`}
            </span>
            <button type="button" className="zact" onClick={() => setShowPast((v) => !v)}>
              See these
            </button>
          </div>
          {showPast && overdue.map((t) => (
            <ComingUpRow key={t.id} todo={t} onOpen={open} showDate />
          ))}
        </>
      )}
    </Zone>
  )
}

function ComingUpRow({ todo, onOpen, showDate = false }) {
  const when = showDate
    ? format(parseISO(todo.due_date), 'd MMM')
    : getDueGroup(todo.due_date) === 'today'
      ? 'Today'
      : format(parseISO(todo.due_date), 'EEE')

  return (
    <button type="button" className="cu-row" onClick={() => onOpen(todo)}>
      <span className="when">{when}</span>
      <span className="cu-text">{displayTitle(todo)}</span>
      <span className="where">{todo.area_name}</span>
    </button>
  )
}
