import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Radar, Check, X, Pencil, Loader2, AlertCircle, Calendar,
  MapPin, User, ChevronRight, RefreshCw, ExternalLink, Sparkles, Clock,
} from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import PageHeader from '../components/PageHeader'
import JiraIssueType from '../components/JiraIssueType'
import { listSignals, acceptSignal, reassignSignal, dismissSignal } from '../api/signals'
import { syncNow } from '../api/microsoft'
import { jiraSyncNow } from '../api/jira'
import { areasApi } from '../api/client'
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
export default function Signals() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)  // { items, pending_count, ai_configured }
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [syncNote, setSyncNote] = useState(null)  // neutral post-sync readout (e.g. "Jira: 3 found")
  const [isSyncing, setIsSyncing] = useState(false)
  const [activePicker, setActivePicker] = useState(null)  // signal id whose picker is open

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
      // Sync all connected sources in parallel — a disconnected Jira shouldn't
      // block an MS365 sync. Crucially, REPORT the Jira outcome: the sync
      // returns {skipped, reason} as a *resolved* promise, so without this a
      // token/endpoint problem (or a query that finds nothing) is invisible.
      const [, jiraResult] = await Promise.allSettled([syncNow(), jiraSyncNow()])
      const jira = jiraResult?.status === 'fulfilled' ? jiraResult.value : null
      if (jiraResult?.status === 'rejected') {
        setError(`Jira sync failed: ${jiraResult.reason?.message || 'unknown error'}`)
      } else if (jira?.skipped) {
        if (jira.reason === 'not_connected') {
          setError('Jira: the saved login has expired. Reconnect in Settings → Integrations.')
        } else if (jira.reason === 'api_error') {
          setError(`Jira sync failed: ${jira.error || 'the Jira API rejected the request'}`)
        }
      } else if (jira && !jira.skipped) {
        const f = jira.fetched ?? 0
        const n = jira.added ?? 0
        setSyncNote(
          f === 0
            ? 'Jira: connected, but no matching issues found (assigned, watching, or in an open sprint, and not Done).'
            : `Jira: ${f} issue${f === 1 ? '' : 's'} found${n ? `, ${n} new` : ' (already up to date)'}.`
        )
      }
      await refresh()
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
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
                className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-paper-500 dark:text-pitch-200"
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

      {data && data.items.length === 0 && (
        <EmptyState aiConfigured={data.ai_configured} />
      )}

      {data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              areas={areas}
              isPickerOpen={activePicker === signal.id}
              onTogglePicker={() => setActivePicker((cur) => cur === signal.id ? null : signal.id)}
              onAccept={async (payload) => {
                try {
                  await acceptSignal(signal.id, payload)
                  setActivePicker(null)
                  await refresh()
                } catch (e) { setError(e.message) }
              }}
              onReassign={async (payload) => {
                try {
                  await reassignSignal(signal.id, payload)
                  await refresh()
                } catch (e) { setError(e.message) }
              }}
              onDismiss={async () => {
                try {
                  await dismissSignal(signal.id)
                  setActivePicker(null)
                  await refresh()
                } catch (e) { setError(e.message) }
              }}
              onOpenAssigned={() => {
                if (signal.assigned_entry_id) {
                  navigate(`/thread/${signal.suggested_thread_id}?entry=${signal.assigned_entry_id}`)
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ aiConfigured }) {
  return (
    <div className="rounded-xl border border-dashed border-paper-300 dark:border-pitch-600 p-10 text-center">
      <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-paper-100 dark:bg-pitch-800 mb-4">
        <Radar size={26} className="text-paper-500 dark:text-paper-600" />
      </div>
      <h2 className="font-display font-medium text-lg text-pitch-800 dark:text-white mb-1">
        Signals clear
      </h2>
      <p className="text-sm text-paper-500 dark:text-paper-600 max-w-md mx-auto leading-snug">
        Nothing waiting. New Outlook meetings will appear here as they come in.
      </p>
      {!aiConfigured && (
        <p className="mt-4 text-xs text-paper-500 dark:text-paper-600 max-w-md mx-auto leading-snug">
          <Sparkles size={11} className="inline mr-1 text-amber-500" />
          AI Engine is not configured, so signals will arrive without suggested areas - you'll choose one yourself.
        </p>
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
          <h3 className="font-display font-medium text-base text-pitch-800 dark:text-white leading-tight">
            <BionicText>{signal.title}</BionicText>
          </h3>
          <MetaRow signal={signal} />
        </div>
        {isAssigned && (
          <button
            onClick={onOpenAssigned}
            className="flex-shrink-0 flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-mint-700 dark:text-mint-300 hover:underline"
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

function SourceBadge({ source, kind }) {
  // Jira items show their native issue-type tile (Epic/Story/Task/Sub-task/Bug)
  // so they read exactly like they do inside Jira.
  if (source === 'jira') {
    return <JiraIssueType kind={kind} />
  }
  const labels = {
    microsoft: { label: 'Outlook', color: 'text-[#0078D4] bg-[#0078D4]/10 border-[#0078D4]/20' },
  }
  const { label, color } = labels[source] || { label: source, color: 'text-paper-500 dark:text-paper-600 bg-paper-100 dark:bg-pitch-700 border-stone' }
  return (
    <span className={`inline-flex items-center text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${color}`}>
      {label}
    </span>
  )
}

function MetaRow({ signal }) {
  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-paper-500 dark:text-paper-600">
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

function SuggestionRow({ signal, areas, isPickerOpen, onTogglePicker, onAccept, onReassign, onDismiss }) {
  const [chosenAreaId, setChosenAreaId] = useState(signal.suggested_area_id || null)
  const [chosenThreadId, setChosenThreadId] = useState(signal.suggested_thread_id || null)
  const [newThreadTitle, setNewThreadTitle] = useState('')
  const [threadsInArea, setThreadsInArea] = useState([])

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
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-paper-200 dark:border-pitch-600">
      {/* Quick-accept row: AI's suggestion as a one-click button when present */}
      {signal.suggested_area_name && !isPickerOpen && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-paper-500 dark:text-paper-600">
            File under:
          </span>
          <span className="text-[11px] font-medium text-pitch-700 dark:text-paper-300">
            {signal.suggested_area_name}
            {signal.suggested_thread_title && <> · {signal.suggested_thread_title}</>}
          </span>
          <button
            onClick={onTogglePicker}
            className="text-[10px] font-mono uppercase tracking-wider text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 transition-colors"
          >
            change
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => onAccept({
                area_id: signal.suggested_area_id,
                thread_id: signal.suggested_thread_id || undefined,
                new_thread_title: signal.suggested_thread_id ? undefined : signal.title,
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
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
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
            <label className="text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 block mb-1">
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
              <label className="text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 block mb-1">
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
