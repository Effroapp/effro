import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import {
  Plus, Edit3, Trash2, Check, X,
  Paperclip, Link2, Upload, ExternalLink, UploadCloud,
  RefreshCw, FileText, GitBranch, ArrowRight, ArrowLeft,
  ChevronDown, ChevronUp, Calendar, Ban,
  MessageSquare, ListTodo, Activity
} from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import { threadsApi, entriesApi, attachmentsApi, areasApi } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import AddMeetingModal from '../components/AddMeetingModal'
import StatusChangeModal from '../components/StatusChangeModal'
import OverviewCard from '../components/OverviewCard'
import { useToast } from '../components/Toast'
import { THREAD_STATUSES, formatBytes, DUE_DATE_OPTIONS } from '../utils/status'
import { useEntryAI } from '../hooks/useEntryAI'
import { useAIConfigured } from '../hooks/useAIConfigured'
import ActionSuggestionBanner from '../components/ActionSuggestionBanner'
import SubtaskList from '../components/SubtaskList'
import { useBionic } from '../hooks/useBionic'
import { bionicizeReact, rehypeBionic } from '../utils/bionic.jsx'
import TaskDecompositionDrawer from '../components/TaskDecompositionDrawer'

import { ENTITY, ENTITY_TYPES, entityFor, SECTION_ICONS } from '../utils/entityIcons'

const INACTIVITY_THRESHOLD_DAYS = 7

// Entry composer types - meetings are added through the dedicated Add Meeting
// button so they don't appear here.
const ENTRY_TYPES = ENTITY_TYPES.filter((t) => t.key !== 'meeting')

function getDueDateClass(dueDateStr) {
  const today = format(new Date(), 'yyyy-MM-dd')
  if (dueDateStr === today) return 'text-mustard font-semibold'
  if (dueDateStr < today)  return 'text-terracotta font-semibold'
  return 'text-paper-500 dark:text-paper-600'
}

export default function ThreadView() {
  const { threadId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { configured: aiConfigured } = useAIConfigured()

  const [thread, setThread] = useState(null)
  const [area, setArea] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastVisitedBanner, setLastVisitedBanner] = useState(null)

  // Deep-link: /thread/:id?entry=:entryId scrolls to and briefly highlights a
  // specific entry. Used by the Insights page (todo arrows, calendar/meeting
  // rows) so a click lands the user exactly on the item, not just the thread.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkEntryId = searchParams.get('entry')
  const [highlightedEntryId, setHighlightedEntryId] = useState(null)

  // Thread-level editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [editingStatus, setEditingStatus] = useState(false)

  // Entry composer state
  const [newEntryContent, setNewEntryContent] = useState('')
  const [entryType, setEntryType] = useState('entry')
  const [dueDateOption, setDueDateOption] = useState(null)
  const [dueDate, setDueDate] = useState(null)
  const [addingEntry, setAddingEntry] = useState(false)

  // AI hint flows - action detection on Updates, decomposition on to-dos
  const {
    actionSuggestions, drawerState,
    onEntrySaved, clearActions, openBreakdownDrawer, closeDrawer,
  } = useEntryAI()

  // Entry editing
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [entryDraft, setEntryDraft] = useState('')

  // Attachment modals
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkForm, setLinkForm] = useState({ name: '', url: '' })
  const [addingLink, setAddingLink] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef(null)

  // Files-card drop state
  const [filesDragActive, setFilesDragActive] = useState(false)
  const filesDragCounter = useRef(0)

  // Inline Link composer (paste URL → optional label → enter)
  const [inlineLinkUrl, setInlineLinkUrl] = useState('')
  const [inlineLinkName, setInlineLinkName] = useState('')
  const [addingInlineLink, setAddingInlineLink] = useState(false)

  // Delete dialogs
  const [deleteThreadOpen, setDeleteThreadOpen] = useState(false)
  const [deleteEntryId, setDeleteEntryId] = useState(null)
  const [deleteAttachmentId, setDeleteAttachmentId] = useState(null)

  // Thread-link modal
  const [linkThreadOpen, setLinkThreadOpen] = useState(false)
  const [linkThreadForm, setLinkThreadForm] = useState({ to_thread_id: '', kind: 'blocks' })
  const [allThreads, setAllThreads] = useState([])
  const [addingThreadLink, setAddingThreadLink] = useState(false)

  // Add-meeting modal
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [addingMeeting, setAddingMeeting] = useState(false)

  // Status-change modal - driven by the picker. Holds the target status
  // until the user confirms or cancels.
  const [statusTarget, setStatusTarget] = useState(null)
  const [changingStatus, setChangingStatus] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const t = await threadsApi.get(threadId)
      setThread(t)
      setTitleDraft(t.title)
      setDescDraft(t.description || '')
      const a = await areasApi.get(t.area_id)
      setArea(a)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [threadId])

  // Deep-link scroll + highlight. Once the thread (and its entries) are loaded,
  // if ?entry= points at an entry on this thread, scroll it into view and pulse
  // a brief mint highlight. We clear the param afterwards so a later manual
  // refresh doesn't re-trigger it. rAF + a short delay lets the timeline finish
  // its mount/fade-in before we measure scroll position.
  useEffect(() => {
    if (!deepLinkEntryId || !thread) return
    const id = `entry-${deepLinkEntryId}`
    const t = setTimeout(() => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedEntryId(Number(deepLinkEntryId))
        // Fade the highlight out after a beat, then strip the URL param.
        setTimeout(() => setHighlightedEntryId(null), 2200)
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('entry')
        return next
      }, { replace: true })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkEntryId, thread?.id])

  // Last-visited banner
  useEffect(() => {
    const key = `thread_last_visited_${threadId}`
    const stored = localStorage.getItem(key)
    if (stored) {
      const diff = Date.now() - new Date(stored).getTime()
      if (diff > 24 * 60 * 60 * 1000) {
        setLastVisitedBanner(formatDistanceToNow(new Date(stored), { addSuffix: true }))
      }
    }
    localStorage.setItem(key, new Date().toISOString())
  }, [threadId])

  // ── Thread-level edits ──────────────────────────────────────────────────────

  const saveTitle = async () => {
    if (!titleDraft.trim()) return
    try {
      const updated = await threadsApi.update(threadId, { title: titleDraft })
      setThread(updated)
      setEditingTitle(false)
      toast('Title updated')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveDescription = async () => {
    try {
      const updated = await threadsApi.update(threadId, { description: descDraft })
      setThread(updated)
      setEditingDescription(false)
      toast('Description updated')
    } catch (e) { toast(e.message, 'error') }
  }

  // The picker now just selects a target status; the modal handles confirm.
  const requestStatusChange = (newStatus) => {
    setEditingStatus(false)
    if (newStatus === thread.status) return
    setStatusTarget(newStatus)
  }

  const submitStatusChange = async ({ text }) => {
    if (!statusTarget) return
    const newStatus = statusTarget
    const isBlocking = newStatus === 'blocked'
    setChangingStatus(true)
    try {
      // 1. Flip the status on the thread
      const updated = await threadsApi.update(threadId, { status: newStatus })
      setThread((t) => ({ ...updated, entries: t.entries, attachments: t.attachments,
                          outgoing_links: t.outgoing_links, incoming_links: t.incoming_links }))

      // 2. Capture the reason / optional note as a timeline entry
      if (isBlocking) {
        // Required reason → mandatory blockage entry
        const entry = await entriesApi.create(threadId, {
          content: text,
          type: 'blockage',
        })
        setThread((t) => ({ ...t, entries: [...t.entries, entry] }))
      } else if (text) {
        // Optional note for non-blocking status changes
        const label = THREAD_STATUSES[newStatus]?.label || newStatus
        const entry = await entriesApi.create(threadId, {
          content: `Status changed to ${label}. ${text}`,
          type: 'entry',
        })
        setThread((t) => ({ ...t, entries: [...t.entries, entry] }))
      }

      toast(isBlocking ? 'Thread blocked' : `Status → ${THREAD_STATUSES[newStatus]?.label}`)
      setStatusTarget(null)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setChangingStatus(false)
    }
  }

  const deleteThread = async () => {
    try {
      await threadsApi.delete(threadId)
      toast('Thread deleted')
      navigate(`/area/${thread.area_id}`)
    } catch (e) { toast(e.message, 'error') }
  }

  // ── Entries ─────────────────────────────────────────────────────────────────

  const addEntry = async () => {
    if (!newEntryContent.trim()) return
    setAddingEntry(true)
    try {
      const entry = await entriesApi.create(threadId, {
        content: newEntryContent,
        type: entryType,
        due_date: entryType === 'todo' ? dueDate : undefined,
      })
      setThread((t) => ({ ...t, entries: [...t.entries, entry] }))
      setNewEntryContent('')
      setEntryType('entry')
      setDueDateOption(null)
      setDueDate(null)
      toast('Entry added')
      // Fire the AI hint flows in the background (action detection on
      // Updates, decomposition assessment on to-dos). No await - the entry
      // is already saved; suggestions surface a beat later if relevant.
      onEntrySaved(entry)
    } catch (e) { toast(e.message, 'error') }
    finally { setAddingEntry(false) }
  }

  // Create a to-do from an ActionSuggestionBanner suggestion.
  const createTodoFromAction = async (title, tid) => {
    try {
      const entry = await entriesApi.create(tid, { content: title, type: 'todo' })
      setThread((t) => ({ ...t, entries: [...t.entries, entry] }))
      toast('To-do added')
    } catch (e) { toast(e.message, 'error') }
  }

  // Replace a parent to-do's subtasks array in local state (after toggle/delete).
  const updateEntrySubtasks = (entryId, updated) => {
    setThread((t) => ({
      ...t,
      entries: t.entries.map((e) =>
        e.id === entryId ? { ...e, subtasks: updated } : e
      ),
    }))
  }

  // Merge freshly-created subtasks into the parent + mark it decomposed,
  // so SubtaskList renders them immediately without a refetch.
  const mergeSubtasksIntoEntry = (entryId, created) => {
    setThread((t) => ({
      ...t,
      entries: t.entries.map((e) =>
        e.id === entryId
          ? { ...e, subtasks: [...(e.subtasks || []), ...created], decomp_dismissed: true }
          : e
      ),
    }))
  }

  const addMeeting = async ({ title, meeting_at }) => {
    setAddingMeeting(true)
    try {
      const entry = await entriesApi.create(threadId, {
        content: title,
        type: 'meeting',
        meeting_at,
      })
      setThread((t) => ({ ...t, entries: [...t.entries, entry] }))
      setMeetingOpen(false)
      toast('Meeting added')
    } catch (e) { toast(e.message, 'error') }
    finally { setAddingMeeting(false) }
  }

  const saveEntry = async (entryId) => {
    try {
      const updated = await entriesApi.update(entryId, { content: entryDraft })
      setThread((t) => ({
        ...t,
        entries: t.entries.map((e) => (e.id === entryId ? updated : e)),
      }))
      setEditingEntryId(null)
      toast('Entry updated')
    } catch (e) { toast(e.message, 'error') }
  }

  const deleteEntry = async (entryId) => {
    try {
      await entriesApi.delete(entryId)
      setThread((t) => ({ ...t, entries: t.entries.filter((e) => e.id !== entryId) }))
      toast('Entry deleted')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveEntryNotes = async (entryId, notes) => {
    try {
      const updated = await entriesApi.update(entryId, { notes })
      setThread((t) => ({
        ...t,
        entries: t.entries.map((e) => (e.id === entryId ? updated : e)),
      }))
    } catch (e) { toast(e.message, 'error') }
  }

  const saveMeetingFields = async (entryId, { title, meeting_at }) => {
    try {
      const updated = await entriesApi.update(entryId, {
        content: title,
        meeting_at,
      })
      setThread((t) => ({
        ...t,
        entries: t.entries.map((e) => (e.id === entryId ? updated : e)),
      }))
      toast('Meeting updated')
    } catch (e) { toast(e.message, 'error') }
  }

  const toggleEntryComplete = async (entryId, completed) => {
    // Optimistic update
    setThread((t) => ({
      ...t,
      entries: t.entries.map((e) =>
        e.id === entryId
          ? { ...e, completed, completed_at: completed ? new Date().toISOString() : null }
          : e
      ),
    }))
    try {
      const updated = await entriesApi.update(entryId, { completed })
      setThread((t) => ({
        ...t,
        entries: t.entries.map((e) => (e.id === entryId ? updated : e)),
      }))
    } catch (err) {
      // Revert
      setThread((t) => ({
        ...t,
        entries: t.entries.map((e) =>
          e.id === entryId ? { ...e, completed: !completed } : e
        ),
      }))
      toast(err.message, 'error')
    }
  }

  // ── Attachments ─────────────────────────────────────────────────────────────

  // Modal-driven link add (Label + URL form). Kept as an optional fallback -
  // drag/paste straight onto the Links card is the primary path now.
  // Attaching a file/link or linking a thread now logs a timeline entry on the
  // backend. Pull just the entries back (no spinner) so that logged activity
  // shows up immediately without a full reload.
  const syncEntries = async () => {
    try {
      const t = await threadsApi.get(threadId)
      setThread((cur) => (cur ? { ...cur, entries: t.entries } : t))
    } catch { /* non-fatal: entry appears on next load */ }
  }

  const addLink = async (payload) => {
    const form = payload ?? linkForm
    if (!form.name?.trim() || !form.url?.trim()) return
    setAddingLink(true)
    try {
      const att = await attachmentsApi.addLink(threadId, form)
      setThread((t) => ({ ...t, attachments: [...t.attachments, att] }))
      setLinkModalOpen(false)
      setLinkForm({ name: '', url: '' })
      syncEntries()
      toast('Link added')
    } catch (e) { toast(e.message, 'error') }
    finally { setAddingLink(false) }
  }

  // Upload a single File object - used by both the file input and drag-drop.
  const uploadFileObject = async (file) => {
    if (!file) return
    setUploadingFile(true)
    try {
      const att = await attachmentsApi.uploadFile(threadId, file)
      setThread((t) => ({ ...t, attachments: [...t.attachments, att] }))
      syncEntries()
      toast(`File "${file.name}" uploaded`)
    } catch (e) { toast(e.message, 'error') }
    finally { setUploadingFile(false) }
  }

  const onFileInputChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await uploadFileObject(file)
  }

  // ── Files-card drag-and-drop ──────────────────────────────────────────────
  const onFilesDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    filesDragCounter.current++
    setFilesDragActive(true)
  }
  const onFilesDragLeave = (e) => {
    e.preventDefault()
    filesDragCounter.current--
    if (filesDragCounter.current <= 0) {
      filesDragCounter.current = 0
      setFilesDragActive(false)
    }
  }
  const onFilesDragOver = (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
  }
  const onFilesDrop = async (e) => {
    e.preventDefault()
    filesDragCounter.current = 0
    setFilesDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await uploadFileObject(file)
  }

  // ── Inline link composer ─────────────────────────────────────────────────
  const submitInlineLink = async () => {
    const url = inlineLinkUrl.trim()
    if (!url) return
    // Sensible fallback for the label if user didn't fill one in.
    let name = inlineLinkName.trim()
    if (!name) {
      try {
        name = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        name = url
      }
    }
    setAddingInlineLink(true)
    try {
      const att = await attachmentsApi.addLink(threadId, { name, url })
      setThread((t) => ({ ...t, attachments: [...t.attachments, att] }))
      setInlineLinkUrl('')
      setInlineLinkName('')
      syncEntries()
      toast('Link added')
    } catch (e) { toast(e.message, 'error') }
    finally { setAddingInlineLink(false) }
  }

  const deleteAttachment = async (attId) => {
    try {
      await attachmentsApi.delete(attId)
      setThread((t) => ({ ...t, attachments: t.attachments.filter((a) => a.id !== attId) }))
      toast('Attachment removed')
    } catch (e) { toast(e.message, 'error') }
  }

  // ── Thread links ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!linkThreadOpen) return
    threadsApi.getAll().then(setAllThreads).catch(() => {})
  }, [linkThreadOpen])

  const addThreadLink = async () => {
    if (!linkThreadForm.to_thread_id) return
    setAddingThreadLink(true)
    try {
      const ref = await threadsApi.addLink(threadId, {
        to_thread_id: Number(linkThreadForm.to_thread_id),
        kind: linkThreadForm.kind,
      })
      setThread((t) => ({ ...t, outgoing_links: [...(t.outgoing_links || []), ref] }))
      setLinkThreadOpen(false)
      setLinkThreadForm({ to_thread_id: '', kind: 'blocks' })
      syncEntries()
      toast('Link added')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setAddingThreadLink(false)
    }
  }

  const removeThreadLink = async (linkId) => {
    try {
      await threadsApi.deleteLink(linkId)
      setThread((t) => ({
        ...t,
        outgoing_links: (t.outgoing_links || []).filter((l) => l.link_id !== linkId),
        incoming_links: (t.incoming_links || []).filter((l) => l.link_id !== linkId),
      }))
      toast('Link removed')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <ThreadSkeleton />
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-terracotta">{error}</p>
      </div>
    )
  }
  if (!thread) return null

  const files = thread.attachments.filter((a) => a.type === 'file')
  const links = thread.attachments.filter((a) => a.type === 'link')

  // Open tasks: incomplete todos sorted by due_date asc, undated last
  const openTasks = thread.entries
    .filter((e) => e.type === 'todo' && !e.completed)
    .sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    })

  // Render order: incomplete entries/todos/decisions chrono, completed todos last
  const sortedEntries = [...thread.entries].sort((a, b) => {
    const aCompleted = a.type === 'todo' && a.completed
    const bCompleted = b.type === 'todo' && b.completed
    if (aCompleted && !bCompleted) return 1
    if (!aCompleted && bCompleted) return -1
    return new Date(a.created_at) - new Date(b.created_at)
  })

  const handleDueDateOption = (opt) => {
    setDueDateOption(opt.label)
    const resolved = opt.resolve()
    setDueDate(resolved)
  }

  return (
    <div className="flex-1 min-h-screen bg-paper-100 dark:bg-pitch-800 bg-grid-light dark:bg-grid-dark">
      {/* Header */}
      <header className="
        sticky top-0 z-10 px-8 py-4
        bg-paper-100/90 dark:bg-pitch-800/90 backdrop-blur-md
        border-b border-paper-200 dark:border-pitch-700
      ">
        <div className="max-w-5xl mx-auto pr-14">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs font-mono text-paper-500 dark:text-paper-600 mb-3">
            <Link to="/" className="hover:text-paper-700 dark:hover:text-paper-200 transition-colors">Dashboard</Link>
            <span>/</span>
            {area && (
              <>
                <Link to={`/area/${area.id}`} className="hover:text-paper-700 dark:hover:text-paper-200 transition-colors uppercase">
                  {area.name}
                </Link>
                <span>/</span>
              </>
            )}
            <span className="text-paper-400 dark:text-paper-700 truncate max-w-xs">{thread.title}</span>
          </nav>

          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                    className="
                      flex-1 font-display font-semibold text-xl tracking-[-0.01em]
                      bg-transparent border-b-2 border-mint-500
                      text-pitch-800 dark:text-white outline-none px-0
                    "
                  />
                  <button onClick={saveTitle} className="p-1 text-mint-600 hover:text-mint-700"><Check size={16} /></button>
                  <button onClick={() => { setTitleDraft(thread.title); setEditingTitle(false) }} className="p-1 text-paper-500 hover:text-paper-700"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-3 group">
                  <h1 className="font-display font-semibold text-xl tracking-[-0.01em] text-paper-900 dark:text-pitch-50 truncate">
                    {thread.title}
                  </h1>
                  <button
                    onClick={() => setEditingTitle(true)}
                    title="Edit title"
                    className="p-1 opacity-40 hover:opacity-100 text-paper-500 dark:text-paper-600 hover:text-paper-700 dark:hover:text-paper-200 transition-all"
                  >
                    <Edit3 size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Status selector */}
              <div className="relative">
                <button onClick={() => setEditingStatus((v) => !v)}>
                  <StatusBadge status={thread.status} type="thread" />
                </button>
                {editingStatus && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setEditingStatus(false)} />
                    <div className="absolute top-full right-0 mt-1 z-20 bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-lg shadow-xl overflow-hidden">
                      {Object.entries(THREAD_STATUSES).map(([key, cfg]) => (
                        <button
                          key={key}
                          onClick={() => requestStatusChange(key)}
                          className={`flex items-center gap-2 w-full px-4 py-2.5 text-left text-xs font-display uppercase tracking-wide hover:bg-paper-100 dark:hover:bg-pitch-700 transition-colors ${cfg.textClass}`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.dot }} />
                          {cfg.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Delete thread */}
              <button
                onClick={() => setDeleteThreadOpen(true)}
                className="p-2 rounded text-paper-400 dark:text-paper-700 hover:text-terracotta hover:bg-terracotta/10 transition-colors"
                title="Delete thread"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="mt-2">
            {editingDescription ? (
              <div className="flex gap-2">
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={2}
                  className="
                    flex-1 text-sm bg-transparent border-b border-paper-400 dark:border-paper-700
                    text-paper-700 dark:text-paper-400 outline-none resize-none
                  "
                />
                <button onClick={saveDescription} className="p-1 text-mint-600"><Check size={14} /></button>
                <button onClick={() => { setDescDraft(thread.description); setEditingDescription(false) }} className="p-1 text-paper-500"><X size={14} /></button>
              </div>
            ) : (
              <div
                className="flex items-start gap-2 group cursor-text"
                onClick={() => setEditingDescription(true)}
              >
                <p className="text-sm text-paper-600 dark:text-paper-500 flex-1">
                  {thread.description || (
                    <span className="italic text-paper-400 dark:text-paper-700">Add a description…</span>
                  )}
                </p>
                <Edit3 size={12} className="text-paper-500 dark:text-paper-600 opacity-40 group-hover:opacity-100 hover:text-paper-700 dark:hover:text-paper-200 flex-shrink-0 mt-0.5 transition-opacity" />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* AI Overview — the same OverviewCard areas use, for consistency */}
      <div className="max-w-5xl mx-auto px-8 pt-6">
        <OverviewCard
          data={thread}
          aiConfigured={aiConfigured}
          onSuggest={() => threadsApi.suggestSummary(threadId)}
          onSave={(text) => threadsApi.update(threadId, { summary: text })}
          onToggleAuto={(enabled) => threadsApi.update(threadId, { auto_update: enabled })}
          onSetAutoAll={async () => { await threadsApi.setAutoUpdateAll(true); return threadsApi.get(threadId) }}
          onChange={(updated) => setThread((t) => ({
            ...updated,
            entries: t.entries,
            attachments: t.attachments,
            outgoing_links: t.outgoing_links,
            incoming_links: t.incoming_links,
          }))}
          onError={(e) => toast(e.message, 'error')}
          scopeNoun="thread"
          emptyHint="No overview yet. Click Update to summarise this thread, or write your own."
          placeholder="Summarise what's happening in this thread..."
        />
      </div>

      {/* Body: two columns */}
      <div className="max-w-5xl mx-auto px-8 py-6 flex gap-8">
        {/* ── Left: Entry log ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-[13px] font-display font-semibold uppercase tracking-wider text-paper-600 dark:text-pitch-100">
              <MessageSquare size={15} className="text-paper-500 dark:text-pitch-100" />
              Add an entry
            </h2>
          </div>

          {/* Last-visited banner */}
          {lastVisitedBanner && (
            <p className="font-mono text-xs text-paper-500 dark:text-paper-700 italic mb-3">
              ↩ Last visited {lastVisitedBanner}
            </p>
          )}

          {/* Entry composer */}
          <div className="mb-6 p-4 rounded-xl border-2 border-dashed border-paper-300 dark:border-pitch-500 bg-paper-100/50 dark:bg-pitch-700/50">
            {/* Type selector */}
            <div className="flex items-center gap-1.5 mb-3">
              {ENTRY_TYPES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setEntryType(key); setDueDateOption(null); setDueDate(null) }}
                  className={`
                    px-3 py-1 rounded-full text-xs font-display uppercase tracking-wide transition-colors
                    ${entryType === key
                      ? 'bg-mint-700 text-white'
                      : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                    }
                  `}
                >
                  {label}
                </button>
              ))}
            </div>

            <textarea
              value={newEntryContent}
              onChange={(e) => setNewEntryContent(e.target.value)}
              placeholder={
                entryType === 'todo'     ? 'Describe the task…' :
                entryType === 'decision' ? 'State the decision and rationale…' :
                'What\'s happening? Document findings, decisions, blockers…'
              }
              rows={4}
              className="
                w-full bg-white dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                rounded-lg px-3 py-2.5 text-sm resize-none
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />

            {/* Due date row for To Do */}
            {entryType === 'todo' && (
              <div className="mt-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {DUE_DATE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => handleDueDateOption(opt)}
                      className={`
                        px-2.5 py-1 rounded-full text-xs font-display uppercase tracking-wide transition-colors
                        ${dueDateOption === opt.label
                          ? 'bg-mint-700 text-white'
                          : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {dueDateOption === 'Pick date' && (
                    <input
                      type="date"
                      value={dueDate || ''}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="text-xs px-2 py-1 rounded-md bg-white dark:bg-pitch-700 border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-mint-500"
                    />
                  )}
                </div>
                {dueDate && (
                  <p className="font-mono text-xs text-paper-500 mt-1">
                    due {format(parseISO(dueDate), 'dd MMM yyyy')}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-between items-center mt-2 gap-2">
              <button
                type="button"
                onClick={() => setMeetingOpen(true)}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md
                  text-paper-600 dark:text-paper-500
                  bg-paper-200 dark:bg-pitch-800
                  hover:bg-paper-300 dark:hover:bg-pitch-500
                  font-display uppercase tracking-wide transition-colors
                "
              >
                {(() => {
                  const MeetingIcon = ENTITY.meeting.Icon
                  return <MeetingIcon size={13} />
                })()}
                Add meeting
              </button>
              <button
                onClick={addEntry}
                disabled={!newEntryContent.trim() || addingEntry}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-md font-medium bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
              >
                <Plus size={14} />
                {addingEntry ? 'Adding…' : 'Add Entry'}
              </button>
            </div>
          </div>

          {/* Open tasks section */}
          {openTasks.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <ListTodo size={15} className="text-paper-500 dark:text-pitch-100" />
                <h3 className="text-[13px] font-display font-semibold uppercase tracking-wider text-paper-600 dark:text-pitch-100">
                  Open Tasks
                </h3>
                <span className="font-mono text-xs text-paper-400 dark:text-pitch-200">
                  {openTasks.length}
                </span>
              </div>
              <div className="space-y-1">
                {openTasks.map((task) => (
                  <a
                    key={task.id}
                    href={`#entry-${task.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white dark:bg-pitch-700 border border-paper-200 dark:border-pitch-500 hover:border-paper-300 dark:hover:border-paper-700 transition-colors group"
                  >
                    <TaskCheckbox
                      completed={false}
                      onToggle={(e) => { e.preventDefault(); toggleEntryComplete(task.id, true) }}
                    />
                    <span className="flex-1 text-xs text-pitch-500 dark:text-paper-300 truncate group-hover:text-pitch-800 dark:group-hover:text-white">
                      {task.content}
                    </span>
                    {task.due_date && (
                      <span className={`font-mono text-xs flex-shrink-0 ${getDueDateClass(task.due_date)}`}>
                        {format(parseISO(task.due_date), 'dd MMM')}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Divider, then the thread's own chronological record */}
          <div className="border-t border-paper-200 dark:border-pitch-600 mt-2 mb-5" />
          <div className="flex items-center gap-2 mb-4">
            <Activity size={15} className="text-paper-500 dark:text-pitch-100" />
            <h2 className="text-[13px] font-display font-semibold uppercase tracking-wider text-paper-600 dark:text-pitch-100">
              Timeline
            </h2>
            <span className="font-mono text-xs text-paper-400 dark:text-pitch-200">{thread.entries.length}</span>
          </div>

          {/* Entry timeline */}
          {thread.entries.length === 0 ? (
            <div className="text-center py-12 text-sm text-paper-500 dark:text-paper-700 italic">
              No entries yet. Add the first one above.
            </div>
          ) : (
            <div className="relative">
              {/* Connector line that visually threads the entry dots together */}
              <div className="absolute left-4 top-1 bottom-2 w-px bg-paper-300 dark:bg-pitch-500" />

              <div className="space-y-1">
                {sortedEntries.map((entry) => (
                  <div key={entry.id}>
                    <EntryBlock
                      entry={entry}
                      highlighted={highlightedEntryId === entry.id}
                      editing={editingEntryId === entry.id}
                      draft={entryDraft}
                      onEditStart={() => { setEditingEntryId(entry.id); setEntryDraft(entry.content) }}
                      onDraftChange={(v) => setEntryDraft(v)}
                      onSave={() => saveEntry(entry.id)}
                      onCancel={() => setEditingEntryId(null)}
                      onDelete={() => setDeleteEntryId(entry.id)}
                      onToggleComplete={(completed) => toggleEntryComplete(entry.id, completed)}
                      onSaveNotes={(notes) => saveEntryNotes(entry.id, notes)}
                      onSaveMeeting={(fields) => saveMeetingFields(entry.id, fields)}
                      onBreakDown={openBreakdownDrawer}
                      onSubtasksChange={(updated) => updateEntrySubtasks(entry.id, updated)}
                    />

                    {/* AI action suggestions - appears below the Update that triggered them */}
                    {actionSuggestions?.entryId === entry.id && (
                      <div className="ml-10">
                        <ActionSuggestionBanner
                          actions={actionSuggestions.actions}
                          threadId={entry.thread_id}
                          onCreateTodo={createTodoFromAction}
                          onDismiss={clearActions}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Attachments ───────────────────────────────────────────── */}
        <aside className="w-72 flex-shrink-0">
          <div className="sticky top-32 space-y-5">
            {/* Files - drop a file anywhere on this card, or click Upload */}
            <div
              onDragEnter={onFilesDragEnter}
              onDragLeave={onFilesDragLeave}
              onDragOver={onFilesDragOver}
              onDrop={onFilesDrop}
              className={`
                relative p-4 rounded-xl bg-paper-100 dark:bg-pitch-700
                border transition-colors
                ${filesDragActive
                  ? 'border-mint-500 ring-2 ring-mint-500/40'
                  : 'border-paper-300 dark:border-pitch-500'
                }
              `}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 flex items-center gap-1.5">
                  <Paperclip size={11} />
                  Files <span className="font-mono text-paper-400 dark:text-paper-700">({files.length})</span>
                </h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="flex items-center gap-1 text-xs text-paper-700 dark:text-paper-200 hover:text-paper-700 dark:hover:text-paper-200 transition-colors disabled:opacity-50"
                >
                  <Upload size={12} />
                  {uploadingFile ? 'Uploading…' : 'Upload'}
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={onFileInputChange} />
              </div>

              {files.length > 0 && (
                <div className="space-y-2 mb-3">
                  {files.map((f) => (
                    <FileItem key={f.id} file={f} onDelete={() => setDeleteAttachmentId(f.id)} />
                  ))}
                </div>
              )}

              {/* Always-visible drop zone - primary affordance, not just an
                  empty state. Sits beneath the file list. */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="
                  w-full flex flex-col items-center justify-center gap-1.5 py-4 px-3 rounded-lg
                  border border-dashed border-paper-300 dark:border-pitch-500
                  text-paper-500 dark:text-paper-600
                  hover:border-paper-400 dark:hover:border-paper-700
                  transition-colors
                "
              >
                <UploadCloud size={20} className="opacity-70" />
                <span className="text-[10px] font-display uppercase tracking-widest">
                  Drop a file to upload
                </span>
              </button>

              {/* Drop overlay */}
              {filesDragActive && (
                <div className="
                  absolute inset-0 z-10 rounded-xl flex flex-col items-center justify-center gap-1.5
                  bg-paper-200 dark:bg-pitch-700 dark:bg-paper-300 dark:bg-pitch-600 backdrop-blur-sm pointer-events-none
                  border-2 border-dashed border-mint-500
                ">
                  <Upload size={20} className="text-mint-700" />
                  <p className="font-display uppercase tracking-widest text-[10px] text-paper-700 dark:text-paper-200">
                    Drop to upload
                  </p>
                </div>
              )}
            </div>

            {/* Links - paste a URL inline, label after, or click +Add */}
            <div className="p-4 rounded-xl bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 flex items-center gap-1.5">
                  <Link2 size={11} />
                  Links <span className="font-mono text-paper-400 dark:text-paper-700">({links.length})</span>
                </h3>
                <button
                  onClick={() => setLinkModalOpen(true)}
                  className="flex items-center gap-1 text-xs text-paper-700 dark:text-paper-200 hover:text-paper-700 dark:hover:text-paper-200 transition-colors"
                >
                  <Plus size={12} />
                  Add
                </button>
              </div>

              {/* Inline composer - type or paste a URL, then label it */}
              <div className="mb-3 space-y-1.5">
                <input
                  type="url"
                  value={inlineLinkUrl}
                  onChange={(e) => setInlineLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && inlineLinkUrl.trim()) submitInlineLink() }}
                  placeholder="Paste a URL…"
                  className="
                    w-full px-2.5 py-1.5 text-xs rounded-md
                    bg-white dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500
                    text-pitch-800 dark:text-white
                    placeholder:text-paper-400 dark:placeholder:text-paper-700
                    focus:outline-none focus:ring-2 focus:ring-mint-500
                  "
                />
                {inlineLinkUrl.trim() && (
                  <div className="flex items-center gap-1.5 animate-fade-in">
                    <input
                      type="text"
                      value={inlineLinkName}
                      onChange={(e) => setInlineLinkName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitInlineLink() }}
                      placeholder="Label (optional)"
                      className="
                        flex-1 px-2.5 py-1.5 text-xs rounded-md
                        bg-white dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500
                        text-pitch-800 dark:text-white
                        placeholder:text-paper-400 dark:placeholder:text-paper-700
                        focus:outline-none focus:ring-2 focus:ring-mint-500
                      "
                    />
                    <button
                      onClick={submitInlineLink}
                      disabled={addingInlineLink}
                      title="Save link (Enter)"
                      className="
                        flex items-center justify-center w-7 h-7 rounded-md
                        bg-mint-700 hover:bg-mint-800 text-white
                        disabled:opacity-50 transition-colors
                      "
                    >
                      <Check size={12} />
                    </button>
                  </div>
                )}
              </div>

              {links.length === 0 ? (
                <p className="text-xs italic text-paper-400 dark:text-paper-700">No links yet.</p>
              ) : (
                <div className="space-y-2">
                  {links.map((l) => (
                    <LinkItem key={l.id} link={l} onDelete={() => setDeleteAttachmentId(l.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* Linked threads */}
            <div className="p-4 rounded-xl bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 flex items-center gap-1.5">
                  <GitBranch size={11} />
                  Linked threads
                </h3>
                <button
                  onClick={() => setLinkThreadOpen(true)}
                  className="flex items-center gap-1 text-xs text-paper-700 dark:text-paper-200 hover:text-paper-700 dark:hover:text-paper-200 transition-colors"
                >
                  <Plus size={12} />
                  Add
                </button>
              </div>

              <ThreadLinksList
                outgoing={thread.outgoing_links || []}
                incoming={thread.incoming_links || []}
                onRemove={removeThreadLink}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* ── Modals & dialogs ──────────────────────────────────────────────────── */}

      <Modal
        isOpen={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Add Link"
        width="max-w-sm"
        isDirty={Boolean(linkForm.name.trim() || linkForm.url.trim())}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">Label</label>
            <input
              autoFocus
              type="text"
              value={linkForm.name}
              onChange={(e) => setLinkForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. GitHub Issue #142"
              className="w-full px-3 py-2 text-sm rounded-lg bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
            />
          </div>
          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">URL</label>
            <input
              type="url"
              value={linkForm.url}
              onChange={(e) => setLinkForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700 text-pitch-800 dark:text-white placeholder:text-paper-400 dark:placeholder:text-paper-700 focus:outline-none focus:ring-2 focus:ring-mint-500"
              onKeyDown={(e) => { if (e.key === 'Enter') addLink() }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setLinkModalOpen(false)} className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors">Cancel</button>
            <button onClick={addLink} disabled={!linkForm.name.trim() || !linkForm.url.trim() || addingLink} className="px-4 py-2 text-sm rounded-md font-medium bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors">
              {addingLink ? 'Adding…' : 'Add Link'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteThreadOpen}
        onClose={() => setDeleteThreadOpen(false)}
        onConfirm={deleteThread}
        title="Delete Thread"
        message="This will permanently delete the thread and all its entries and attachments. This cannot be undone."
      />

      <ConfirmDialog
        isOpen={!!deleteEntryId}
        onClose={() => setDeleteEntryId(null)}
        onConfirm={() => deleteEntry(deleteEntryId)}
        title="Delete Entry"
        message="Delete this entry permanently?"
      />

      <ConfirmDialog
        isOpen={!!deleteAttachmentId}
        onClose={() => setDeleteAttachmentId(null)}
        onConfirm={() => deleteAttachment(deleteAttachmentId)}
        title="Remove Attachment"
        message="Remove this attachment? Uploaded files will be deleted from the server."
      />

      <AddMeetingModal
        isOpen={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        onSubmit={addMeeting}
        submitting={addingMeeting}
      />

      <StatusChangeModal
        isOpen={statusTarget !== null}
        currentStatus={thread?.status}
        targetStatus={statusTarget}
        onClose={() => { if (!changingStatus) setStatusTarget(null) }}
        onConfirm={submitStatusChange}
        submitting={changingStatus}
      />

      {/* Task decomposition drawer - slides in when the AI suggests a breakdown */}
      {drawerState && (
        <TaskDecompositionDrawer
          entryId={drawerState.entryId}
          taskTitle={drawerState.taskTitle}
          subtasks={drawerState.subtasks}
          onApprove={(created) => { mergeSubtasksIntoEntry(drawerState.entryId, created); closeDrawer() }}
          onDismiss={closeDrawer}
          onClose={closeDrawer}
        />
      )}

      <Modal
        isOpen={linkThreadOpen}
        onClose={() => setLinkThreadOpen(false)}
        title="Link to another thread"
        width="max-w-md"
        isDirty={Boolean(linkThreadForm.to_thread_id)}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Relationship
            </label>
            <div className="flex items-center gap-1.5">
              {[
                { key: 'blocks',     label: 'Blocks' },
                { key: 'relates_to', label: 'Relates to' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLinkThreadForm((f) => ({ ...f, kind: key }))}
                  className={`
                    px-3 py-1 rounded-full text-xs font-display uppercase tracking-wide transition-colors
                    ${linkThreadForm.kind === key
                      ? 'bg-mint-700 text-white'
                      : 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'
                    }
                  `}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
              Target thread
            </label>
            <select
              value={linkThreadForm.to_thread_id}
              onChange={(e) => setLinkThreadForm((f) => ({ ...f, to_thread_id: e.target.value }))}
              className="
                w-full px-3 py-2 text-sm rounded-lg
                bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                text-pitch-800 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            >
              <option value="">Select a thread…</option>
              {Object.entries(
                allThreads
                  .filter((t) => String(t.id) !== String(threadId))
                  .reduce((acc, t) => {
                    if (!acc[t.area_name]) acc[t.area_name] = []
                    acc[t.area_name].push(t)
                    return acc
                  }, {})
              ).map(([areaName, threads]) => (
                <optgroup key={areaName} label={areaName}>
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setLinkThreadOpen(false)}
              className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={addThreadLink}
              disabled={!linkThreadForm.to_thread_id || addingThreadLink}
              className="px-4 py-2 text-sm rounded-md font-medium bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
            >
              {addingThreadLink ? 'Linking…' : 'Add link'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Linked threads list ─────────────────────────────────────────────────────

function ThreadLinksList({ outgoing, incoming, onRemove }) {
  if (outgoing.length === 0 && incoming.length === 0) {
    return (
      <p className="text-xs italic text-paper-400 dark:text-paper-700">
        No linked threads.
      </p>
    )
  }

  const LABELS = {
    outgoing: { blocks: 'Blocks',     relates_to: 'Relates to' },
    incoming: { blocks: 'Blocked by', relates_to: 'Related'    },
  }

  const rows = [
    ...outgoing.map((l) => ({ ...l, direction: 'outgoing', arrow: ArrowRight })),
    ...incoming.map((l) => ({ ...l, direction: 'incoming', arrow: ArrowLeft  })),
  ]

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const ArrowIcon = row.arrow
        const label = LABELS[row.direction][row.kind] || row.kind
        return (
          <div key={`${row.direction}-${row.link_id}`} className="group flex items-start gap-2 text-xs">
            <ArrowIcon size={11} className="text-paper-500 dark:text-paper-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-display uppercase tracking-wide text-paper-500 dark:text-paper-600 mb-0.5">
                {label}
              </div>
              <Link
                to={`/thread/${row.thread_id}`}
                className="text-pitch-500 dark:text-paper-300 hover:text-paper-700 dark:hover:text-paper-200 transition-colors block truncate"
              >
                {row.thread_title}
              </Link>
              <div className="text-paper-500 dark:text-paper-700 font-mono mt-0.5 truncate">
                {row.area_name}
              </div>
            </div>
            {row.direction === 'outgoing' && (
              <button
                onClick={() => onRemove(row.link_id)}
                title="Remove link"
                className="p-1 rounded opacity-0 group-hover:opacity-100 text-paper-400 dark:text-paper-700 hover:text-terracotta transition-all"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Task checkbox ────────────────────────────────────────────────────────────

function TaskCheckbox({ completed, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`
        w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0
        transition-all duration-150
        ${completed
          ? 'bg-mint-700 border-mint-700'
          : 'border-paper-400 dark:border-paper-700 bg-transparent hover:border-mint-500'
        }
      `}
    >
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none">
        <path
          d="M4 12l5 5 11-11"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="24"
          strokeDashoffset={completed ? 0 : 24}
          style={{ transition: 'stroke-dashoffset 200ms ease 150ms' }}
        />
      </svg>
    </button>
  )
}

// ─── Entry block ──────────────────────────────────────────────────────────────

function EntryBlock({ entry, highlighted, editing, draft, onEditStart, onDraftChange, onSave, onCancel, onDelete, onToggleComplete, onSaveNotes, onSaveMeeting, onBreakDown, onSubtasksChange }) {
  const date = new Date(entry.created_at)
  const wasEdited = entry.updated_at !== entry.created_at
  const isDecision = entry.type === 'decision'
  const isTodo = entry.type === 'todo'
  const isMeeting = entry.type === 'meeting'
  const isBlockage = entry.type === 'blockage'
  const bionic = useBionic()

  // Inline meeting-edit state (independent of the regular content edit path)
  const [editingMeeting, setEditingMeeting] = useState(false)

  return (
    <div
      id={`entry-${entry.id}`}
      className={`relative pl-10 pb-6 group animate-fade-in rounded-lg transition-all duration-700 ${
        highlighted
          ? 'ring-2 ring-mint/60 bg-mint-50/40 dark:bg-mint-900/15 -ml-2 pl-12 pr-2'
          : 'ring-0'
      }`}
    >
      {/* Timeline dot */}
      <div className={`
        absolute left-3 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-pitch-800 z-10
        ${isDecision ? 'bg-amber-muted' : 'bg-mint'}
      `} />

      <div className={`
        relative rounded-xl border overflow-hidden
        bg-white dark:bg-pitch-700
        ${isBlockage
          ? 'border-terracotta/40 dark:border-terracotta/40'
          : 'border-paper-200 dark:border-pitch-500'
        }
        group-hover:border-paper-300 dark:group-hover:border-paper-700
        transition-colors
        ${isTodo && entry.completed ? 'opacity-60' : ''}
      `}>
        {/* Type accent bar */}
        {isDecision && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-muted rounded-l-xl" />
        )}
        {isMeeting && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-lavender rounded-l-xl" />
        )}
        {isBlockage && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-terracotta rounded-l-xl" />
        )}

        {/* Entry header */}
        <div className={`flex items-center justify-between px-4 py-2.5 border-b border-paper-100 dark:border-pitch-500 ${isBlockage ? 'bg-terracotta/5 dark:bg-terracotta/10' : 'bg-paper-100/50 dark:bg-pitch-800/30'} ${(isDecision || isMeeting || isBlockage) ? 'pl-5' : ''}`}>
          <div className="flex items-center gap-2">
            {isDecision && (
              <span className="font-display uppercase text-xs bg-amber-muted/10 text-amber-muted px-1.5 py-0.5 rounded">
                Decision
              </span>
            )}
            {isMeeting && (
              <span className="font-display uppercase text-xs bg-lavender/10 text-lavender px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <Calendar size={10} /> Meeting
              </span>
            )}
            {isBlockage && (
              <span className="font-display uppercase text-xs bg-terracotta/10 text-terracotta px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <Ban size={10} /> Blocked
              </span>
            )}
            <span className="text-xs font-mono font-medium text-paper-700 dark:text-paper-200">
              {format(date, 'dd MMM yyyy')}
            </span>
            <span className="text-xs font-mono text-paper-500 dark:text-paper-600">
              {format(date, 'HH:mm')}
            </span>
            {wasEdited && (
              <span className="text-xs font-mono text-paper-400 dark:text-paper-700">(edited)</span>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={isMeeting ? () => setEditingMeeting(true) : onEditStart}
              className="p-1 rounded text-paper-400 dark:text-paper-700 hover:text-paper-700 dark:hover:text-paper-200 hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors"
            >
              <Edit3 size={12} />
            </button>
            <button onClick={onDelete} className="p-1 rounded text-paper-400 dark:text-paper-700 hover:text-terracotta hover:bg-terracotta/10 transition-colors">
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={`px-4 py-3 ${(isDecision || isMeeting) ? 'pl-5' : ''}`}>
          {editing ? (
            <div>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                rows={6}
                className="
                  w-full bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                  rounded-lg px-3 py-2 text-sm resize-none font-mono
                  text-pitch-800 dark:text-white
                  focus:outline-none focus:ring-2 focus:ring-mint-500
                "
              />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={onCancel} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors">
                  <X size={12} /> Cancel
                </button>
                <button onClick={onSave} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-mint-700 hover:bg-mint-800 text-white transition-colors">
                  <Check size={12} /> Save
                </button>
              </div>
            </div>
          ) : isTodo ? (
            <div className="flex items-start gap-3">
              <TaskCheckbox
                completed={entry.completed}
                onToggle={() => onToggleComplete(!entry.completed)}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug transition-colors duration-200 ${
                  entry.completed
                    ? 'line-through text-paper-500 dark:text-paper-600'
                    : 'text-pitch-500 dark:text-paper-300'
                }`}>
                  {bionic ? bionicizeReact(entry.content) : entry.content}
                </p>
                {entry.due_date && !entry.completed && (
                  <p className={`font-mono text-xs mt-1 ${getDueDateClass(entry.due_date)}`}>
                    due {format(parseISO(entry.due_date), 'dd MMM yyyy')}
                  </p>
                )}
              </div>
            </div>
          ) : isMeeting ? (
            <MeetingBody
              entry={entry}
              editing={editingMeeting}
              onEditStart={() => setEditingMeeting(true)}
              onCancel={() => setEditingMeeting(false)}
              onSave={async (fields) => {
                await onSaveMeeting?.(fields)
                setEditingMeeting(false)
              }}
            />
          ) : (
            <div className="prose-entry text-pitch-500 dark:text-paper-300">
              <ReactMarkdown rehypePlugins={bionic ? [rehypeBionic] : []}>{entry.content}</ReactMarkdown>
            </div>
          )}
          {/* Notes - collapsible context, on every entry type for consistency. */}
          {!editing && (
            <EntryNotes initial={entry.notes || ''} onSave={onSaveNotes} />
          )}
        </div>

        {/* Subtasks - rendered INSIDE the card border so they read as part of
            the same to-do group, not a detached list below it. */}
        {isTodo && !editing && (
          <SubtaskList
            parentId={entry.id}
            subtasks={entry.subtasks || []}
            decomp_dismissed={entry.decomp_dismissed}
            taskTitle={entry.content}
            onBreakDown={onBreakDown}
            onSubtasksChange={onSubtasksChange}
          />
        )}
      </div>
    </div>
  )
}

// ─── File item ────────────────────────────────────────────────────────────────

// Extensions the browser can render natively - open in a new tab.
// Everything else: the browser will use Content-Disposition (download
// then OS app) which is the best a web app can do for "open in the
// program of the extension".
const PREVIEWABLE_EXTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp3', 'wav', 'ogg',
  'mp4', 'webm', 'mov',
  'txt', 'md', 'log', 'json', 'csv', 'xml', 'yaml', 'yml',
  'html', 'htm',
])

function isPreviewable(file) {
  const name = (file.original_name || file.name || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return PREVIEWABLE_EXTS.has(name.slice(dot + 1))
}

function FileItem({ file, onDelete }) {
  const previewable = isPreviewable(file)
  return (
    <div className="flex items-center justify-between gap-2 group py-1">
      {/*
        PDFs, images, audio, video and plain-text formats open inline in a
        new tab. Everything else carries `download` so the browser hands the
        file off to the OS, which opens it in the default app for the
        extension - the closest a web app can get to "open in the program
        of the extension".
      */}
      <a
        href={`/uploads/${file.stored_name}`}
        {...(previewable
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : { download: file.original_name })}
        title={previewable ? 'Open in new tab' : 'Download and open in default app'}
        className="flex items-center gap-2 min-w-0 text-xs text-pitch-500 dark:text-paper-400 hover:text-paper-700 dark:hover:text-paper-200 transition-colors"
      >
        <FileText size={12} className="flex-shrink-0 text-paper-500 dark:text-paper-600" />
        <span className="truncate">{file.name}</span>
        {file.size && (
          <span className="text-paper-400 dark:text-paper-700 flex-shrink-0 font-mono">
            {formatBytes(file.size)}
          </span>
        )}
      </a>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-paper-400 hover:text-terracotta transition-all"
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ─── Link item ────────────────────────────────────────────────────────────────

function LinkItem({ link, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-2 group py-1">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 min-w-0 text-xs text-pitch-500 dark:text-paper-400 hover:text-paper-700 dark:hover:text-paper-200 transition-colors"
      >
        <Link2 size={12} className="flex-shrink-0 text-paper-500 dark:text-paper-600" />
        <span className="truncate">{link.name}</span>
        <ExternalLink size={10} className="flex-shrink-0 text-paper-400 dark:text-paper-700" />
      </a>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-paper-400 hover:text-terracotta transition-all"
      >
        <X size={11} />
      </button>
    </div>
  )
}

function ThreadSkeleton() {
  return (
    <div className="flex-1 min-h-screen bg-white dark:bg-pitch-800 p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="h-7 w-64 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        <div className="h-5 w-96 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        <div className="h-32 rounded-xl bg-paper-200 dark:bg-pitch-700 animate-pulse mt-8" />
      </div>
    </div>
  )
}

// ─── Meeting body - title + datetime with inline edit ────────────────────────

function MeetingBody({ entry, editing, onEditStart, onCancel, onSave }) {
  const initialDt = entry.meeting_at ? toLocalInput(new Date(entry.meeting_at)) : ''
  const [title, setTitle] = useState(entry.content || '')
  const [dt, setDt] = useState(initialDt)
  const [saving, setSaving] = useState(false)

  // Re-seed local state whenever the entry changes underneath (e.g. after a save)
  useEffect(() => {
    setTitle(entry.content || '')
    setDt(entry.meeting_at ? toLocalInput(new Date(entry.meeting_at)) : '')
  }, [entry.content, entry.meeting_at])

  if (!editing) {
    return (
      <div
        onClick={onEditStart}
        className="cursor-text"
        title="Click to edit"
      >
        <div className="text-base font-medium text-pitch-800 dark:text-white leading-snug">
          {entry.content || <span className="italic text-paper-400 dark:text-paper-700">Untitled meeting</span>}
        </div>
        {entry.meeting_at ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-mono text-lavender">
            <Calendar size={11} />
            {format(new Date(entry.meeting_at), 'EEE dd MMM yyyy · HH:mm')}
          </div>
        ) : (
          <div className="mt-1.5 text-xs italic text-paper-400 dark:text-paper-700">
            No time set
          </div>
        )}
      </div>
    )
  }

  const canSave = title.trim().length > 0 && dt && !saving

  const commit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave?.({ title: title.trim(), meeting_at: dt })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1">
          Title
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="
            w-full px-3 py-2 text-sm rounded-md
            bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500
            text-pitch-800 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-mint-500
          "
        />
      </div>
      <div>
        <label className="block text-[10px] font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-1">
          When
        </label>
        <input
          type="datetime-local"
          value={dt}
          onChange={(e) => setDt(e.target.value)}
          className="
            w-full px-3 py-2 text-sm rounded-md
            bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500
            text-pitch-800 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-mint-500
          "
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
        >
          <X size={12} /> Cancel
        </button>
        <button
          onClick={commit}
          disabled={!canSave}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
        >
          <Check size={12} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── Entry notes - collapsible free-text context on any entry type ───────────

function EntryNotes({ initial, onSave }) {
  const hasContent = (initial || '').trim().length > 0
  // Auto-expanded when there's content. Otherwise collapsed by default so
  // entries aren't cluttered. User toggle overrides per entry.
  const [open, setOpen] = useState(hasContent)
  const [value, setValue] = useState(initial || '')
  const [saving, setSaving] = useState(false)

  // Keep local draft in sync if the entry's notes change from elsewhere
  // (e.g. after a save the parent re-renders with the persisted value).
  useEffect(() => {
    setValue(initial || '')
  }, [initial])

  const flush = async () => {
    const next = value
    if ((next || '') === (initial || '')) return  // nothing changed
    setSaving(true)
    try {
      await onSave?.(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="
          inline-flex items-center gap-1.5 px-1.5 py-0.5 -ml-1.5 rounded
          text-[10px] font-display uppercase tracking-widest
          text-paper-500 dark:text-paper-600
          hover:text-pitch-700 dark:hover:text-paper-200
          hover:bg-paper-100 dark:hover:bg-pitch-800
          transition-colors
        "
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        Notes
        {!open && hasContent && (
          <span className="ml-1 px-1 rounded bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200 font-mono text-[9px]">
            {value.trim().length}
          </span>
        )}
      </button>

      {open && (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={flush}
          placeholder="Add context, findings, or links - saved when you click away."
          rows={3}
          className="
            mt-1.5 w-full text-xs leading-relaxed
            bg-paper-100 dark:bg-pitch-800 border border-paper-200 dark:border-pitch-500
            rounded-md px-2.5 py-2 resize-y
            text-pitch-700 dark:text-paper-200
            placeholder:text-paper-400 dark:placeholder:text-paper-700
            focus:outline-none focus:ring-2 focus:ring-mint-500
          "
        />
      )}
      {saving && (
        <p className="mt-0.5 text-[10px] font-mono text-paper-400 dark:text-paper-700">
          Saving…
        </p>
      )}
    </div>
  )
}
