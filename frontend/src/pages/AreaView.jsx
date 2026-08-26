import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Plus, Check, X, Edit3, RefreshCw, History, ChevronDown, ChevronUp, Sparkles, Clock, Wand2, GripVertical, Gauge, AlignLeft, FolderPlus, Folder, Pencil, Trash2 } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { areasApi } from '../api/client'
import { parseUTC } from '../utils/time.js'
import StatusBadge from '../components/StatusBadge'
import ThreadCard from '../components/ThreadCard'
import AreaFolios from '../components/AreaFolios'
import Modal from '../components/Modal'
import PageShell from '../components/PageShell'
import PageHeader from '../components/PageHeader'
import IconPicker, { AreaIcon } from '../components/IconPicker'
import OverviewCard from '../components/OverviewCard'
import { useToast } from '../components/Toast'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { AREA_STATUSES, THREAD_STATUSES } from '../utils/status'
import { SECTION_ICONS } from '../utils/entityIcons'
import Markdown from '../components/Markdown'
import MarkdownArea from '../components/MarkdownArea'
import { stripMarkdown } from '../utils/markdownEditing'

export default function AreaView() {
  const { areaId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { configured: aiConfigured } = useAIConfigured()

  const [area, setArea] = useState(null)
  const [threads, setThreads] = useState([])
  const [groups, setGroups] = useState([])
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
  // groupId: existing group to file into (null = none). newGroupName: null when
  // not creating a group; a string (incl. '') means the "new group" input is open.
  const [threadForm, setThreadForm] = useState({ title: '', description: '', status: 'open', groupId: null, newGroupName: null })
  const [creatingThread, setCreatingThread] = useState(false)

  const summaryRef = useRef(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [areaData, threadsData, groupsData] = await Promise.all([
        areasApi.get(areaId),
        areasApi.listThreads(areaId),
        areasApi.listThreadGroups(areaId),
      ])
      setArea(areaData)
      setSummaryDraft(areaData.summary || '')
      setThreads(threadsData)
      setGroups(groupsData)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [areaId])

  // ── Drag-to-reorder + group threads ──────────────────────────────────────────
  // `threads` is the ordered source of truth. Buckets (each custom group + the
  // ungrouped pile) are derived by filtering, which preserves this order, so a
  // single flat reorder call keeps every bucket's order consistent.
  const [dragId, setDragId] = useState(null)
  // What the pointer is currently over: {type:'thread'|'group'|'newgroup'|'ungrouped', id?}
  const [dropTarget, setDropTarget] = useState(null)
  const [renamingGroupId, setRenamingGroupId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  // Collapsed custom groups, keyed by `grp-<id>`.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const toggleGroup = (s) => setCollapsedGroups((prev) => {
    const n = new Set(prev)
    if (n.has(s)) n.delete(s); else n.add(s)
    return n
  })

  // Rail "at a glance" facts (safe before area/threads load).
  const activeThreadCount = threads.filter((t) => t.status === 'in-progress').length
  const lastActivity = threads.length
    ? threads.map((t) => parseUTC(t.updated_at)).filter(Boolean).sort((a, b) => b - a)[0]
    : (area ? parseUTC(area.updated_at) : null)

  // Persist the flat thread order; revert to server truth on failure.
  const persistOrder = (next, extraCall = null) => {
    setThreads(next)
    const calls = [areasApi.reorderThreads(areaId, next.map((t) => t.id))]
    if (extraCall) calls.push(extraCall)
    Promise.all(calls).catch((err) => {
      toast(err.message || 'Could not save the change', 'error')
      load()
    })
  }

  const handleDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))  // Firefox needs a payload
  }
  const handleDragEnd = () => { setDragId(null); setDropTarget(null) }

  // Drop one thread just before another; the dragged thread inherits the
  // target's group (so dropping onto a card in a group files it there too).
  const dropOnThread = (e, targetId) => {
    e.preventDefault(); e.stopPropagation()
    const from = dragId
    setDragId(null); setDropTarget(null)
    if (from == null || from === targetId) return
    const dragged = threads.find((t) => t.id === from)
    const target = threads.find((t) => t.id === targetId)
    if (!dragged || !target) return
    const groupChanged = dragged.group_id !== target.group_id
    const rest = threads.filter((t) => t.id !== from)
    const ti = rest.findIndex((t) => t.id === targetId)
    const updated = { ...dragged, group_id: target.group_id }
    const next = [...rest.slice(0, ti), updated, ...rest.slice(ti)]
    persistOrder(next, groupChanged ? areasApi.setThreadGroup(from, target.group_id) : null)
  }

  // File a thread into a group (or null to ungroup), appended after that
  // bucket's current members. Used by drops onto a group and the row menu.
  const assignToGroup = (threadId, groupId) => {
    const dragged = threads.find((t) => t.id === threadId)
    if (!dragged) return
    const groupChanged = dragged.group_id !== groupId
    const rest = threads.filter((t) => t.id !== threadId)
    let insertAt = rest.length
    if (groupId != null) {
      const lastIdx = rest.map((t) => t.group_id).lastIndexOf(groupId)
      insertAt = lastIdx === -1 ? rest.length : lastIdx + 1
    }
    const updated = { ...dragged, group_id: groupId }
    const next = [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)]
    persistOrder(next, groupChanged ? areasApi.setThreadGroup(threadId, groupId) : null)
  }

  const dropOnGroup = (e, groupId) => {
    e.preventDefault()
    const id = dragId
    setDragId(null); setDropTarget(null)
    if (id != null) assignToGroup(id, groupId)
  }

  const dropOnNewGroup = async (e) => {
    e.preventDefault()
    const id = dragId
    setDragId(null); setDropTarget(null)
    if (id == null) return
    try {
      const g = await areasApi.createThreadGroup(areaId, 'New group')
      setGroups((prev) => [...prev, g])
      assignToGroup(id, g.id)
      setRenamingGroupId(g.id)  // let the user name it straight away
    } catch (err) {
      toast(err.message || 'Could not make the group', 'error')
    }
  }

  // ── Group management ──────────────────────────────────────────────────────────
  const addGroup = async () => {
    try {
      const g = await areasApi.createThreadGroup(areaId, 'New group')
      setGroups((prev) => [...prev, g])
      setRenamingGroupId(g.id)
    } catch (err) {
      toast(err.message || 'Could not make the group', 'error')
    }
  }

  const renameGroup = (groupId, name) => {
    setRenamingGroupId(null)
    const clean = (name || '').trim()
    const current = groups.find((g) => g.id === groupId)
    if (!clean || (current && current.name === clean)) return
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: clean } : g)))
    areasApi.renameThreadGroup(groupId, clean).catch((err) => {
      toast(err.message || 'Could not rename the group', 'error')
      load()
    })
  }

  const removeGroup = (groupId) => {
    setConfirmDeleteId(null)
    setGroups((prev) => prev.filter((g) => g.id !== groupId))
    setThreads((prev) => prev.map((t) => (t.group_id === groupId ? { ...t, group_id: null } : t)))
    areasApi.deleteThreadGroup(groupId).catch((err) => {
      toast(err.message || 'Could not remove the group', 'error')
      load()
    })
  }

  const createGroupAndAssign = async (threadId) => {
    try {
      const g = await areasApi.createThreadGroup(areaId, 'New group')
      setGroups((prev) => [...prev, g])
      assignToGroup(threadId, g.id)
      setRenamingGroupId(g.id)
    } catch (err) {
      toast(err.message || 'Could not make the group', 'error')
    }
  }

  // Open the New Thread modal, optionally pre-filed into a group.
  const openNewThread = (groupId = null) => {
    setThreadForm({ title: '', description: '', status: 'open', groupId, newGroupName: null })
    setNewThreadOpen(true)
  }

  const ungrouped = threads.filter((t) => t.group_id == null)

  // One thread row: drag handle + card + "move to group" menu. Shared by the
  // custom groups and the ungrouped status groups so behaviour stays identical.
  const renderRow = (thread) => (
    <div
      key={thread.id}
      onDragOver={(e) => {
        if (dragId != null && dragId !== thread.id) {
          e.preventDefault(); e.stopPropagation()
          setDropTarget({ type: 'thread', id: thread.id })
        }
      }}
      onDrop={(e) => dropOnThread(e, thread.id)}
      className={`group/row flex items-stretch gap-1 rounded-lg transition ${
        dragId === thread.id ? 'opacity-40' : ''
      } ${
        dropTarget?.type === 'thread' && dropTarget.id === thread.id && dragId !== thread.id ? 'ring-2 ring-mint/50' : ''
      }`}
    >
      {/* Reorder handle - drag to reorder, or onto a group to file it */}
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, thread.id)}
        onDragEnd={handleDragEnd}
        title="Drag to reorder, or onto a group to file it"
        className="flex-shrink-0 flex items-center justify-center w-5 cursor-grab active:cursor-grabbing
                   text-paper-400 dark:text-paper-600 opacity-0 group-hover/row:opacity-100 transition-opacity focus-visible:opacity-100"
      >
        <GripVertical size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <ThreadCard thread={thread} areaId={areaId} />
      </div>
      <MoveToGroupMenu
        groups={groups}
        currentGroupId={thread.group_id}
        onAssign={(gid) => assignToGroup(thread.id, gid)}
        onCreateAndAssign={() => createGroupAndAssign(thread.id)}
      />
    </div>
  )

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
    const wantsGroup = (threadForm.newGroupName != null && threadForm.newGroupName.trim()) || threadForm.groupId != null
    try {
      const payload = {
        title: threadForm.title,
        description: threadForm.description,
        status: threadForm.status,
      }
      if (threadForm.newGroupName != null && threadForm.newGroupName.trim()) {
        payload.new_group_name = threadForm.newGroupName.trim()
      } else if (threadForm.groupId != null) {
        payload.group_id = threadForm.groupId
      }
      const thread = await areasApi.createThread(areaId, payload)
      setThreads((t) => [thread, ...t])
      // A thread can mint a new group server-side; refresh the group list so it shows.
      if (wantsGroup) {
        areasApi.listThreadGroups(areaId).then(setGroups).catch(() => {})
      }
      setNewThreadOpen(false)
      setThreadForm({ title: '', description: '', status: 'open', groupId: null, newGroupName: null })
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
    <PageShell
      header={
        <PageHeader
          icon={
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
          }
          title={area.name}
          titleAdornment={
            /* Status badge, click to change. */
            <div className="relative flex-shrink-0">
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
                        flex items-center gap-2 w-full px-4 py-2.5 text-left text-xs font-sans font-medium uppercase tracking-wide hover:bg-paper-100 dark:hover:bg-pitch-700 transition-colors
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

              {/* Backdrop to close the status dropdown */}
              {editingStatus && (
                <div className="fixed inset-0 z-10" onClick={() => setEditingStatus(false)} />
              )}
            </div>
          }
          subtitle={
            /* The stable description, one line, for orientation while the
               header is stuck mid-scroll. The full text lives in the
               Description card. Clamped, because the header is sticky and a
               long description would otherwise eat the viewport. */
            area.description
              ? <span className="block max-w-2xl line-clamp-2">{stripMarkdown(area.description).split('\n')[0]}</span>
              : null
          }
          right={
            <button
              onClick={() => openNewThread()}
              className="btn btn-sm btn-primary whitespace-nowrap"
            >
              <Plus size={13} />
              New Thread
            </button>
          }
        />
      }
    >
      {/* Description - full width, above the Current Overview + rail grid,
          signifying its hierarchy: what the area IS comes before where it
          currently stands. Editable, but written to be set once and left. */}
      <AreaDescription
        area={area}
        onSave={async (text) => {
          const updated = await areasApi.update(areaId, { description: text })
          setArea(updated)
        }}
        onError={(e) => toast(e.message, 'error')}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_19rem] gap-6 items-start">
      {/* Main column: overview + threads grouped by status */}
      <div className="min-w-0 flex flex-col gap-6">
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
          <h2 className="eyebrow text-paper-500 dark:text-paper-600">
            Threads{' '}
            <span className="font-mono text-paper-400 dark:text-paper-700">
              ({threads.length})
            </span>
          </h2>
          {threads.length > 0 && (
            <button
              onClick={addGroup}
              title="Make a group to file threads under"
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-2xs font-sans font-medium uppercase tracking-wide
                         text-paper-500 dark:text-paper-500 hover:text-paper-700 dark:hover:text-paper-300
                         hover:bg-paper-200/60 dark:hover:bg-pitch-700 transition-colors"
            >
              <FolderPlus size={13} /> New group
            </button>
          )}
        </div>

        {threads.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-paper-300 dark:border-pitch-500 rounded-xl">
            <p className="text-sm text-paper-500 dark:text-paper-700 mb-4">No threads yet for this area.</p>
            <button
              onClick={() => openNewThread()}
              className="btn btn-md btn-primary mx-auto"
            >
              <Plus size={14} />
              Create first thread
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Custom groups - a calm editable heading + splitter per group */}
            {groups.map((group) => {
              const items = threads.filter((t) => t.group_id === group.id)
              const collapsed = collapsedGroups.has(`grp-${group.id}`)
              const isRenaming = renamingGroupId === group.id
              const isDropOver = dropTarget?.type === 'group' && dropTarget.id === group.id
              return (
                <div
                  key={group.id}
                  onDragOver={(e) => { if (dragId != null) { e.preventDefault(); setDropTarget({ type: 'group', id: group.id }) } }}
                  onDrop={(e) => dropOnGroup(e, group.id)}
                  className={`rounded-xl transition ${isDropOver ? 'ring-2 ring-mint/50 bg-mint/5' : ''}`}
                >
                  {/* Group header: chevron, name (editable), count, splitter, remove */}
                  <div className="flex items-center gap-2 mb-2.5">
                    <button onClick={() => toggleGroup(`grp-${group.id}`)} title={collapsed ? 'Expand' : 'Collapse'} className="flex-shrink-0 text-paper-400 dark:text-paper-700">
                      <ChevronDown size={14} className={`transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} />
                    </button>
                    <Folder size={13} className="flex-shrink-0 text-paper-400 dark:text-paper-600" />
                    {isRenaming ? (
                      <input
                        autoFocus
                        defaultValue={group.name}
                        onBlur={(e) => renameGroup(group.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur()
                          if (e.key === 'Escape') setRenamingGroupId(null)
                        }}
                        className="min-w-0 flex-shrink px-1.5 py-0.5 text-sm font-sans font-semibold rounded
                                   bg-paper-100 dark:bg-pitch-700 text-pitch-800 dark:text-white
                                   border border-mint-500 focus:outline-none focus:ring-1 focus:ring-mint-500"
                      />
                    ) : (
                      <button onClick={() => setRenamingGroupId(group.id)} title="Rename group" className="group/name flex items-center gap-1.5 min-w-0">
                        <span className="font-sans font-semibold text-sm text-paper-700 dark:text-paper-200 truncate">{group.name}</span>
                        <Pencil size={11} className="flex-shrink-0 opacity-0 group-hover/name:opacity-100 text-paper-400 dark:text-paper-600 transition-opacity" />
                      </button>
                    )}
                    <span className="font-mono text-2xs text-paper-400 dark:text-paper-700 flex-shrink-0">{items.length}</span>
                    <div className="flex-1 h-px bg-paper-200 dark:bg-pitch-600" />
                    <button
                      onClick={() => openNewThread(group.id)}
                      title="New thread in this group"
                      className="flex-shrink-0 text-paper-400 dark:text-paper-700 hover:text-mint-600 dark:hover:text-mint-300 transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                    {confirmDeleteId === group.id ? (
                      <span className="flex items-center gap-1.5 text-2xs flex-shrink-0">
                        <span className="text-paper-500 dark:text-paper-500">Remove group?</span>
                        <button onClick={() => removeGroup(group.id)} className="font-medium text-terracotta">Yes</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-paper-400 dark:text-paper-600">No</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(group.id)}
                        title="Remove group (threads are kept)"
                        className="flex-shrink-0 text-paper-400 dark:text-paper-700 hover:text-terracotta transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  {!collapsed && (
                    items.length === 0 ? (
                      <div className="flex flex-col items-center gap-2.5 py-5 border border-dashed border-paper-300 dark:border-pitch-500 rounded-lg">
                        <p className="text-2xs text-paper-400 dark:text-paper-700">Empty. Drag a thread here, or use the folder menu on any thread.</p>
                        <button
                          onClick={() => openNewThread(group.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-sans font-medium uppercase tracking-wide
                                     text-mint-700 dark:text-mint-300 bg-mint/10 hover:bg-mint/20 transition-colors"
                        >
                          <Plus size={12} /> New thread
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {items.map((thread) => renderRow(thread))}
                      </div>
                    )
                  )}
                </div>
              )
            })}

            {/* Make-a-new-group drop zone, shown only while dragging a thread */}
            {dragId != null && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDropTarget({ type: 'newgroup' }) }}
                onDrop={dropOnNewGroup}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed text-xs transition-colors ${
                  dropTarget?.type === 'newgroup'
                    ? 'border-mint bg-mint/5 text-mint-600 dark:text-mint-300'
                    : 'border-paper-300 dark:border-pitch-500 text-paper-400 dark:text-paper-700'
                }`}
              >
                <FolderPlus size={14} /> Drop here to make a new group
              </div>
            )}

            {/* Ungrouped pile - grouped by status, exactly as before when no
                custom groups exist. Droppable to lift a thread out of a group. */}
            <div
              onDragOver={(e) => { if (dragId != null && groups.length > 0) { e.preventDefault(); setDropTarget({ type: 'ungrouped' }) } }}
              onDrop={(e) => {
                if (groups.length === 0) return
                e.preventDefault()
                const id = dragId
                setDragId(null); setDropTarget(null)
                if (id != null) assignToGroup(id, null)
              }}
              className={`flex flex-col gap-5 rounded-xl transition ${dropTarget?.type === 'ungrouped' ? 'ring-2 ring-mint/40' : ''}`}
            >
              {groups.length > 0 && ungrouped.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="eyebrow text-paper-400 dark:text-paper-700">Ungrouped</span>
                  <div className="flex-1 h-px bg-paper-200 dark:bg-pitch-600" />
                </div>
              )}
              {/* One flat, freely-reorderable list - drag any thread above or
                  below any other, the same as inside a group. Status shows on
                  each card, so no status splitting to get in the way. */}
              <div className="flex flex-col gap-2">
                {ungrouped.map((thread) => renderRow(thread))}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Right rail: area facts + the dives filed here */}
      <aside className="xl:sticky xl:top-6 flex flex-col gap-3">
        <div className="rounded-xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400 p-3.5">
          <div className="eyebrow flex items-center gap-2 text-paper-500 dark:text-pitch-200">
            <Gauge size={14} className="text-mint" /> At a glance
          </div>
          <div className="mt-3 flex flex-col gap-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-paper-500 dark:text-pitch-200">Status</span>
              <StatusBadge status={area.status} type="area" size="xs" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-paper-500 dark:text-pitch-200">Threads</span>
              <span className="text-pitch-800 dark:text-pitch-50">
                {threads.length}
                {activeThreadCount > 0 && <span className="font-mono text-2xs text-paper-400 dark:text-pitch-300"> · {activeThreadCount} active</span>}
              </span>
            </div>
            {lastActivity && (
              <div className="flex items-center justify-between gap-2 border-t border-paper-200 dark:border-pitch-600 pt-2.5">
                <span className="text-paper-500 dark:text-pitch-200">Last activity</span>
                <span className="font-mono text-2xs text-paper-600 dark:text-pitch-100">{formatDistanceToNow(lastActivity, { addSuffix: true })}</span>
              </div>
            )}
          </div>
        </div>
        <AreaFolios areaId={areaId} />
      </aside>
      </div>

      {/* Audit panel */}
      <AreaAuditPanel areaId={areaId} />

      {/* New Thread Modal */}
      <Modal
        isOpen={newThreadOpen}
        onClose={() => { setNewThreadOpen(false); setThreadForm({ title: '', description: '', status: 'open', groupId: null, newGroupName: null }) }}
        title="New Thread"
        isDirty={Boolean(threadForm.title.trim() || threadForm.description.trim())}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
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
            <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Description
            </label>
            <MarkdownArea
              value={threadForm.description}
              onChange={(text) => setThreadForm((f) => ({ ...f, description: text }))}
              placeholder="Brief description of what this thread covers…"
              rows={3}
              className="bg-paper-100 dark:bg-pitch-700 border-paper-300 dark:border-paper-700"
            />
          </div>

          <div>
            <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(THREAD_STATUSES).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setThreadForm((f) => ({ ...f, status: key }))}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-sans font-medium uppercase tracking-wide border transition-colors
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

          <div>
            <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Group
            </label>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const pill = (active) => `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-sans font-medium uppercase tracking-wide border transition-colors ${
                  active
                    ? 'text-mint-700 dark:text-mint-300 bg-mint/10 border-mint-500'
                    : 'text-paper-600 dark:text-paper-500 border-paper-300 dark:border-pitch-500 hover:border-paper-400 dark:hover:border-paper-700'
                }`
                return (
                  <>
                    <button
                      onClick={() => setThreadForm((f) => ({ ...f, groupId: null, newGroupName: null }))}
                      className={pill(threadForm.groupId == null && threadForm.newGroupName == null)}
                    >
                      No group
                    </button>
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setThreadForm((f) => ({ ...f, groupId: g.id, newGroupName: null }))}
                        className={pill(threadForm.groupId === g.id && threadForm.newGroupName == null)}
                      >
                        <Folder size={12} /> {g.name}
                      </button>
                    ))}
                    <button
                      onClick={() => setThreadForm((f) => ({ ...f, groupId: null, newGroupName: f.newGroupName == null ? '' : f.newGroupName }))}
                      className={pill(threadForm.newGroupName != null)}
                    >
                      <FolderPlus size={12} /> New group
                    </button>
                  </>
                )
              })()}
            </div>
            {threadForm.newGroupName != null && (
              <input
                type="text"
                value={threadForm.newGroupName}
                autoFocus
                onChange={(e) => setThreadForm((f) => ({ ...f, newGroupName: e.target.value }))}
                placeholder="Name the new group..."
                className="
                  mt-2 w-full px-3 py-2 text-sm rounded-lg
                  bg-paper-100 dark:bg-pitch-700
                  border border-paper-300 dark:border-paper-700
                  text-pitch-800 dark:text-white
                  placeholder:text-paper-400 dark:placeholder:text-paper-700
                  focus:outline-none focus:ring-2 focus:ring-mint-500
                "
              />
            )}
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
              className="btn btn-md btn-primary"
            >
              {creatingThread ? 'Creating…' : 'Create Thread'}
            </button>
          </div>
        </div>
      </Modal>
    </PageShell>
  )
}

// ─── Area description ─────────────────────────────────────────────────────────

// The stable "what this area is" card. Deliberately quiet: no AI, no auto
// refresh, just the text and a small Edit affordance - it should rarely change
// after it is first written (not enforced, the user stays in control).
function AreaDescription({ area, onSave, onError }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(area.description || '')
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      ref.current.selectionStart = ref.current.value.length
    }
  }, [editing])

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setDraft(area.description || '')
    setEditing(false)
  }

  return (
    <section className="mb-6 rounded-xl border border-paper-300 dark:border-pitch-600 bg-white dark:bg-pitch-700 overflow-hidden">
      {/* Header - mirrors the Current Overview card so the two read as siblings */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-paper-300/70 dark:border-pitch-600/70">
        <div className="flex items-center gap-2 min-w-0">
          <AlignLeft size={13} className="text-paper-500 dark:text-pitch-100 flex-shrink-0" />
          <span className="eyebrow text-paper-500 dark:text-pitch-100">
            Description
          </span>
        </div>
        {!editing && (
          <button
            onClick={() => { setDraft(area.description || ''); setEditing(true) }}
            className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-pitch-100 hover:text-paper-700 dark:hover:text-paper-200 transition-colors flex-shrink-0"
          >
            <Edit3 size={12} />
            Edit
          </button>
        )}
      </div>

      <div className="px-4 py-3">
        {editing ? (
          <div>
            <MarkdownArea
              textareaRef={ref}
              value={draft}
              onChange={setDraft}
              rows={3}
              placeholder="What is this area? Its scope, its purpose, what belongs in it."
              className="bg-paper-100 dark:bg-pitch-700 border-paper-300 dark:border-pitch-500"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={cancel} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-paper-600 dark:text-paper-500 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors">
                <X size={12} /> Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="btn btn-sm btn-primary"
              >
                <Check size={12} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="cursor-text"
            onClick={() => { setDraft(area.description || ''); setEditing(true) }}
          >
            {area.description ? (
              <Markdown className="prose-base text-pitch-700 dark:text-paper-200">
                {area.description}
              </Markdown>
            ) : (
              <p className="text-base leading-relaxed italic text-paper-400 dark:text-paper-700">
                No description yet. Write one line on what this area is - it rarely needs to change after that.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Move-to-group menu ───────────────────────────────────────────────────────
// The precision path for filing a thread (drag is the quick path). Revealed on
// row hover; lists the area's groups, remove-from-group, and make-a-new-group.

function MoveToGroupMenu({ groups, currentGroupId, onAssign, onCreateAndAssign }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex-shrink-0 flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Move to group"
        className={`flex items-center justify-center w-6 h-6 rounded-md transition
                    text-paper-400 dark:text-paper-600 hover:text-paper-600 dark:hover:text-paper-300
                    hover:bg-paper-100 dark:hover:bg-pitch-600
                    ${open ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'}`}
      >
        <Folder size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[11rem] py-1 bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-lg shadow-xl">
            <div className="eyebrow px-3 py-1.5 text-paper-400 dark:text-paper-600">
              Move to group
            </div>
            {groups.length === 0 && (
              <div className="px-3 py-1.5 text-xs italic text-paper-400 dark:text-paper-700">No groups yet</div>
            )}
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => { onAssign(g.id); setOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs text-paper-700 dark:text-paper-200 hover:bg-paper-100 dark:hover:bg-pitch-600 transition-colors"
              >
                <Check size={12} className={currentGroupId === g.id ? 'text-mint' : 'opacity-0'} />
                <span className="truncate">{g.name}</span>
              </button>
            ))}
            {currentGroupId != null && (
              <button
                onClick={() => { onAssign(null); setOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs text-paper-600 dark:text-paper-400 hover:bg-paper-100 dark:hover:bg-pitch-600 transition-colors"
              >
                <X size={12} /> Remove from group
              </button>
            )}
            <div className="my-1 h-px bg-paper-200 dark:bg-pitch-600" />
            <button
              onClick={() => { onCreateAndAssign(); setOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs text-mint-600 dark:text-mint-300 hover:bg-paper-100 dark:hover:bg-pitch-600 transition-colors"
            >
              <FolderPlus size={12} /> New group
            </button>
          </div>
        </>
      )}
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
      <span className={`font-sans font-medium uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${ACTION_BADGE[record.action] ?? ACTION_BADGE.updated}`}>
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
    <div className="pb-10">
      <button
        onClick={open ? () => setOpen(false) : expand}
        className="
          w-full flex items-center gap-2 py-3
          font-sans font-medium uppercase tracking-widest text-xs
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
    <PageShell grid={false} bodyClassName="py-8">
      <div className="space-y-4">
        <div className="h-8 w-48 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        <div className="h-24 rounded-xl bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-lg bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          ))}
        </div>
      </div>
    </PageShell>
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
