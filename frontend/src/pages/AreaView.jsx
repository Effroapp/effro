import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Plus, Check, X, Edit3, RefreshCw, History, ChevronDown, ChevronUp, Sparkles, Clock, Wand2, GripVertical } from 'lucide-react'
import { format } from 'date-fns'
import { areasApi } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import ThreadCard from '../components/ThreadCard'
import Modal from '../components/Modal'
import IconPicker, { AreaIcon } from '../components/IconPicker'
import OverviewCard from '../components/OverviewCard'
import { useToast } from '../components/Toast'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { AREA_STATUSES, THREAD_STATUSES } from '../utils/status'
import { SECTION_ICONS } from '../utils/entityIcons'

export default function AreaView() {
  const { areaId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { configured: aiConfigured } = useAIConfigured()

  const [area, setArea] = useState(null)
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Editing states
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [savingSummary, setSavingSummary] = useState(false)
  const [suggestingSummary, setSuggestingSummary] = useState(false)

  const [editingStatus, setEditingStatus] = useState(false)

  // Auto-update toggle + the "apply to all areas?" inline prompt
  const [autoPrompt, setAutoPrompt] = useState(false)
  const [togglingAuto, setTogglingAuto] = useState(false)

  // New thread modal
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [threadForm, setThreadForm] = useState({ title: '', description: '', status: 'open' })
  const [creatingThread, setCreatingThread] = useState(false)

  const summaryRef = useRef(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [areaData, threadsData] = await Promise.all([
        areasApi.get(areaId),
        areasApi.listThreads(areaId),
      ])
      setArea(areaData)
      setSummaryDraft(areaData.summary || '')
      setThreads(threadsData)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [areaId])

  // ── Drag-to-reorder threads ──────────────────────────────────────────────────
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  const handleDragStart = (e, index) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))  // Firefox needs a payload
  }
  const handleDragOver = (e, index) => {
    if (dragIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overIndex !== index) setOverIndex(index)
  }
  const handleDragEnd = () => { setDragIndex(null); setOverIndex(null) }
  const handleDrop = (e, index) => {
    e.preventDefault()
    const from = dragIndex
    setDragIndex(null); setOverIndex(null)
    if (from === null || from === index) return
    const next = [...threads]
    const [moved] = next.splice(from, 1)
    next.splice(index, 0, moved)
    setThreads(next)  // optimistic
    areasApi.reorderThreads(areaId, next.map((t) => t.id)).catch((err) => {
      toast(err.message || 'Could not save the new order', 'error')
      load()  // revert to server truth
    })
  }

  useEffect(() => {
    if (editingSummary && summaryRef.current) {
      summaryRef.current.focus()
      summaryRef.current.selectionStart = summaryRef.current.value.length
    }
  }, [editingSummary])

  // ── Summary save ────────────────────────────────────────────────────────────

  const saveSummary = async () => {
    setSavingSummary(true)
    try {
      const updated = await areasApi.update(areaId, { summary: summaryDraft })
      setArea(updated)
      setEditingSummary(false)
      toast('Summary saved')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSavingSummary(false)
    }
  }

  const cancelSummary = () => {
    setSummaryDraft(area?.summary || '')
    setEditingSummary(false)
  }

  const suggestSummary = async () => {
    setSuggestingSummary(true)
    if (!editingSummary) setEditingSummary(true)
    try {
      const result = await areasApi.suggestSummary(areaId)
      setSummaryDraft(result.summary)
      toast('Suggestion ready - review and save')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSuggestingSummary(false)
    }
  }

  // ── Auto-update summaries ─────────────────────────────────────────────────────

  const toggleAutoUpdate = () => {
    if (area.summary_auto_update) {
      // Currently on → turn it off for this area, no prompt needed.
      setAutoForThisArea(false)
    } else {
      // Turning on → ask whether to apply to all areas.
      setAutoPrompt(true)
    }
  }

  const setAutoForThisArea = async (enabled) => {
    setTogglingAuto(true)
    setAutoPrompt(false)
    try {
      const updated = await areasApi.update(areaId, { auto_update: enabled })
      setArea(updated)
      toast(enabled ? 'Auto-update on for this area' : 'Auto-update off')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTogglingAuto(false)
    }
  }

  const setAutoForAllAreas = async () => {
    setTogglingAuto(true)
    setAutoPrompt(false)
    try {
      await areasApi.setAutoUpdateAll(true)
      const fresh = await areasApi.get(areaId)
      setArea(fresh)
      toast('Auto-update on for all areas')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTogglingAuto(false)
    }
  }

  // ── Status change ───────────────────────────────────────────────────────────

  const changeStatus = async (newStatus) => {
    setEditingStatus(false)
    if (newStatus === area.status) return
    try {
      const updated = await areasApi.update(areaId, { status: newStatus })
      setArea(updated)
      toast(`Status updated to ${newStatus}`)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  // ── Create thread ───────────────────────────────────────────────────────────

  const createThread = async () => {
    if (!threadForm.title.trim()) return
    setCreatingThread(true)
    try {
      const thread = await areasApi.createThread(areaId, threadForm)
      setThreads((t) => [thread, ...t])
      setNewThreadOpen(false)
      setThreadForm({ title: '', description: '', status: 'open' })
      toast('Thread created')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setCreatingThread(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <AreaSkeleton />
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-terracotta mb-3">{error}</p>
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 rounded-md bg-paper-200 dark:bg-pitch-700 text-sm mx-auto hover:bg-paper-300 dark:hover:bg-pitch-500 transition-colors">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </div>
    )
  }
  if (!area) return null

  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      {/* Area header */}
      <header className="
        sticky top-0 z-10 px-8 py-5
        bg-paper-100/90 dark:bg-pitch-800/90 backdrop-blur-md
        border-b border-paper-200 dark:border-pitch-700
      ">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 pr-14">
          <div className="flex items-center gap-3 min-w-0">
            <IconPicker
              value={area.icon}
              onChange={async (nextIcon) => {
                try {
                  const updated = await areasApi.update(areaId, { icon: nextIcon })
                  setArea(updated)
                } catch (e) {
                  toast(e.message, 'error')
                }
              }}
            >
              {({ open: openPicker, value }) => (
                <button
                  onClick={openPicker}
                  title={value ? `Icon: ${value}` : 'Set icon'}
                  className="
                    flex items-center justify-center w-10 h-10 rounded-md flex-shrink-0
                    bg-paper-200/60 dark:bg-pitch-700
                    border border-paper-300 dark:border-pitch-500
                    text-pitch-800 dark:text-white
                    hover:border-paper-400 dark:hover:border-pitch-400
                    transition-colors
                  "
                >
                  {value
                    ? <AreaIcon name={value} size={22} />
                    : <Plus size={16} className="text-paper-500 dark:text-paper-600" />}
                </button>
              )}
            </IconPicker>
            <div className="min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <h1 className="font-display font-semibold text-xl tracking-[-0.01em] text-paper-900 dark:text-pitch-50 truncate">
                  {area.name}
                </h1>

                {/* Status badge - click to change */}
                <div className="relative">
                  <button onClick={() => setEditingStatus((v) => !v)}>
                <StatusBadge status={area.status} type="area" />
              </button>

              {editingStatus && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-lg shadow-xl overflow-hidden">
                  {Object.entries(AREA_STATUSES).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => changeStatus(key)}
                      className={`
                        flex items-center gap-2 w-full px-4 py-2.5 text-left text-xs font-display uppercase tracking-wide hover:bg-paper-100 dark:hover:bg-pitch-700 transition-colors
                        ${key === area.status ? 'bg-paper-100 dark:bg-pitch-700' : ''}
                        ${cfg.textClass}
                      `}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Backdrop to close status dropdown */}
              {editingStatus && (
                <div className="fixed inset-0 z-10" onClick={() => setEditingStatus(false)} />
              )}
                </div>
              </div>
              {/* Subtle description under the title — the same text the
                  dashboard area card shows, for quick orientation. */}
              {area.summary && (
                <p className="font-lexend text-[13px] leading-snug text-paper-500 dark:text-pitch-100 normal-case tracking-normal mt-1 max-w-2xl line-clamp-2">
                  {area.summary.split('\n')[0]}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setNewThreadOpen(true)}
            className="
              flex-shrink-0 self-start whitespace-nowrap
              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display font-medium uppercase tracking-wide
              bg-mint-700 hover:bg-mint-800 text-white
              shadow-sm hover:shadow-mint-500/25
              transition-all duration-150
            "
          >
            <Plus size={13} />
            New Thread
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-8 py-6">
        {/* Overview - shared OverviewCard (identical for areas and threads) */}
        <OverviewCard
          data={area}
          aiConfigured={aiConfigured}
          onSuggest={() => areasApi.suggestSummary(areaId)}
          onSave={(text) => areasApi.update(areaId, { summary: text })}
          onToggleAuto={(enabled) => areasApi.update(areaId, { auto_update: enabled })}
          onSetAutoAll={async () => { await areasApi.setAutoUpdateAll(true); return areasApi.get(areaId) }}
          onChange={(updated) => setArea(updated)}
          onError={(e) => toast(e.message, 'error')}
          scopeNoun="area"
          emptyHint="No overview yet. Click Update to generate one, or write your own."
          placeholder="Describe what's happening in this area..."
        />


        {/* Threads section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600">
              Threads{' '}
              <span className="font-mono text-paper-400 dark:text-paper-700">
                ({threads.length})
              </span>
            </h2>
          </div>

          {threads.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-paper-300 dark:border-pitch-500 rounded-xl">
              <p className="text-sm text-paper-500 dark:text-paper-700 mb-4">No threads yet for this area.</p>
              <button
                onClick={() => setNewThreadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-mint-700 hover:bg-mint-800 text-white text-sm mx-auto transition-colors"
              >
                <Plus size={14} />
                Create first thread
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {threads.map((thread, index) => (
                <div
                  key={thread.id}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`group/row flex items-stretch gap-1 rounded-lg transition-all ${
                    dragIndex === index ? 'opacity-40' : ''
                  } ${
                    overIndex === index && dragIndex !== null && dragIndex !== index
                      ? 'ring-2 ring-mint/50'
                      : ''
                  }`}
                >
                  {/* Reorder handle - invisible until the row is hovered */}
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    title="Drag to reorder"
                    className="
                      flex-shrink-0 flex items-center justify-center w-5
                      cursor-grab active:cursor-grabbing
                      text-paper-400 dark:text-paper-600
                      opacity-0 group-hover/row:opacity-100 transition-opacity
                    "
                  >
                    <GripVertical size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <ThreadCard thread={thread} areaId={areaId} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audit panel */}
      <AreaAuditPanel areaId={areaId} />

      {/* New Thread Modal */}
      <Modal
        isOpen={newThreadOpen}
        onClose={() => { setNewThreadOpen(false); setThreadForm({ title: '', description: '', status: 'open' }) }}
        title="New Thread"
        isDirty={Boolean(threadForm.title.trim() || threadForm.description.trim())}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Title *
            </label>
            <input
              type="text"
              value={threadForm.title}
              onChange={(e) => setThreadForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Bootloader version mismatch investigation"
              autoFocus
              className="
                w-full px-3 py-2.5 text-sm rounded-lg
                bg-paper-100 dark:bg-pitch-700
                border border-paper-300 dark:border-paper-700
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) createThread() }}
            />
          </div>

          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Description
            </label>
            <textarea
              value={threadForm.description}
              onChange={(e) => setThreadForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of what this thread covers…"
              rows={3}
              className="
                w-full px-3 py-2.5 text-sm rounded-lg resize-none
                bg-paper-100 dark:bg-pitch-700
                border border-paper-300 dark:border-paper-700
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />
          </div>

          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(THREAD_STATUSES).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setThreadForm((f) => ({ ...f, status: key }))}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display uppercase tracking-wide border transition-colors
                    ${threadForm.status === key
                      ? `${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`
                      : 'text-paper-600 dark:text-paper-500 border-paper-300 dark:border-pitch-500 hover:border-paper-400 dark:hover:border-paper-700'
                    }
                  `}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setNewThreadOpen(false)}
              className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={createThread}
              disabled={!threadForm.title.trim() || creatingThread}
              className="px-4 py-2 text-sm rounded-md font-medium bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
            >
              {creatingThread ? 'Creating…' : 'Create Thread'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Area audit panel ─────────────────────────────────────────────────────────

const ACTION_BADGE = {
  created:     'bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200',
  updated:     'bg-mustard/10 text-mustard',
  deleted:     'bg-terracotta/10 text-terracotta',
  completed:   'bg-mint/10 text-mint-600 dark:text-mint-300',
  uncompleted: 'bg-paper-300/50 text-paper-600 dark:bg-pitch-500/50 dark:text-paper-500',
}

function formatAuditDescription({ action, entity_type, field, old_value, new_value }) {
  if (action === 'completed') return 'Task marked complete'
  if (action === 'uncompleted') return 'Task reopened'
  if (action === 'deleted') return `${field} removed: ${old_value}`
  if (action === 'created' && entity_type === 'thread') return `Thread created: ${new_value || field || ''}`
  if (action === 'created' && entity_type === 'entry') return `Entry added (${field})`
  if (action === 'created' && entity_type === 'attachment') return `${field} attached: ${new_value}`
  if (action === 'updated') {
    const base = `${field} changed`
    if (old_value != null && new_value != null) {
      if (old_value.length < 40 && new_value.length < 40) {
        return `${base} from "${old_value}" → "${new_value}"`
      }
      return `${base} from [previous] → [updated]`
    }
    return base
  }
  return `${action} ${entity_type}`
}

function AreaAuditRow({ record }) {
  return (
    <Link
      to={`/thread/${record.thread_id}`}
      className="
        px-4 py-2.5 flex items-center gap-3 text-xs
        border-b border-paper-100 dark:border-pitch-700 last:border-0
        hover:bg-paper-100/60 dark:hover:bg-pitch-700/40
        transition-colors
      "
    >
      <span className="font-mono text-paper-400 dark:text-paper-700 flex-shrink-0 w-28">
        {format(new Date(record.occurred_at), 'dd MMM HH:mm')}
      </span>
      <span className="text-paper-600 dark:text-paper-500 truncate w-36 flex-shrink-0">
        {record.thread_title || <span className="italic text-paper-400 dark:text-paper-700">area</span>}
      </span>
      <span className={`font-display uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${ACTION_BADGE[record.action] ?? ACTION_BADGE.updated}`}>
        {record.action}
      </span>
      <span className="text-paper-600 dark:text-paper-500 flex-1 truncate">
        {formatAuditDescription(record)}
      </span>
    </Link>
  )
}

function AreaAuditSkeleton() {
  return (
    <div className="divide-y divide-paper-100 dark:divide-pitch-700">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-4 py-2.5 flex items-center gap-3">
          <div className="w-28 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="w-36 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="w-16 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="flex-1 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function AreaAuditPanel({ areaId }) {
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState([])
  const [fetching, setFetching] = useState(false)
  const [fetched, setFetched] = useState(false)

  const expand = async () => {
    setOpen(true)
    if (fetched) return
    setFetching(true)
    try {
      const data = await areasApi.getAudit(areaId)
      setRecords(data)
      setFetched(true)
    } catch {
      // silent fail
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-8 pb-10">
      <button
        onClick={open ? () => setOpen(false) : expand}
        className="
          w-full flex items-center gap-2 py-3
          font-display uppercase tracking-widest text-xs
          text-paper-400 dark:text-pitch-500
          hover:text-paper-600 dark:hover:text-paper-600
          cursor-pointer transition-colors
        "
      >
        <History size={13} />
        <span className="flex-1 text-left">Audit Log</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl overflow-hidden">
          {fetching ? (
            <AreaAuditSkeleton />
          ) : records.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs italic text-paper-400 dark:text-paper-700">No audit history yet</p>
            </div>
          ) : (
            <div>
              {records.map((record) => (
                <AreaAuditRow key={record.id} record={record} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AreaSkeleton() {
  return (
    <div className="flex-1 min-h-screen bg-white dark:bg-pitch-800 p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="h-8 w-48 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        <div className="h-24 rounded-xl bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-lg bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Loading visuals for the Overview Update flow ─────────────────────────────

function EffroMarkSpinner() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="text-paper-700 dark:text-paper-200"
    >
      <path
        d="M 22 50 L 50 50"
        stroke="currentColor"
        strokeWidth="11"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 30,
          animation: 'drawStem 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        }}
      />
      <path
        d="M 50 50 L 78 26"
        stroke="currentColor"
        strokeWidth="11"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 38,
          animation: 'drawTop 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        }}
      />
      <path
        d="M 50 50 L 78 74"
        stroke="currentColor"
        strokeWidth="11"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 38,
          animation: 'drawBot 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        }}
      />
    </svg>
  )
}

function ProgressIndeterminate() {
  return (
    <div className="w-40 h-1 rounded-full overflow-hidden bg-paper-200 dark:bg-pitch-700 relative">
      <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-mint animate-[slideIn_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite]" />
    </div>
  )
}
