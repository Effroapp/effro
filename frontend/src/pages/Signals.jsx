import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Radar, Check, X, Pencil, Loader2, AlertCircle, Calendar,
  MapPin, User, ChevronRight, RefreshCw, ExternalLink, Clock,
  CheckCircle2, ChevronDown, Plug, Inbox,
} from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import PageHeader from '../components/PageHeader'
import IntroPanel, { Key } from '../components/IntroPanel'
import JiraIssueType from '../components/JiraIssueType'
import ProviderLogo from '../components/ProviderLogos'
import { listSignals, acceptSignal, reassignSignal, dismissSignal, syncAllSignals } from '../api/signals'
import { areasApi } from '../api/client'
import { openExternal } from '../api/tauri'
import { BionicText } from '../utils/bionic.jsx'

/**
 * Signals - triage surface for externally-sourced items waiting on a decision.
 *
 * Microsoft 365 is the first source; future Jira/GitHub items appear in the
 * same list with a different `source` value. The user accepts (commit to an
 * Entry), reassigns (override the AI suggestion without committing), or
 * dismisses (won't auto-revive).
 *
 * Layout: a list of cards, each showing the item title, time, location,
 * organiser, plus the AI's suggested area→thread with override controls.
 * Empty state is intentionally a quiet "signals clear" reward, not a nag
 * (per spec §9).
 */
// Per-app metadata for the source filter + grouping: an official logo (via
// ProviderLogo) and a short app label. Source-level, so each maps to one icon
// (Google = Gmail + Calendar; iCloud = Apple Mail + Calendar).
const SOURCE_META = {
  microsoft: { label: 'Outlook',  logo: 'microsoft' },
  google:    { label: 'Google',   logo: 'google' },
  icloud:    { label: 'iCloud',   logo: 'icloud' },
  github:    { label: 'GitHub',   logo: 'github' },
  jira:      { label: 'Jira',     logo: 'jira' },
  telegram:  { label: 'Telegram', logo: 'telegram' },
  mail:      { label: 'Email',    logo: 'mail' },
}
const SOURCE_ORDER = ['microsoft', 'google', 'icloud', 'github', 'jira', 'telegram', 'mail']

export default function Signals() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)  // { items, pending_count, ai_configured }
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [syncNote, setSyncNote] = useState(null)  // neutral post-sync readout (e.g. "Jira: 3 found")
  const [isSyncing, setIsSyncing] = useState(false)
  const [activePicker, setActivePicker] = useState(null)  // signal id whose picker is open
  const [activeSource, setActiveSource] = useState(null)  // null = All; else a source key
  const [showFiled, setShowFiled] = useState(false)       // reveal already-filed items

  const refresh = useCallback(async () => {
    try {
      const [signals, areaList] = await Promise.all([listSignals(), areasApi.list()])
      setData(signals)
      setAreas(areaList || [])
    } catch (e) {
      setError(e.message || 'Failed to load signals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleSyncNow = async () => {
    setIsSyncing(true)
    setError(null)
    setSyncNote(null)
    try {
      // One call pulls every connected source (registry-driven server side),
      // and the per-source results come back so problems are never invisible:
      // a broken connector is reported while the rest still sync.
      const { sources } = await syncAllSignals()
      const ran = []
      const problems = []
      Object.entries(sources || {}).forEach(([key, r]) => {
        const name = SOURCE_META[key]?.label || key
        if (!r) return
        if (r.skipped) {
          // not_connected is normal (nothing set up for that source) - quiet.
          if (r.reason && r.reason !== 'not_connected') {
            problems.push(`${name}: ${r.error || r.reason}`)
          }
          return
        }
        const n = r.added ?? 0
        ran.push(`${name}: ${n ? `${n} new` : 'up to date'}`)
      })
      if (problems.length) setError(problems.join(' · '))
      setSyncNote(
        ran.length
          ? ran.join(' · ')
          : 'No sources connected yet. Add one in Settings → Integrations.'
      )
      await refresh()
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  // ── Derived views ──────────────────────────────────────────────────────────
  const items = data?.items || []
  const pendingItems = items.filter((s) => s.status === 'pending')
  const filedItems = items.filter((s) => s.status === 'assigned')
  const pendingBySource = (src) => pendingItems.filter((s) => s.source === src)
  // Stable app order, with any unexpected source appended so nothing is hidden.
  const pendingSources = SOURCE_ORDER.filter((src) => pendingItems.some((s) => s.source === src))
  pendingItems.forEach((s) => { if (!pendingSources.includes(s.source)) pendingSources.push(s.source) })
  const visiblePending = activeSource ? pendingBySource(activeSource) : pendingItems
  const visibleFiled = activeSource ? filedItems.filter((s) => s.source === activeSource) : filedItems

  // One place to build a card, reused across the grouped, filtered and filed views.
  const renderCard = (signal) => (
    <SignalCard
      key={signal.id}
      signal={signal}
      areas={areas}
      isPickerOpen={activePicker === signal.id}
      onTogglePicker={() => setActivePicker((cur) => (cur === signal.id ? null : signal.id))}
      onAccept={async (payload) => {
        try { await acceptSignal(signal.id, payload); setActivePicker(null); await refresh() }
        catch (e) { setError(e.message) }
      }}
      onReassign={async (payload) => {
        try { await reassignSignal(signal.id, payload); await refresh() }
        catch (e) { setError(e.message) }
      }}
      onDismiss={async () => {
        try { await dismissSignal(signal.id); setActivePicker(null); await refresh() }
        catch (e) { setError(e.message) }
      }}
      onOpenAssigned={() => {
        if (signal.assigned_entry_id) navigate(`/thread/${signal.suggested_thread_id}?entry=${signal.assigned_entry_id}`)
      }}
    />
  )

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-pitch-800">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
      {/* Header */}
      <PageHeader
        icon={Radar}
        title="Signals"
        subtitle="What needs your attention, from your connected tools."
        right={
          <>
            {data && data.pending_count > 0 && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-mint-50 dark:bg-mint-900/30 text-mint-700 dark:text-mint-300">
                {data.pending_count} pending
              </span>
            )}
            {data?.last_synced && !isSyncing && (
              <span
                className="hidden sm:flex items-center gap-1.5 text-2xs font-mono text-paper-500 dark:text-pitch-200"
                title={`Last synced ${format(parseUTC(data.last_synced), 'EEE d MMM, HH:mm')}`}
              >
                <Clock size={11} className="flex-shrink-0" />
                Synced {formatDistanceToNow(parseUTC(data.last_synced))} ago
              </span>
            )}
            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs
                text-paper-700 dark:text-paper-200
                hover:bg-paper-200 dark:hover:bg-pitch-700
                disabled:opacity-40
                font-display uppercase tracking-wide transition-colors
              "
            >
              {isSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          </>
        }
      />

      {/* First-run explainer - shown once, then dismissed for good. */}
      <IntroPanel icon={Radar} title="Welcome to Signals" storageKey="effro.signalsIntroSeen">
        Signals is a gentle holding area for the things your connected tools
        surface, the <Key>meetings</Key>, <Key>emails</Key>, <Key>issues</Key>{' '}
        and <Key>pull requests</Key> waiting on one small decision from you.
        Accept an item onto a thread, reassign it, or quietly let it go. We keep
        it because the important bits deserve one calm place rather than a dozen
        scattered tabs, and because nothing should slip by while you are head
        down in deeper work.
      </IntroPanel>

      {error && (
        <div className="mb-4 rounded-lg border border-terracotta/30 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </div>
      )}

      {syncNote && !error && (
        <p className="mb-4 font-mono text-xs text-paper-500 dark:text-pitch-100">
          {syncNote}
        </p>
      )}

      {loading && !data && (
        <div className="space-y-3 animate-pulse">
          <div className="h-24 rounded-lg bg-paper-200 dark:bg-pitch-700" />
          <div className="h-24 rounded-lg bg-paper-200 dark:bg-pitch-700" />
          <div className="h-24 rounded-lg bg-paper-200 dark:bg-pitch-700" />
        </div>
      )}

      {/* Empty list: nothing connected yet vs all caught up. */}
      {data && items.length === 0 && (
        data.integrations_configured
          ? <CaughtUp />
          : <NothingConnected onConnect={() => navigate('/settings')} />
      )}

      {/* Connected and a clear queue: caught up, with filed available on demand. */}
      {data && items.length > 0 && pendingItems.length === 0 && (
        <>
          <CaughtUp />
          <FiledReveal items={filedItems} show={showFiled} onToggle={() => setShowFiled((v) => !v)} renderCard={renderCard} />
        </>
      )}

      {/* The working view: app filter + grouped 'to file' + filed reveal. */}
      {data && pendingItems.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <FilterChip
              active={activeSource === null}
              onClick={() => setActiveSource(null)}
              icon={Inbox}
              label="All"
              count={pendingItems.length}
            />
            {pendingSources.map((src) => (
              <FilterChip
                key={src}
                active={activeSource === src}
                onClick={() => setActiveSource((cur) => (cur === src ? null : src))}
                logo={SOURCE_META[src]?.logo}
                label={SOURCE_META[src]?.label || src}
                count={pendingBySource(src).length}
              />
            ))}
          </div>

          {activeSource === null ? (
            <div className="space-y-6">
              {pendingSources.map((src) => (
                <div key={src}>
                  <div className="flex items-center gap-2 mb-2.5">
                    {SOURCE_META[src]?.logo
                      ? <ProviderLogo provider={SOURCE_META[src].logo} size={15} />
                      : <Radar size={14} className="text-paper-500 dark:text-paper-600" />}
                    <h2 className="font-display text-sm font-semibold text-pitch-800 dark:text-white">
                      {SOURCE_META[src]?.label || src}
                    </h2>
                    <span className="font-mono text-2xs text-paper-500 dark:text-paper-600">
                      {pendingBySource(src).length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {pendingBySource(src).map(renderCard)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {visiblePending.map(renderCard)}
            </div>
          )}

          <FiledReveal items={visibleFiled} show={showFiled} onToggle={() => setShowFiled((v) => !v)} renderCard={renderCard} />
        </>
      )}
      </div>
    </div>
  )
}

// ─── Empty + caught-up states ────────────────────────────────────────────────

function CaughtUp() {
  return (
    <div className="rounded-xl border border-dashed border-paper-300 dark:border-pitch-600 p-10 text-center animate-rise motion-reduce:animate-none">
      <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-mint-50 dark:bg-mint-900/20 mb-4">
        <CheckCircle2 size={26} className="text-mint-600 dark:text-mint-400" />
      </div>
      <h2 className="font-display font-medium text-lg text-pitch-800 dark:text-white mb-1">
        You're all caught up
      </h2>
      <p className="text-sm text-paper-500 dark:text-paper-600 max-w-md mx-auto leading-snug">
        Nothing waiting to file. New items from your connected tools will appear here as they arrive.
      </p>
    </div>
  )
}

function NothingConnected({ onConnect }) {
  return (
    <div className="rounded-xl border border-dashed border-paper-300 dark:border-pitch-600 p-10 text-center animate-rise motion-reduce:animate-none">
      <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-paper-100 dark:bg-pitch-800 mb-4">
        <Plug size={24} className="text-paper-500 dark:text-paper-600" />
      </div>
      <h2 className="font-display font-medium text-lg text-pitch-800 dark:text-white mb-1">
        Nothing set up yet
      </h2>
      <p className="text-sm text-paper-500 dark:text-paper-600 max-w-md mx-auto leading-snug mb-5">
        Connect the tools you already use, Outlook, Google, iCloud, GitHub or Jira, and the meetings,
        emails, issues and pull requests that need a decision will flow into Effro here.
      </p>
      <button
        onClick={onConnect}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-mint-700 hover:bg-mint-800 text-white text-sm font-medium transition-colors"
      >
        <Plug size={14} /> Connect your tools
      </button>
    </div>
  )
}

// ─── Source filter chip ──────────────────────────────────────────────────────

function FilterChip({ active, onClick, logo, icon: Icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full border text-xs transition-colors
        ${active
          ? 'border-mint-600 bg-mint-50 dark:bg-mint-900/20 text-mint-800 dark:text-mint-200'
          : 'border-paper-300 dark:border-pitch-500 text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-700'}
      `}
    >
      {logo ? <ProviderLogo provider={logo} size={14} /> : Icon ? <Icon size={13} /> : null}
      <span className="font-medium">{label}</span>
      <span className={`font-mono ${active ? 'text-mint-700 dark:text-mint-300' : 'text-paper-500 dark:text-paper-600'}`}>
        {count}
      </span>
    </button>
  )
}

// ─── Filed (already-accepted) reveal ─────────────────────────────────────────

function FiledReveal({ items, show, onToggle, renderCard }) {
  if (!items || items.length === 0) return null
  return (
    <div className="mt-6">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
      >
        <ChevronDown size={13} className={`transition-transform ${show ? '' : '-rotate-90'}`} />
        {show ? 'Hide filed' : `Show ${items.length} filed`}
      </button>
      {show && (
        <div className="space-y-3 mt-3">
          {items.map(renderCard)}
        </div>
      )}
    </div>
  )
}

// ─── Signal card ─────────────────────────────────────────────────────────────

function SignalCard({
  signal, areas, isPickerOpen,
  onTogglePicker, onAccept, onReassign, onDismiss, onOpenAssigned,
}) {
  const isAssigned = signal.status === 'assigned'

  return (
    <div className={`
      rounded-lg border p-4
      bg-white dark:bg-pitch-700
      border-paper-300 dark:border-pitch-500
      ${isAssigned ? 'opacity-70' : ''}
    `}>
      {/* Header row: title + status */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <SourceBadge source={signal.source} kind={signal.kind} />
          </div>
          {/* Clamped: meeting subjects are short, but a forwarded Telegram
              message or email can be a wall of text - keep the card calm. */}
          <h3 className="font-display font-medium text-base text-pitch-800 dark:text-white leading-tight line-clamp-3 break-words">
            <BionicText>{signal.title}</BionicText>
          </h3>
          <MetaRow signal={signal} />
        </div>
        {isAssigned && (
          <button
            onClick={onOpenAssigned}
            className="flex-shrink-0 flex items-center gap-1 text-2xs font-mono uppercase tracking-wider text-mint-700 dark:text-mint-300 hover:underline"
          >
            <Check size={10} strokeWidth={3} /> filed <ExternalLink size={10} />
          </button>
        )}
      </div>

      {/* Suggestion + actions */}
      {!isAssigned && (
        <>
          <SuggestionRow
            signal={signal}
            areas={areas}
            isPickerOpen={isPickerOpen}
            onTogglePicker={onTogglePicker}
            onAccept={onAccept}
            onReassign={onReassign}
            onDismiss={onDismiss}
          />
        </>
      )}
    </div>
  )
}

// Where exactly this came from, one notch finer than the source: the app
// surface (Gmail vs Google Calendar) or the item type (PR vs Issue).
const BADGE_LABEL = {
  microsoft: 'Outlook',
  'google:meeting': 'Google Calendar',
  'google:email': 'Gmail',
  'icloud:meeting': 'iCloud Calendar',
  'icloud:email': 'Apple Mail',
  'github:pr': 'Pull request',
  'github:issue': 'Issue',
  telegram: 'Telegram',
  mail: 'Email',
}

function SourceBadge({ source, kind }) {
  // The brand mark carries the identity; the chrome stays neutral and calm.
  // Jira keeps its native issue-type tile (Epic/Story/Bug...) next to the
  // logo, so issues read exactly like they do inside Jira.
  const logo = SOURCE_META[source]?.logo
  const label = BADGE_LABEL[`${source}:${kind}`] || BADGE_LABEL[source] || SOURCE_META[source]?.label || source
  return (
    <span className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-[3px] rounded-md
                     bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500"
          title={SOURCE_META[source]?.label || source}>
      {logo && <ProviderLogo provider={logo} size={13} />}
      {source === 'jira'
        ? <JiraIssueType kind={kind} size={13} />
        : <span className="text-2xs font-medium text-pitch-700 dark:text-paper-300">{label}</span>}
    </span>
  )
}

function MetaRow({ signal }) {
  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-2xs text-paper-500 dark:text-paper-600">
      {signal.starts_at && (
        <span className="inline-flex items-center gap-1">
          <Calendar size={11} />
          {formatMeetingTime(signal.starts_at, signal.is_all_day)}
        </span>
      )}
      {signal.organizer && (
        <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
          <User size={11} />
          <span className="truncate">{signal.organizer}</span>
        </span>
      )}
      {signal.location && (
        <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
          <MapPin size={11} />
          <span className="truncate">{signal.location}</span>
        </span>
      )}
      {signal.external_url && (
        <a
          href={signal.external_url}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openExternal(signal.external_url) }}
          className="inline-flex items-center gap-1 text-mint-700 dark:text-mint-300 hover:underline cursor-pointer"
        >
          <ExternalLink size={11} />
          Open in {
            signal.source === 'jira' ? 'Jira'
              : signal.source === 'github' ? 'GitHub'
              : signal.source === 'google' ? (signal.kind === 'email' ? 'Gmail' : 'Calendar')
              : 'Outlook'
          }
        </a>
      )}
    </div>
  )
}

// Backend timestamps are naive UTC; tag them so the browser localises correctly.
function parseUTC(s) {
  if (!s) return null
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z')
}

function formatMeetingTime(iso, allDay) {
  try {
    const d = parseISO(iso)
    if (allDay) return format(d, 'EEE d MMM')
    return `${format(d, 'EEE d MMM, HH:mm')} · ${formatDistanceToNow(d, { addSuffix: true })}`
  } catch {
    return iso
  }
}

// ─── Suggestion + actions row ────────────────────────────────────────────────

// How an accepted signal can land. Calendar items default to a meeting;
// everything else to a to-do. Decision and Note are always on offer; Link
// appears when the signal carries a URL (its deep link, or one found in the
// captured text), File when a Telegram attachment can be downloaded.
const CREATE_AS_LABEL = { meeting: 'Meeting', todo: 'To-do', decision: 'Decision', note: 'Note', link: 'Link', file: 'File' }
const createAsOptions = (signal) => {
  const opts = signal.kind === 'meeting'
    ? ['meeting', 'todo', 'decision', 'note']
    : ['todo', 'decision', 'note']
  if (signal.link_url) opts.push('link')
  if (signal.has_media) opts.push('file')
  return opts
}
const defaultCreateAs = (kind) => (kind === 'meeting' ? 'meeting' : 'todo')

function SuggestionRow({ signal, areas, isPickerOpen, onTogglePicker, onAccept, onReassign, onDismiss }) {
  const [chosenAreaId, setChosenAreaId] = useState(signal.suggested_area_id || null)
  const [chosenThreadId, setChosenThreadId] = useState(signal.suggested_thread_id || null)
  const [newThreadTitle, setNewThreadTitle] = useState('')
  const [threadsInArea, setThreadsInArea] = useState([])
  const [createAs, setCreateAs] = useState(defaultCreateAs(signal.kind))
  const typeOpts = createAsOptions(signal)

  // Load threads when an area is picked, for the existing-thread dropdown.
  useEffect(() => {
    if (!chosenAreaId) {
      setThreadsInArea([])
      return
    }
    areasApi.listThreads(chosenAreaId)
      .then((rows) => setThreadsInArea(rows || []))
      .catch(() => setThreadsInArea([]))
  }, [chosenAreaId])

  const accept = () => {
    if (!chosenAreaId) return
    onAccept({
      area_id: chosenAreaId,
      thread_id: chosenThreadId || undefined,
      new_thread_title: !chosenThreadId ? (newThreadTitle || signal.title) : undefined,
      create_as: createAs,
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-paper-200 dark:border-pitch-600">
      {/* Add-as type choice - what the accepted signal becomes on the thread. */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-2xs font-mono uppercase tracking-wider text-paper-500 dark:text-paper-600">Add as</span>
        <div className="inline-flex rounded-md border border-paper-300 dark:border-pitch-500 overflow-hidden">
          {typeOpts.map((o) => (
            <button
              key={o}
              onClick={() => setCreateAs(o)}
              className={`px-2 py-0.5 text-2xs transition-colors ${
                createAs === o
                  ? 'bg-mint-700 text-white'
                  : 'text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600'
              }`}
            >
              {CREATE_AS_LABEL[o]}
            </button>
          ))}
        </div>
      </div>

      {/* Quick-accept row: AI's suggestion as a one-click button when present */}
      {signal.suggested_area_name && !isPickerOpen && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-2xs text-paper-500 dark:text-paper-600">
            File under:
          </span>
          <span className="text-2xs font-medium text-pitch-700 dark:text-paper-300">
            {signal.suggested_area_name}
            {signal.suggested_thread_title && <> · {signal.suggested_thread_title}</>}
          </span>
          <button
            onClick={onTogglePicker}
            className="text-2xs font-mono uppercase tracking-wider text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
          >
            change
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => onAccept({
                area_id: signal.suggested_area_id,
                thread_id: signal.suggested_thread_id || undefined,
                new_thread_title: signal.suggested_thread_id ? undefined : signal.title,
                create_as: createAs,
              })}
              className="
                flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                bg-mint-700 hover:bg-mint-800 text-white
                transition-colors
              "
            >
              <Check size={11} /> Accept
            </button>
            <button
              onClick={onDismiss}
              className="
                flex items-center gap-1 px-2 py-1 rounded text-xs
                text-paper-500 dark:text-paper-600
                hover:bg-paper-200 dark:hover:bg-pitch-600
                hover:text-paper-700 dark:hover:text-paper-300
                transition-colors
              "
            >
              <X size={11} /> Dismiss
            </button>
          </div>
        </div>
      )}

      {/* No-strong-match: AI didn't suggest, user must pick */}
      {!signal.suggested_area_name && !isPickerOpen && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-2xs text-amber-600 dark:text-amber-400">
            No strong match - choose an area.
          </span>
          <button
            onClick={onTogglePicker}
            className="
              ml-auto px-2.5 py-1 rounded text-xs font-medium
              border border-mint-600 text-mint-700 dark:text-mint-300
              hover:bg-mint-50 dark:hover:bg-mint-900/20
              transition-colors
            "
          >
            <Pencil size={11} className="inline mr-1" /> Choose
          </button>
          <button
            onClick={onDismiss}
            className="
              flex items-center gap-1 px-2 py-1 rounded text-xs
              text-paper-500 dark:text-paper-600
              hover:bg-paper-200 dark:hover:bg-pitch-600
              hover:text-paper-700 dark:hover:text-paper-300
              transition-colors
            "
          >
            <X size={11} /> Dismiss
          </button>
        </div>
      )}

      {/* Picker - reveals on demand */}
      {isPickerOpen && (
        <div className="space-y-3 mt-1">
          <div>
            <label className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 block mb-1">
              Area
            </label>
            <select
              value={chosenAreaId || ''}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null
                setChosenAreaId(id)
                setChosenThreadId(null)
                if (id && id !== signal.suggested_area_id) {
                  onReassign({ area_id: id })
                }
              }}
              className="
                w-full px-3 py-2 rounded-lg text-sm
                bg-paper-100 dark:bg-pitch-800
                border border-paper-300 dark:border-pitch-500
                text-pitch-800 dark:text-white
              "
            >
              <option value="">Pick an area</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {chosenAreaId && (
            <div>
              <label className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 block mb-1">
                Thread
              </label>
              <select
                value={chosenThreadId || ''}
                onChange={(e) => setChosenThreadId(e.target.value ? Number(e.target.value) : null)}
                className="
                  w-full px-3 py-2 rounded-lg text-sm
                  bg-paper-100 dark:bg-pitch-800
                  border border-paper-300 dark:border-pitch-500
                  text-pitch-800 dark:text-white
                "
              >
                <option value="">New thread named "{signal.title.slice(0, 40)}{signal.title.length > 40 ? '…' : ''}"</option>
                {threadsInArea.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              {!chosenThreadId && (
                <input
                  type="text"
                  value={newThreadTitle}
                  onChange={(e) => setNewThreadTitle(e.target.value)}
                  placeholder={`Or rename: ${signal.title.slice(0, 40)}…`}
                  className="
                    mt-2 w-full px-3 py-2 rounded-lg text-sm
                    bg-paper-100 dark:bg-pitch-800
                    border border-paper-300 dark:border-pitch-500
                    text-pitch-800 dark:text-white
                  "
                />
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={accept}
              disabled={!chosenAreaId}
              className="
                flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium
                bg-mint-700 hover:bg-mint-800 text-white
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors
              "
            >
              <Check size={11} /> Accept & file
            </button>
            <button
              onClick={onTogglePicker}
              className="px-3 py-1.5 text-xs text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onDismiss}
              className="
                ml-auto flex items-center gap-1 px-2 py-1.5 rounded text-xs
                text-paper-500 dark:text-paper-600
                hover:bg-paper-200 dark:hover:bg-pitch-600
                hover:text-paper-700 dark:hover:text-paper-300
                transition-colors
              "
            >
              <X size={11} /> Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
