import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { BrainCircuit, Check, X, RotateCcw, Upload, FileText, Mail, Calendar, ChevronRight, MessagesSquare, CheckCheck } from 'lucide-react'
import { areasApi, generateApi, entriesApi, ingestApi } from '../api/client'
import PageHeader from '../components/PageHeader'
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

function ItemCard({ item: initialItem, areaId, areaThreads, selectedAreaName, resolveTargetThread, onApproved, onDiscarded, bulkSignal, bulkScope, groupKey, grouped = false, readOnly = false }) {
  const [currentItem, setCurrentItem] = useState(initialItem)
  const [status, setStatus] = useState('idle') // idle | approving | approved | rejecting | refining
  const [selectedThreadId, setSelectedThreadId] = useState(NEW_THREAD_VAL)
  const [rejectionReason, setRejectionReason] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [flash, setFlash] = useState(false)
  const [showPicker, setShowPicker] = useState(false)  // grouped mode: reveal the thread <select> on demand
  const toast = useToast()

  // If the AI's suggested_thread matches an existing thread in this area
  // (case-insensitive), pre-select it instead of defaulting to + New thread.
  // Recomputes whenever the suggestion changes (e.g. after a refine).
  useEffect(() => {
    if (!currentItem?.suggested_thread || areaThreads.length === 0) return
    if (selectedThreadId !== NEW_THREAD_VAL) return  // user already picked
    const target = currentItem.suggested_thread.trim().toLowerCase()
    const match = areaThreads.find(
      (t) => (t.title || '').trim().toLowerCase() === target
    )
    if (match) setSelectedThreadId(String(match.id))
  }, [currentItem.suggested_thread, areaThreads])

  // Keep a ref to the latest approve logic so bulkTrigger effect never goes stale
  const approveRef = useRef(null)
  approveRef.current = async () => {
    if (status !== 'idle') return
    setStatus('approving')
    try {
      // Parent dedupes new-thread creation by title, so multiple items naming
      // the same "+ New thread" converge into one thread instead of duplicating.
      const threadId = await resolveTargetThread(selectedThreadId, currentItem.suggested_thread)
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
  useEffect(() => {
    if (!bulkSignal) return
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

  return (
    <div
      className={`overflow-hidden transition-all duration-400 ${
        collapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
      }`}
    >
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
            <span className={`font-display uppercase text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${badge}`}>
              {currentItem.type}
            </span>
            {/* In grouped mode the thread is shown by the group header, so we
                don't repeat it here. Only show a thread label when ungrouped, or
                when the user has re-pointed this item away from its group. */}
            {(!grouped || (showPicker && selectedThreadId !== NEW_THREAD_VAL)) && (
              <span className="font-mono text-xs text-paper-500 dark:text-paper-600 truncate">
                {currentItem.suggested_thread}
              </span>
            )}
          </div>
          {currentItem.due_date && (
            <span className="font-mono text-xs text-amber-500 flex-shrink-0">
              {currentItem.due_date}
            </span>
          )}
        </div>

        {/* Content */}
        <div className={`px-4 py-3 transition-opacity duration-300 ${status === 'approved' ? 'opacity-50' : ''}`}>
          <p className="text-sm text-pitch-700 dark:text-paper-200">{currentItem.content}</p>
          <p className="text-xs text-paper-500 dark:text-paper-600 italic mt-1">Why: {currentItem.rationale}</p>
        </div>

        {/* Action row - hidden while extracting (readOnly) so a mid-wave
            setItems can never clobber an in-flight approval. */}
        {!readOnly && (status === 'approved' ? (
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
          <div className="px-4 py-3 border-t border-paper-100 dark:border-pitch-700 flex items-center justify-between gap-3">
            {(!grouped || showPicker) ? (
              <select
                value={selectedThreadId}
                onChange={(e) => setSelectedThreadId(e.target.value)}
                className="
                  flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg
                  bg-white dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                  text-pitch-500 dark:text-paper-300
                  focus:outline-none focus:ring-2 focus:ring-mint-500
                  font-display uppercase tracking-wide
                "
              >
                <option value={NEW_THREAD_VAL}>+ New thread: {currentItem.suggested_thread}</option>
                {areaThreads.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.title}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setShowPicker(true)}
                title="File this item in a different thread"
                className="text-xs font-display uppercase tracking-wide text-paper-400 dark:text-paper-600 hover:text-paper-600 dark:hover:text-paper-300 transition-colors"
              >
                Move
              </button>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={approve}
                disabled={status === 'approving'}
                title="Approve"
                className="
                  flex items-center justify-center
                  bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200 hover:bg-paper-300 dark:hover:bg-pitch-600
                  rounded-md p-2 transition-colors disabled:opacity-50
                "
              >
                {status === 'approving' ? (
                  <Spinner size={14} />
                ) : (
                  <Check size={14} />
                )}
              </button>
              <button
                onClick={() => setStatus('rejecting')}
                title="Reject"
                className="
                  flex items-center justify-center
                  bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-500/20
                  rounded-md p-2 transition-colors
                "
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
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

// ─── Thread group ─────────────────────────────────────────────────────────────
// Chunks extracted items by their destination thread so the reviewer sees one
// thread at a time instead of a flat wall of cards (kinder on working memory).

function ThreadGroup({ group, collapsed, onToggle, onApproveAll, busy, children }) {
  const n = group.items.length
  return (
    <div className="rounded-xl border border-paper-300 dark:border-pitch-500 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-paper-100/60 dark:bg-pitch-800/40 border-b border-paper-200 dark:border-pitch-600">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 min-w-0 text-left group/th"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronRight
            size={14}
            className={`flex-shrink-0 text-paper-400 dark:text-paper-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <MessagesSquare size={13} className="flex-shrink-0 text-paper-400 dark:text-paper-600" />
          <span className="font-display font-medium text-sm text-pitch-800 dark:text-white truncate">
            {group.title}
          </span>
          <span
            className={`flex-shrink-0 text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
              group.isExisting
                ? 'bg-mint-50 text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
                : 'bg-paper-200 text-paper-600 dark:bg-pitch-600 dark:text-paper-300'
            }`}
          >
            {group.isExisting ? 'existing' : 'new'}
          </span>
          <span className="flex-shrink-0 font-mono text-xs text-paper-400 dark:text-paper-600 tabular-nums">
            {n}
          </span>
        </button>
        {onApproveAll && (
          <button
            onClick={onApproveAll}
            disabled={busy}
            title={`Approve all ${n} items in this thread`}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-display uppercase tracking-wide text-paper-600 dark:text-paper-300 bg-paper-200/70 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-600 disabled:opacity-50 transition-colors"
          >
            <CheckCheck size={12} />
            Approve all
          </button>
        )}
      </div>
      {!collapsed && <div className="p-3 space-y-3">{children}</div>}
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

        fresh.forEach((it) => collected.push({ ...it, _id: idCounter++ }))
        setItems([...collected])
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
        const thread = await areasApi.createThread(selectedAreaId, { title, status: 'open' })
        // Surface the freshly created thread to any remaining cards so their
        // dropdowns show it as an existing option (and pre-select it).
        setAreaThreads((prev) =>
          prev.some((t) => (t.title || '').trim().toLowerCase() === key)
            ? prev
            : [...prev, thread]
        )
        return thread.id
      })())
    }
    return cache.get(key)
  }, [selectedAreaId])

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

  // Chunk items by destination thread, preserving first-seen order, and flag
  // whether each thread already exists in the area (existing vs new badge).
  const groups = useMemo(() => {
    const existing = new Set(
      areaThreads.map((t) => (t.title || '').trim().toLowerCase())
    )
    const map = new Map()
    for (const it of items) {
      const title = (it.suggested_thread || 'General notes').trim()
      const key = title.toLowerCase()
      if (!map.has(key)) {
        map.set(key, { key, title, isExisting: existing.has(key), items: [] })
      }
      map.get(key).items.push(it)
    }
    return Array.from(map.values())
  }, [items, areaThreads])

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
    threadCacheRef.current = new Map()
  }

  // All items reviewed - show completion banner instead of results panel
  const allReviewed = hasExtracted && items.length === 0 && !processing

  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      {/* Header */}
      <div className="max-w-3xl mx-auto px-8 pt-8">
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
        <div className="max-w-3xl mx-auto px-8 py-12 flex justify-center">
          <Spinner />
        </div>
      ) : !aiConfigured ? (
        <div className="px-8 py-6">
          <AIRequiredCard feature="Smart Generate" />
        </div>
      ) : (
      <div className="max-w-3xl mx-auto px-8 py-6 space-y-6">
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
                    ? 'Pulling items in waves. They group by thread as they arrive.'
                    : 'Grouped by thread. Approve a whole thread, or review one item at a time.'}
                </p>
              </div>
              <span className="font-mono text-xs text-paper-500 dark:text-paper-600 flex-shrink-0 ml-4 mt-0.5">
                {processing
                  ? `${items.length} so far…`
                  : `${items.length} item${items.length === 1 ? '' : 's'} found`}
              </span>
            </div>

            <div className="space-y-3 mt-3">
              {groups.map((group) => (
                <ThreadGroup
                  key={group.key}
                  group={group}
                  collapsed={!!collapsedGroups[group.key]}
                  onToggle={() => toggleGroup(group.key)}
                  onApproveAll={processing ? null : () => handleApproveGroup(group)}
                  busy={bulkApproving}
                >
                  {group.items.map((item) => (
                    <ItemCard
                      key={item._id}
                      item={item}
                      areaId={selectedAreaId}
                      areaThreads={areaThreads}
                      selectedAreaName={selectedArea?.name ?? ''}
                      resolveTargetThread={resolveTargetThread}
                      onApproved={() => handleItemApproved(item._id)}
                      onDiscarded={() => handleItemDiscarded(item._id)}
                      bulkSignal={bulkSignal}
                      bulkScope={bulkScope}
                      groupKey={group.key}
                      grouped
                      readOnly={processing}
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

            {!processing && items.length > 0 && (
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
