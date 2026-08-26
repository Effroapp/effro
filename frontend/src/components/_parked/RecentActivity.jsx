// Parked from Dashboard remodel. Re-mount on a dedicated route if needed.
//
// Recent Activity is a backward-facing log. It was pulling attention on every
// dashboard open with no payoff; looking back is the Weekly Roundup's job. Kept
// intact here (not deleted) so it can return as a /activity route if real use
// shows demand.
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, Plus, PenLine, RefreshCw, Link2, Paperclip, CheckCheck,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { areasApi } from '../../api/client'
import StatusBadge from '../StatusBadge'

const EVENT_CONFIG = {
  thread_created: {
    Icon: Plus,
    className: 'bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200',
  },
  entry_added: {
    Icon: PenLine,
    className: 'bg-violet-500/10 text-violet-500 dark:text-violet-400',
  },
  status_changed: {
    Icon: RefreshCw,
    className: 'bg-amber-500/10 text-amber-500 dark:text-amber-400',
  },
  link_added: {
    Icon: Link2,
    className: 'bg-sky-500/10 text-sky-500 dark:text-sky-400',
  },
  file_uploaded: {
    Icon: Paperclip,
    className: 'bg-teal-500/10 text-teal-500 dark:text-teal-400',
  },
  todo_completed: {
    Icon: CheckCheck,
    className: 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400',
  },
}

function formatActivityDetail(eventType, detail, threadTitle) {
  if (eventType === 'thread_created') return detail || threadTitle
  if (eventType === 'entry_added') return detail || 'New entry added'
  if (eventType === 'todo_completed') return detail || 'To-do completed'
  if (eventType === 'status_changed') return detail ? `Status changed ${detail}` : 'Status changed'
  if (eventType === 'file_uploaded') return detail ? `File: ${detail}` : 'File uploaded'
  if (eventType === 'link_added') return detail ? `Link: ${detail}` : 'Link added'
  return detail || eventType
}

function ActivityRow({ item }) {
  const cfg = EVENT_CONFIG[item.event_type] ?? EVENT_CONFIG.entry_added
  const { Icon } = cfg
  const primaryText = formatActivityDetail(item.event_type, item.detail, item.thread_title)
  const showThreadContext = item.event_type !== 'thread_created'

  return (
    <Link
      to={`/thread/${item.thread_id}`}
      className="
        px-4 py-3 flex items-center gap-3 transition-colors duration-150
        hover:bg-paper-200/50 dark:hover:bg-pitch-700/40
        first:rounded-t-xl last:rounded-b-xl
      "
    >
      <span className={`p-1.5 rounded-md flex-shrink-0 ${cfg.className}`}>
        <Icon size={13} />
      </span>
      <span className="eyebrow text-pitch-700 dark:text-paper-200 flex-shrink-0">
        {item.area_name}
      </span>
      <span className="text-paper-400 dark:text-paper-700 text-xs flex-shrink-0">/</span>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs text-pitch-500 dark:text-paper-300 truncate">
          {primaryText}
        </span>
        {showThreadContext && (
          <span className="text-xs text-paper-500 dark:text-paper-700 truncate">
            {item.thread_title}
          </span>
        )}
      </div>
      <StatusBadge status={item.thread_status} type="thread" size="xs" />
      <span
        className="font-mono text-xs text-paper-400 dark:text-paper-700 flex-shrink-0"
        title={format(new Date(item.occurred_at), 'dd MMM yyyy HH:mm')}
      >
        {formatDistanceToNow(new Date(item.occurred_at), { addSuffix: true })}
      </span>
    </Link>
  )
}

export default function RecentActivity({ viewMode }) {
  const [items, setItems] = useState([])
  const [showAll, setShowAll] = useState(false)

  // Collapsed state - persisted, but Focus mode forces collapsed on first load.
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('recentActivityCollapsed')
    if (stored != null) return stored === 'true'
    return viewMode === 'focus'
  })

  // When the view mode flips to focus, auto-collapse (and remember).
  useEffect(() => {
    if (viewMode === 'focus') {
      setCollapsed(true)
      localStorage.setItem('recentActivityCollapsed', 'true')
    }
  }, [viewMode])

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem('recentActivityCollapsed', String(next))
      return next
    })
  }

  useEffect(() => {
    areasApi.getActivity(10).then(setItems).catch(() => {})
  }, [])

  const visible = showAll ? items : items.slice(0, 5)
  const hasMore = items.length > 5

  if (items.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center min-h-[80px]">
        <Activity size={20} className="text-paper-400 dark:text-paper-700 mb-1.5" />
        <p className="text-xs text-paper-500 dark:text-paper-700 italic">No activity recorded yet</p>
      </div>
    )
  }

  return (
    <div className="mt-10">
      <button
        onClick={toggle}
        className="
          w-full flex items-center gap-2 mb-3 py-1
          text-left transition-colors
          text-paper-500 dark:text-paper-600
          hover:text-pitch-700 dark:hover:text-paper-200
        "
      >
        {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        <span className="font-sans font-medium uppercase tracking-widest text-xs">
          Recent Activity
        </span>
        <span className="font-mono text-xs text-paper-400 dark:text-paper-700">
          {items.length}
        </span>
      </button>

      {!collapsed && (
        <>
          <div className="bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl divide-y divide-paper-200 dark:divide-pitch-700 overflow-hidden">
            {visible.map((item, i) => (
              <ActivityRow key={`${item.thread_id}-${item.occurred_at}-${i}`} item={item} />
            ))}
          </div>

          {hasMore && (
            <div className="mt-2 flex justify-center">
              <button
                onClick={() => setShowAll(v => !v)}
                className="
                  p-2 rounded-md text-xs font-sans font-medium uppercase tracking-wide transition-colors duration-150
                  text-paper-500 dark:text-paper-600
                  hover:text-paper-700 dark:hover:text-paper-200
                  hover:bg-paper-200 dark:hover:bg-pitch-700
                "
              >
                {showAll ? 'Show less' : 'Show 5 more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
