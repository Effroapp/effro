import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { BrainCircuit, Check, X, RotateCcw, Upload, FileText, Mail, Calendar, ChevronRight, MessageSquare, CheckCheck, Plus, Edit3 } from 'lucide-react'
import { areasApi, generateApi, entriesApi, ingestApi } from '../api/client'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import Spinner from '../components/Spinner'
import AIRequiredCard from '../components/AIRequiredCard'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { ENTITY, entityFor } from '../utils/entityIcons'

const STORAGE_KEY = 'trace-process'

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSaved(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

function clearSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

// ─── Source chip ──────────────────────────────────────────────────────────────

const KIND_META = {
  pdf:  { Icon: FileText, label: 'PDF',      tint: 'text-red-500    dark:text-red-400'    },
  eml:  { Icon: Mail,     label: 'Email',    tint: 'text-violet-500 dark:text-violet-400' },
  ics:  { Icon: Calendar, label: 'Calendar', tint: 'text-emerald-500 dark:text-emerald-400' },
  text: { Icon: FileText, label: 'Text',     tint: 'text-paper-600   dark:text-paper-500'   },
}

function formatBytes(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function SourceChip({ source, onRemove }) {
  const meta = KIND_META[source.kind] || KIND_META.text
  const { Icon } = meta
  return (
    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500">
      <Icon size={14} className={`flex-shrink-0 ${meta.tint}`} />
      <span className="text-xs font-mono text-pitch-500 dark:text-paper-300 truncate flex-1 min-w-0">
        {source.name}
      </span>
      <span className="font-display uppercase tracking-wider text-xs text-paper-500 dark:text-paper-600 flex-shrink-0">
        {meta.label}
      </span>
      <span className="font-mono text-xs text-paper-400 dark:text-paper-700 flex-shrink-0">
        {formatBytes(source.bytes)}
      </span>
      <button
        onClick={onRemove}
        title="Remove source reference (text stays)"
        className="p-1 rounded text-paper-400 dark:text-paper-700 hover:text-red-500 transition-colors flex-shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  )
}


// ─── Intro step card ──────────────────────────────────────────────────────────

function Step({ n, label, hint }) {
  return (
    <div className="
      flex items-start gap-2.5 px-3 py-2.5 rounded-lg
      bg-white/60 dark:bg-pitch-700/60
      border border-paper-200 dark:border-pitch-500
    ">
      <span className="font-mono text-xs text-paper-700 dark:text-paper-200 mt-0.5 tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <div className="font-display uppercase tracking-wide text-xs text-pitch-800 dark:text-white">
          {label}
        </div>
        <div className="text-xs text-paper-600 dark:text-paper-500 mt-0.5 leading-snug">
          {hint}
        </div>
      </div>
    </div>
  )
}


// ─── Item card ────────────────────────────────────────────────────────────────

const NEW_THREAD_VAL = '__new__'

function ItemCard({ item: initialItem, selectedAreaName, resolveThread, onApproved, onDiscarded, bulkSignal, bulkScope, groupKey, grouped = false }) {
  const [currentItem, setCurrentItem] = useState(initialItem)
  const [status, setStatus] = useState('idle') // idle | approving | approved | rejecting | refining
  const [rejectionReason, setRejectionReason] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [flash, setFlash] = useState(false)
  const toast = useToast()

  // Keep a ref to the latest approve logic so bulkTrigger effect never goes stale
  const approveRef = useRef(null)
  approveRef.current = async () => {
    if (status !== 'idle') return
    setStatus('approving')
    try {
      // The destination is owned by the thread group header, so every item in a
      // group files into the same (re-pointable) thread. resolveThread() creates
      // a new thread once per group and dedupes by title.
      const threadId = await resolveThread()
      await entriesApi.create(threadId, {
        content: currentItem.content,
        type: currentItem.type,
        due_date: currentItem.due_date || undefined,
        meeting_at: currentItem.meeting_at || undefined,
      })
      setStatus('approved')
      setTimeout(() => {
        setCollapsed(true)
        setTimeout(onApproved, 400)
      }, 1500)
    } catch (e) {
      toast(e.message, 'error')
      setStatus('idle')
    }
  }

  const approve = useCallback(() => approveRef.current(), [])

  // Trigger from parent bulk approve. bulkScope is either 'all' or a specific
  // group key, so "Approve all in this thread" only fires that thread's cards.
  // The ref guard means we only act when the signal actually CHANGES after this
  // card mounted, never on mount. So an item that streams in AFTER you pressed
  // "Approve all" is left for you to review, not silently auto-approved.
  const bulkSeenRef = useRef(bulkSignal)
  useEffect(() => {
    if (bulkSignal === bulkSeenRef.current) return
    bulkSeenRef.current = bulkSignal
    if (bulkScope === 'all' || bulkScope === groupKey) {
      approveRef.current()
    }
  }, [bulkSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const discard = () => {
    setCollapsed(true)
    setTimeout(onDiscarded, 400)
  }

  const handleRefine = async () => {
    if (!rejectionReason.trim()) return
    setStatus('refining')
    try {
      const response = await generateApi.refine(currentItem, rejectionReason, selectedAreaName)
      setCurrentItem(response.item)
      setStatus('idle')
      setRejectionReason('')
      setFlash(true)
      setTimeout(() => setFlash(false), 300)
    } catch (e) {
      toast(e.message, 'error')
      setStatus('idle')
    }
  }

  const meta = entityFor(currentItem.type)
  const borderLeft = meta.borderLeft
  const badge = meta.badge
  const TypeIcon = meta.Icon
  // Timeline dot colour by type, matching the entry dots on the Threads page.
  const DOT_CLASS = {
    entry: 'bg-mint',
    todo: 'bg-sky-muted',
    decision: 'bg-amber-muted',
    meeting: 'bg-lavender',
    blockage: 'bg-terracotta',
  }
  const dotClass = DOT_CLASS[currentItem.type] || 'bg-mint'

  return (
    <div
      className={`relative ${grouped ? 'pl-10' : ''} overflow-hidden transition-all duration-400 ${
        collapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
      }`}
    >
      {/* Timeline dot - sits on the group's connector rail (grouped view only).
          Border matches the thread-card body so it reads as punching through. */}
      {grouped && (
        <span
          className={`absolute left-3 top-[15px] w-2.5 h-2.5 rounded-full border-2 border-white dark:border-pitch-700 z-10 ${dotClass}`}
        />
      )}
      <div
        className={`
          bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl overflow-hidden
          border-l-[3px] ${borderLeft}
          ${flash ? 'bg-paper-200 dark:bg-pitch-700 dark:bg-paper-200 dark:bg-pitch-700' : ''}
          transition-colors duration-300
        `}
      >
        {/* Header strip */}
        <div className="px-4 py-2.5 bg-paper-100/50 dark:bg-pitch-800/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`font-display uppercase text-xs px-1.5 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1 ${badge}`}>
              <TypeIcon size={10} />
              {meta.label}
            </span>
          </div>
          {currentItem.due_date && !['null', 'none', 'n/a', 'na', 'tbd'].includes(String(currentItem.due_date).trim().toLowerCase()) && (
            <span className="font-mono text-xs text-amber-500 flex-shrink-0 inline-flex items-center gap-1">
              <Calendar size={11} />
              {currentItem.due_date}
            </span>
          )}
        </div>

        {/* Content */}
        <div className={`px-4 py-3 transition-opacity duration-300 ${status === 'approved' ? 'opacity-50' : ''}`}>
          <p className="text-sm text-pitch-700 dark:text-paper-200">{currentItem.content}</p>
          <p className="text-xs text-paper-500 dark:text-paper-600 italic mt-1">Why: {currentItem.rationale}</p>
        </div>

        {/* Action row */}
        {status === 'approved' ? (
          <div className="px-4 py-3 border-t border-paper-100 dark:border-pitch-700">
            <span className="text-xs font-display uppercase tracking-wide text-paper-700 dark:text-paper-200">
              Added ✓
            </span>
          </div>
        ) : status === 'rejecting' || status === 'refining' ? (
          <div className="px-4 py-3 border-t border-paper-100 dark:border-pitch-700 space-y-2">
            <textarea
              rows={2}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Why are you rejecting this?"
              autoFocus
              className="
                w-full bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                rounded-lg px-3 py-2 text-sm resize-none
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={discard}
                className="
                  px-3 py-1.5 text-xs font-display uppercase tracking-wide rounded-md
                  text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-500
                  transition-colors
                "
              >
                Discard
              </button>
              <button
                onClick={handleRefine}
                disabled={!rejectionReason.trim() || status === 'refining'}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 text-xs font-display uppercase tracking-wide rounded-md
                  bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200 hover:bg-paper-300 dark:hover:bg-pitch-600
                  disabled:opacity-50 transition-colors
                "
              >
                {status === 'refining' && <Spinner size={11} />}
                Refine
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-2.5 border-t border-paper-100 dark:border-pitch-700 flex items-center justify-end gap-1">
            <button
              onClick={approve}
              disabled={status === 'approving'}
              title="Approve this item"
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display uppercase tracking-wide
                bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200 hover:bg-paper-300 dark:hover:bg-pitch-600
                transition-colors disabled:opacity-50
              "
            >
              {status === 'approving' ? <Spinner size={13} /> : <Check size={13} />}
              Approve
            </button>
            <button
              onClick={() => setStatus('rejecting')}
              title="Reject this item"
              className="
                flex items-center justify-center
                bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-500/20
                rounded-md p-2 transition-colors
              "
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Wave loader ──────────────────────────────────────────────────────────────
// Shimmer placeholders for the batch currently being extracted. Styled to match
// the AI Overview "generating" loading screen (ov-generating text shimmer), so
// the whole app speaks one visual language while the AI is thinking.

function WaveLoader({ count, label }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl overflow-hidden border-l-[3px] border-l-paper-300 dark:border-l-pitch-500"
        >
          <div className="px-4 py-2.5 bg-paper-100/50 dark:bg-pitch-800/30">
            <span className="font-mono text-xs ov-generating">scanning for the next item</span>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm ov-generating">
              {'█'.repeat(18 + ((i * 7) % 16))}
            </p>
          </div>
        </div>
      ))}
      <p className="text-[11px] font-mono text-paper-500 dark:text-pitch-200 text-center pt-0.5">
        {label}
      </p>
    </div>
  )
}

// A "this thread will be created for you" pill, shaped like the StatusBadge the
// real thread will wear once it exists.
function NewThreadPill() {
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0 whitespace-nowrap font-display font-medium rounded uppercase tracking-wide text-xs px-1.5 py-0.5 text-mint-700 dark:text-mint-300 bg-mint-50 dark:bg-mint-900/25 border border-mint/30">
      <Plus size={10} strokeWidth={3} />
      New
    </span>
  )
}

// ─── Thread group ─────────────────────────────────────────────────────────────
// Each destination thread is drawn as a real thread card: the same header (title
// + status pill) you see on the Threads page, and the items below sit on the
// connected-dot timeline that thread entries use. The review screen becomes a
// faithful preview of what the thread will look like once filed.

function ThreadGroup({ group, dest, areaThreads, onChange, collapsed, onToggle, onApproveAll, busy, children }) {
  const n = group.items.length
  const [editing, setEditing] = useState(false)
  const [newTitle, setNewTitle] = useState(dest.title)

  // Keep the new-thread input in step with the current destination.
  useEffect(() => { setNewTitle(dest.title) }, [dest.title])

  const pickExisting = (t) => { onChange({ kind: 'existing', threadId: t.id }); setEditing(false) }
  const applyNew = () => {
    const title = newTitle.trim()
    if (!title) return
    onChange({ kind: 'new', title })
    setEditing(false)
  }
  const currentExistingId = dest.kind === 'existing' ? dest.threadId : null

  return (
    <div className="rounded-xl border border-paper-300 dark:border-pitch-500 bg-white dark:bg-pitch-700 overflow-hidden">
      {/* Thread header - mirrors a thread card */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 bg-paper-100/50 dark:bg-pitch-800/30 border-b border-paper-200 dark:border-pitch-500">
        <button
          onClick={onToggle}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
          title={collapsed ? 'Expand thread' : 'Collapse thread'}
        >
          <ChevronRight
            size={15}
            className={`flex-shrink-0 text-paper-400 dark:text-paper-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <MessageSquare size={15} className="flex-shrink-0 text-paper-500 dark:text-paper-400" />
          <span className="font-display font-medium text-[15px] text-pitch-800 dark:text-white truncate min-w-0">
            {dest.title}
          </span>
          {dest.isExisting
            ? <span className="flex-shrink-0"><StatusBadge status={dest.status} type="thread" size="xs" /></span>
            : <NewThreadPill />}
          <span className="flex-shrink-0 font-mono text-xs text-paper-400 dark:text-paper-600 tabular-nums">
            {n} item{n === 1 ? '' : 's'}
          </span>
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setEditing((e) => !e)}
            title="Change which thread these items go into"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-display uppercase tracking-wide transition-colors ${
              editing
                ? 'text-pitch-700 dark:text-white bg-paper-300 dark:bg-pitch-600'
                : 'text-paper-600 dark:text-paper-300 hover:bg-paper-200 dark:hover:bg-pitch-600'
            }`}
          >
            <Edit3 size={12} />
            Change
          </button>
          {onApproveAll && (
            <button
              onClick={onApproveAll}
              disabled={busy}
              title={`Approve all ${n} items in this thread`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-display uppercase tracking-wide text-mint-700 dark:text-mint-300 bg-mint-50 dark:bg-mint-900/20 hover:bg-mint-100 dark:hover:bg-mint-900/35 disabled:opacity-50 transition-colors"
            >
              <CheckCheck size={12} />
              Approve all
            </button>
          )}
        </div>
      </div>

      {/* Destination editor - pick an existing thread, or name a new one */}
      {editing && (
        <div className="px-4 py-3 border-b border-paper-200 dark:border-pitch-500 bg-paper-100/30 dark:bg-pitch-800/20 space-y-3">
          <p className="text-[11px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-400">
            File these {n} item{n === 1 ? '' : 's'} into
          </p>

          {/* Create / rename a new thread */}
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 inline-flex items-center gap-1 text-mint-700 dark:text-mint-300 text-[11px] font-display uppercase tracking-wide">
              <Plus size={12} strokeWidth={3} /> New
            </span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyNew() }}
              placeholder="New thread name"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg bg-white dark:bg-pitch-700 border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-600 focus:outline-none focus:ring-2 focus:ring-mint-500"
            />
            <button
              onClick={applyNew}
              disabled={!newTitle.trim()}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-display uppercase tracking-wide rounded-md bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
            >
              Use
            </button>
          </div>

          {/* Or file into an existing thread */}
          {areaThreads.length > 0 && (
            <div>
              <p className="text-[11px] font-display uppercase tracking-widest text-paper-400 dark:text-paper-600 mb-1.5">
                Or an existing thread
              </p>
              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                {areaThreads.map((t) => {
                  const active = currentExistingId === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickExisting(t)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        active
                          ? 'bg-mint-50 dark:bg-mint-900/20 ring-1 ring-mint/40'
                          : 'hover:bg-paper-200 dark:hover:bg-pitch-600'
                      }`}
                    >
                      <StatusBadge status={t.status} type="thread" size="xs" />
                      <span className="min-w-0 truncate text-sm text-pitch-700 dark:text-paper-200">{t.title}</span>
                      {active && <Check size={13} className="ml-auto flex-shrink-0 text-mint-600 dark:text-mint-400" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Entry timeline - the connected-dot rail from the Threads page */}
      {!collapsed && (
        <div className="px-4 py-3.5">
          <div className="relative">
            <div className="absolute left-4 top-1.5 bottom-2 w-px bg-paper-300 dark:bg-pitch-500" />
            <div className="space-y-3">{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ProcessView ──────────────────────────────────────────────────────────────

export default function ProcessView() {
  // AI gate - checked first so the rest of the page doesn't even mount its
  // ingest/extract machinery when the engine isn't set up.
  const { configured: aiConfigured, loading: aiLoading } = useAIConfigured()

  // Initialise from localStorage so navigation away doesn't lose work
  const [selectedAreaId, setSelectedAreaId] = useState(() => loadSaved()?.selectedAreaId ?? null)
  const [inputText, setInputText]           = useState(() => loadSaved()?.inputText ?? '')
  const [items, setItems]                   = useState(() => loadSaved()?.items ?? [])
  const [hasExtracted, setHasExtracted]     = useState(() => loadSaved()?.hasExtracted ?? false)

  const [areas, setAreas]           = useState([])
  const [areaThreads, setAreaThreads] = useState([])
  const [processing, setProcessing] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const [error, setError]           = useState(null)
  // Bulk approve uses a monotonic signal + a scope ('all' or a group key) so a
  // per-thread "Approve all" fires only that thread's cards.
  const [bulkSignal, setBulkSignal] = useState(0)
  const [bulkScope, setBulkScope]   = useState(null)
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkRemaining, setBulkRemaining] = useState(0)
  // Incremental (waved) extraction progress + per-thread collapse state.
  const [waveLoading, setWaveLoading] = useState(false)  // a batch is in flight
  const [waveTarget, setWaveTarget]   = useState(0)       // how many placeholders to shimmer
  const [collapsedGroups, setCollapsedGroups] = useState({})
  // Per-group destination overrides, keyed by group key. Value is
  // { kind:'existing', threadId } or { kind:'new', title }. Absent = use the
  // group's own suggestion (existing match or a new thread named after it).
  const [groupDest, setGroupDest] = useState({})

  // Drag-drop ingest state
  const [parsing, setParsing]         = useState(false)
  const [parseSource, setParseSource] = useState(null)  // { name, kind, bytes }
  const [dragActive, setDragActive]   = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef   = useRef(null)
  // Per-extraction cache of new-thread creations, keyed by normalised title.
  // Ensures that several extracted items sharing the same "+ New thread: X"
  // converge into ONE thread instead of each creating its own duplicate, even
  // when "Approve all" fires every card at the same instant.
  const threadCacheRef = useRef(new Map())
  const toast = useToast()

  // Persist state whenever it changes
  useEffect(() => {
    saveSaved({ selectedAreaId, inputText, items, hasExtracted })
  }, [selectedAreaId, inputText, items, hasExtracted])

  useEffect(() => {
    areasApi.list().then(setAreas).catch(() => {})
  }, [])

  const selectedArea = areas.find((a) => a.id === selectedAreaId)

  useEffect(() => {
    if (!selectedAreaId) { setAreaThreads([]); return }
    areasApi.listThreads(selectedAreaId).then(setAreaThreads).catch(() => {})
  }, [selectedAreaId])

  const canSubmit = selectedAreaId && inputText.trim().length > 0 && !processing && !parsing

  // ── Drag-and-drop ingest ────────────────────────────────────────────────────

  const ingestFile = async (file) => {
    if (!file) return
    setParsing(true)
    setError(null)
    try {
      const result = await ingestApi.parseFile(file)
      setInputText((prev) => prev.trim() ? `${prev}\n\n${result.text}` : result.text)
      setParseSource({ name: result.source_name, kind: result.kind, bytes: result.bytes })
      toast(`Parsed ${result.source_name}`)
    } catch (e) {
      const msg = e.message || 'Failed to parse file'
      setError(msg)
      toast(msg, 'error')
    } finally {
      setParsing(false)
    }
  }

  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current++
    setDragActive(true)
  }
  const onDragLeave = (e) => {
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setDragActive(false)
    }
  }
  const onDragOver = (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
  }
  const onDrop = (e) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) ingestFile(file)
  }

  const handleBrowse = (e) => {
    const file = e.target.files?.[0]
    if (file) ingestFile(file)
    e.target.value = ''  // allow re-uploading the same filename
  }

  // Extract in waves of up to MAX_BATCH, accumulating to MAX_ITEMS. Each wave
  // tells the model what earlier waves already produced, so it continues with
  // fresh items and stops once it runs dry. Items render as each wave lands, so
  // you watch the list build up rather than staring at one long spinner.
  const MAX_ITEMS = 20
  const MAX_BATCH = 8

  const handleProcess = async () => {
    if (!canSubmit) return
    setProcessing(true)
    setProgressDone(false)
    setError(null)
    setItems([])
    setHasExtracted(false)
    setBulkSignal(0)
    setBulkScope(null)
    setBulkApproving(false)
    setCollapsedGroups({})
    setGroupDest({})
    threadCacheRef.current = new Map()  // fresh extraction, fresh new-thread cache

    const collected = []
    let idCounter = 0
    const titles = areaThreads.map((t) => t.title)

    try {
      while (collected.length < MAX_ITEMS) {
        const remaining = MAX_ITEMS - collected.length
        const limit = Math.min(MAX_BATCH, remaining)
        setWaveTarget(limit)
        setWaveLoading(true)

        const resp = await generateApi.process(
          selectedArea.name,
          inputText,
          parseSource?.kind || null,
          titles,
          selectedAreaId,
          collected.map((it) => it.content),  // exclude what we already have
          limit,
        )
        const fresh = (resp.items || []).slice(0, limit)
        if (fresh.length === 0) break

        // `collected` is the full fetched ledger (drives `exclude` + stable ids).
        // We APPEND each wave's new items rather than replacing the whole list,
        // so anything you approve or reject mid-extraction is never clobbered by
        // a later wave.
        const freshWithIds = fresh.map((it) => ({ ...it, _id: idCounter++ }))
        collected.push(...freshWithIds)
        setItems((prev) => [...prev, ...freshWithIds])
        setHasExtracted(true)
        setWaveLoading(false)

        // The model returned fewer than asked → it's out of meaningful items.
        if (fresh.length < limit) break
      }
      if (collected.length === 0) {
        toast('No actionable items found in that text.')
      }
      // New threads may now be referenced; refresh so dropdowns/badges are right.
      areasApi.listThreads(selectedAreaId).then(setAreaThreads).catch(() => {})
    } catch (e) {
      if ((e.message || '').includes('ANTHROPIC_API_KEY')) {
        setError('API key not configured - add ANTHROPIC_API_KEY to your .env file and rebuild.')
      } else {
        setError(e.message)
      }
    } finally {
      setWaveLoading(false)
      setProgressDone(true)
      setProcessing(false)
      if (collected.length > 0) setHasExtracted(true)
    }
  }

  // Resolve the destination thread for an approving item. If the user kept the
  // "+ New thread" default, create that thread ONCE per unique title and share
  // it across every item that named it (deduped via threadCacheRef, so a
  // simultaneous bulk approve can't race into duplicate threads).
  const resolveTargetThread = useCallback(async (selectedThreadId, rawTitle) => {
    if (selectedThreadId !== NEW_THREAD_VAL) return Number(selectedThreadId)
    const title = (rawTitle || '').trim() || 'General notes'
    const key = title.toLowerCase()
    const cache = threadCacheRef.current
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        // If a thread with this exact title already exists, reuse it rather than
        // minting a duplicate (covers typing an existing name in the editor).
        const existing = areaThreads.find((t) => (t.title || '').trim().toLowerCase() === key)
        if (existing) return existing.id
        const thread = await areasApi.createThread(selectedAreaId, { title, status: 'open' })
        // Surface the freshly created thread so later edits show it as existing.
        setAreaThreads((prev) =>
          prev.some((t) => (t.title || '').trim().toLowerCase() === key)
            ? prev
            : [...prev, thread]
        )
        return thread.id
      })())
    }
    return cache.get(key)
  }, [selectedAreaId, areaThreads])

  const handleItemApproved = (id) => {
    setItems((prev) => prev.filter((item) => item._id !== id))
    setBulkRemaining((c) => Math.max(0, c - 1))
  }

  const handleItemDiscarded = (id) => {
    setItems((prev) => prev.filter((item) => item._id !== id))
    if (bulkApproving) setBulkRemaining((c) => Math.max(0, c - 1))
  }

  useEffect(() => {
    if (bulkApproving && bulkRemaining === 0) setBulkApproving(false)
  }, [bulkApproving, bulkRemaining])

  const handleBulkApprove = () => {
    if (items.length === 0) return
    setBulkRemaining(items.length)
    setBulkApproving(true)
    setBulkScope('all')
    setBulkSignal((s) => s + 1)
  }

  const handleApproveGroup = (group) => {
    if (!group.items.length) return
    setBulkRemaining(group.items.length)
    setBulkApproving(true)
    setBulkScope(group.key)
    setBulkSignal((s) => s + 1)
  }

  const toggleGroup = (key) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))

  // Chunk items by destination thread, preserving first-seen order. For threads
  // that already exist we carry their real status so the group header can wear
  // the same status pill the thread does on the Threads page.
  const groups = useMemo(() => {
    const existingByKey = new Map(
      areaThreads.map((t) => [(t.title || '').trim().toLowerCase(), t])
    )
    const map = new Map()
    for (const it of items) {
      const title = (it.suggested_thread || 'General notes').trim()
      const key = title.toLowerCase()
      if (!map.has(key)) {
        const match = existingByKey.get(key)
        map.set(key, {
          key,
          title: match ? match.title : title,  // adopt the existing thread's exact casing
          isExisting: !!match,
          status: match?.status || 'open',
          threadId: match?.id ?? null,
          items: [],
        })
      }
      map.get(key).items.push(it)
    }
    return Array.from(map.values())
  }, [items, areaThreads])

  // The effective destination for a group: an explicit override if the user set
  // one, otherwise the group's own suggestion. Drives the header pill + filing.
  const destForGroup = useCallback((group) => {
    const ov = groupDest[group.key]
    if (ov?.kind === 'existing') {
      const t = areaThreads.find((x) => x.id === ov.threadId)
      return { kind: 'existing', threadId: ov.threadId, title: t?.title || group.title, isExisting: true, status: t?.status || 'open' }
    }
    if (ov?.kind === 'new') {
      return { kind: 'new', title: ov.title, isExisting: false }
    }
    if (group.isExisting) {
      return { kind: 'existing', threadId: group.threadId, title: group.title, isExisting: true, status: group.status }
    }
    return { kind: 'new', title: group.title, isExisting: false }
  }, [groupDest, areaThreads])

  // Resolve a group's chosen destination to a concrete thread id at approve time.
  const resolveThreadForGroup = useCallback((group) => {
    const dest = destForGroup(group)
    return dest.kind === 'existing'
      ? resolveTargetThread(String(dest.threadId), null)
      : resolveTargetThread(NEW_THREAD_VAL, dest.title)
  }, [destForGroup, resolveTargetThread])

  const setGroupDestination = (key, dest) =>
    setGroupDest((prev) => ({ ...prev, [key]: dest }))

  const handleClear = () => {
    clearSaved()
    setSelectedAreaId(null)
    setInputText('')
    setItems([])
    setHasExtracted(false)
    setError(null)
    setBulkApproving(false)
    setParseSource(null)
    setCollapsedGroups({})
    setGroupDest({})
    threadCacheRef.current = new Map()
  }

  // All items reviewed - show completion banner instead of results panel
  const allReviewed = hasExtracted && items.length === 0 && !processing

  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-6 md:px-8 pt-8">
        <PageHeader
          icon={BrainCircuit}
          title="Smart Generate"
          subtitle="Turn emails, notes, and files into structured items."
        />
      </div>

      {/* AI gate - show the empty state instead of the form when no engine
          is configured. Don't flash the form while we're still loading the
          status - wait until we know one way or the other. */}
      {aiLoading ? (
        <div className="max-w-5xl mx-auto px-6 md:px-8 py-12 flex justify-center">
          <Spinner />
        </div>
      ) : !aiConfigured ? (
        <div className="px-8 py-6">
          <AIRequiredCard feature="Smart Generate" />
        </div>
      ) : (
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-6 space-y-6">
        {/* Intro - short tagline + three-step "how it works" */}
        <div className="space-y-4">
          <p className="text-base leading-relaxed text-pitch-700 dark:text-paper-200 max-w-2xl">
            Turn messy input into structured items. Drop notes, emails,
            calendar invites, or PDFs - Effro extracts the to-dos,
            decisions, and context for you to approve.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Step n="01" label="Pick an area" hint="Where items will land" />
            <Step n="02" label="Drop or paste" hint="Email, calendar, PDF, or text" />
            <Step n="03" label="Review & approve" hint="Edit, refine, or reject each item" />
          </div>
        </div>

        {/* Input Panel */}
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`
            relative bg-white dark:bg-pitch-700 border rounded-xl p-6 transition-colors
            ${dragActive
              ? 'border-mint-500 ring-2 ring-mint-500/40'
              : 'border-paper-300 dark:border-pitch-500'
            }
          `}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="font-display uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600">
              Generate from notes
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="
                flex items-center gap-1.5 text-xs font-display uppercase tracking-wide transition-colors
                text-paper-500 dark:text-paper-600
                hover:text-paper-700 dark:hover:text-paper-200
                disabled:opacity-50
              "
            >
              <Upload size={12} />
              {parsing ? 'Parsing…' : 'Browse file'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.eml,.ics,.ical,.txt,.md,.markdown,.log,.csv"
              onChange={handleBrowse}
              className="hidden"
            />
          </div>

          {/* Area selector */}
          <div className="mb-4">
            <p className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Area <span className="text-red-500">*</span>
            </p>
            <div className={`
              flex flex-wrap gap-2 p-1 -m-1 rounded-md transition-colors
              ${!selectedAreaId && inputText.trim().length > 0
                ? 'ring-1 ring-amber-500/40 bg-amber-500/5'
                : ''
              }
            `}>
            {areas.map((area) => (
              <button
                key={area.id}
                onClick={() => setSelectedAreaId(area.id)}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-display uppercase tracking-wide transition-colors
                  ${selectedAreaId === area.id
                    ? 'bg-mint-700 text-white'
                    : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                  }
                `}
              >
                {area.name}
              </button>
            ))}
            </div>
          </div>

          {/* Parsed-source chip */}
          {parseSource && (
            <SourceChip
              source={parseSource}
              onRemove={() => setParseSource(null)}
            />
          )}

          {/* Textarea */}
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Paste notes, or drop a PDF, email (.eml), or calendar invite (.ics) anywhere on this panel…"
            className="
              w-full min-h-[200px] bg-paper-100 dark:bg-pitch-700
              border border-paper-300 dark:border-paper-700
              rounded-lg px-3 py-2.5 font-sans text-sm resize-y
              text-pitch-800 dark:text-white
              placeholder:text-paper-400 dark:placeholder:text-paper-700
              focus:outline-none focus:ring-2 focus:ring-mint-500
              mb-2
            "
          />

          <p className="text-xs font-mono text-paper-400 dark:text-paper-700 mb-4">
            Drop a file anywhere on this panel to ingest it.
          </p>

          {/* Drop overlay */}
          {dragActive && (
            <div className="
              absolute inset-0 z-20 rounded-xl flex flex-col items-center justify-center gap-2
              bg-paper-200 dark:bg-pitch-700 dark:bg-paper-300 dark:bg-pitch-600 backdrop-blur-sm pointer-events-none
              border-2 border-dashed border-mint-500
            ">
              <Upload size={28} className="text-mint-700" />
              <p className="font-display uppercase tracking-widest text-sm text-paper-700 dark:text-paper-200">
                Drop to parse
              </p>
              <p className="font-mono text-xs text-paper-600 dark:text-paper-500">
                PDF · EML · ICS · TXT
              </p>
            </div>
          )}

          {/* Parsing overlay */}
          {parsing && !dragActive && (
            <div className="
              absolute inset-0 z-20 rounded-xl flex flex-col items-center justify-center gap-2
              bg-white/70 dark:bg-pitch-700/80 backdrop-blur-sm pointer-events-none
            ">
              <Spinner size={24} className="text-mint-700" />
              <p className="font-display uppercase tracking-widest text-xs text-paper-600 dark:text-paper-500">
                Parsing…
              </p>
            </div>
          )}

          {/* Loading state or submit button. The detailed progress now lives in
              the results panel (waves of cards), so here we just show a compact
              "working" state in place of the button. */}
          {processing ? (
            <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-mint-700/85 text-white text-sm font-display uppercase tracking-wide">
              <Spinner size={14} />
              Extracting…
            </div>
          ) : (
            <>
              <button
                onClick={handleProcess}
                disabled={!canSubmit}
                title={
                  !selectedAreaId      ? 'Select an area first' :
                  !inputText.trim()    ? 'Add text first' :
                  parsing              ? 'Parsing file…' :
                  'Send to AI'
                }
                className="
                  w-full flex items-center justify-center gap-2 py-2.5 rounded-lg
                  bg-mint-700 hover:bg-mint-800 text-white text-sm
                  font-display uppercase tracking-wide
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                "
              >
                <BrainCircuit size={14} />
                Extract Items
              </button>
            </>
          )}

          {/* Error state */}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-200 dark:border-red-900/50">
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={() => { setError(null); handleProcess() }}
                className="mt-2 text-xs font-display uppercase tracking-wide text-paper-500 hover:text-pitch-500 dark:hover:text-paper-300 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* All reviewed - completion banner */}
        {allReviewed && (
          <div className="
            bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl
            px-6 py-5 flex items-center justify-between gap-4
          ">
            <div>
              <p className="font-display uppercase tracking-widest text-xs text-paper-700 dark:text-paper-200 mb-0.5">
                All items reviewed
              </p>
              <p className="text-xs text-paper-500 dark:text-paper-600">
                Clear this session to start a new extraction.
              </p>
            </div>
            <button
              onClick={handleClear}
              className="
                flex items-center gap-2 px-4 py-2 rounded-lg
                bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500
                text-xs font-display uppercase tracking-wide text-paper-700 dark:text-paper-400
                transition-colors flex-shrink-0
              "
            >
              <RotateCcw size={12} />
              Clear
            </button>
          </div>
        )}

        {/* Results Panel - grouped by thread, building up wave by wave */}
        {(items.length > 0 || waveLoading) && (
          <div>
            <div className="flex items-start justify-between mb-1">
              <div>
                <span className="font-display uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600">
                  Extracted Items
                </span>
                <p className="text-xs text-paper-600 dark:text-paper-500 italic mt-1">
                  {processing
                    ? 'Pulling items in waves. They group into threads as they arrive.'
                    : `Drafted ${items.length} item${items.length === 1 ? '' : 's'} across ${groups.length} thread${groups.length === 1 ? '' : 's'}. Approve a whole thread, or review one item at a time.`}
                </p>
              </div>
              <span className="font-mono text-xs text-paper-500 dark:text-paper-600 flex-shrink-0 ml-4 mt-0.5">
                {processing
                  ? `${items.length} so far…`
                  : `${items.length} item${items.length === 1 ? '' : 's'} · ${groups.length} thread${groups.length === 1 ? '' : 's'}`}
              </span>
            </div>

            <div className="space-y-4 mt-4">
              {groups.map((group) => (
                <ThreadGroup
                  key={group.key}
                  group={group}
                  dest={destForGroup(group)}
                  areaThreads={areaThreads}
                  onChange={(dest) => setGroupDestination(group.key, dest)}
                  collapsed={!!collapsedGroups[group.key]}
                  onToggle={() => toggleGroup(group.key)}
                  onApproveAll={() => handleApproveGroup(group)}
                  busy={bulkApproving}
                >
                  {group.items.map((item) => (
                    <ItemCard
                      key={item._id}
                      item={item}
                      selectedAreaName={selectedArea?.name ?? ''}
                      resolveThread={() => resolveThreadForGroup(group)}
                      onApproved={() => handleItemApproved(item._id)}
                      onDiscarded={() => handleItemDiscarded(item._id)}
                      bulkSignal={bulkSignal}
                      bulkScope={bulkScope}
                      groupKey={group.key}
                      grouped
                    />
                  ))}
                </ThreadGroup>
              ))}

              {waveLoading && (
                <WaveLoader
                  count={waveTarget || MAX_BATCH}
                  label={items.length > 0 ? 'Looking for more items…' : 'Reading your text…'}
                />
              )}
            </div>

            {items.length > 0 && (
              <button
                onClick={handleBulkApprove}
                disabled={bulkApproving}
                className="
                  mt-4 w-full py-2.5 text-xs font-display uppercase tracking-wide rounded-lg
                  text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700
                  hover:bg-paper-300 dark:hover:bg-pitch-500
                  disabled:opacity-50 transition-colors
                "
              >
                {bulkApproving && bulkScope === 'all'
                  ? `Approving ${bulkRemaining} items…`
                  : processing
                    ? 'Approve all so far'
                    : 'Approve all remaining'}
              </button>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
