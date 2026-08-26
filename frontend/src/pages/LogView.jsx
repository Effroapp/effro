import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { areasApi } from '../api/client'
import PageShell from '../components/PageShell'
import PageHeader from '../components/PageHeader'
import IntroPanel, { Key } from '../components/IntroPanel'

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

function LogRow({ record }) {
  return (
    <Link
      to={`/thread/${record.thread_id}`}
      className="
        px-4 py-3 flex items-center gap-3 text-xs
        border-b border-paper-100 dark:border-pitch-700 last:border-0
        hover:bg-paper-100/60 dark:hover:bg-pitch-700/40
        transition-colors
      "
    >
      <span className="font-mono text-paper-400 dark:text-paper-700 flex-shrink-0 w-28">
        {format(new Date(record.occurred_at), 'dd MMM HH:mm')}
      </span>
      <span className="font-sans font-semibold text-pitch-700 dark:text-paper-200 flex-shrink-0">
        {record.area_name}
      </span>
      {record.thread_title && (
        <>
          <span className="text-paper-400 dark:text-paper-700 flex-shrink-0">/</span>
          <span className="text-paper-600 dark:text-paper-500 truncate w-40 flex-shrink-0">
            {record.thread_title}
          </span>
        </>
      )}
      <span className={`font-sans font-medium uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${ACTION_BADGE[record.action] ?? ACTION_BADGE.updated}`}>
        {record.action}
      </span>
      <span className="text-paper-600 dark:text-paper-500 flex-1 truncate">
        {formatAuditDescription(record)}
      </span>
    </Link>
  )
}

function LogSkeleton() {
  return (
    <div className="bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl overflow-hidden divide-y divide-paper-100 dark:divide-pitch-700">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-3">
          <div className="w-28 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="w-24 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="w-2 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="w-40 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="w-16 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
          <div className="flex-1 h-3 rounded bg-paper-200 dark:bg-pitch-700 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export default function LogView() {
  const [records, setRecords] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterAreaId, setFilterAreaId] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [log, areaList] = await Promise.all([
        areasApi.getGlobalAudit(),
        areasApi.list(),
      ])
      setRecords(log)
      setAreas(areaList)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const displayed = filterAreaId
    ? records.filter((r) => String(r.area_id) === filterAreaId)
    : records

  return (
    <PageShell
      header={
        <PageHeader
          icon={History}
          title="Audit Log"
          titleAdornment={!loading && (
            <span className="font-mono text-xs text-paper-400 dark:text-paper-700">
              {displayed.length}
            </span>
          )}
          right={areas.length > 0 && (
            <select
              value={filterAreaId}
              onChange={(e) => setFilterAreaId(e.target.value)}
              className="
                px-3 py-1.5 text-xs rounded-lg
                bg-white dark:bg-pitch-700
                border border-paper-300 dark:border-paper-700
                text-pitch-500 dark:text-paper-300
                focus:outline-none focus:ring-2 focus:ring-mint-500
                font-sans font-medium uppercase tracking-wide
              "
            >
              <option value="">All Areas</option>
              {areas.map((a) => (
                <option key={a.id} value={String(a.id)}>{a.name}</option>
              ))}
            </select>
          )}
        />
      }
    >
      {/* First-run explainer - shown once, then dismissed for good. */}
      <IntroPanel icon={History} title="The audit log" storageKey="effro.auditLogIntroSeen">
        The audit log is a plain, time-ordered record of the changes to your
        areas and threads, what was <Key>created</Key>, <Key>edited</Key>,{' '}
        <Key>completed</Key> or <Key>removed</Key>, and exactly when. We keep it
        because being able to retrace your own steps is quietly reassuring, and
        because you deserve to see what the app has done with your work, with
        nothing tucked away.
      </IntroPanel>

      {loading ? (
        <LogSkeleton />
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-terracotta mb-3">{error}</p>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-paper-200 dark:bg-pitch-700 text-sm mx-auto hover:bg-paper-300 dark:hover:bg-pitch-500 transition-colors"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16">
          <History size={24} className="text-paper-300 dark:text-pitch-500 mx-auto mb-3" />
          <p className="text-sm italic text-paper-500 dark:text-paper-700">
            {filterAreaId ? 'No audit records for this area yet' : 'No audit records yet'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 rounded-xl overflow-hidden">
          {displayed.map((record) => (
            <LogRow key={record.id} record={record} />
          ))}
        </div>
      )}
    </PageShell>
  )
}
