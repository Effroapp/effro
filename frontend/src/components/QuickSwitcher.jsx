import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, MessageSquare, LayoutDashboard, History, BrainCircuit, CornerDownLeft,
} from 'lucide-react'
import { areasApi, threadsApi } from '../api/client'
import { getAreaStatus } from '../utils/status'
import Modal from './Modal'

const ACTIONS = [
  { id: 'a-dashboard', label: 'Dashboard',     icon: LayoutDashboard, path: '/' },
  { id: 'a-log',       label: 'Audit Log',     icon: History,         path: '/log' },
  { id: 'a-process',   label: 'Smart Generate', icon: BrainCircuit,   path: '/process' },
]

const SECTION_LABELS = {
  action: 'Pages',
  area:   'Areas',
  thread: 'Threads',
}

export default function QuickSwitcher({ isOpen, onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [areas, setAreas] = useState([])
  const [threads, setThreads] = useState([])
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    Promise.all([areasApi.list(), threadsApi.getAll()])
      .then(([a, t]) => { setAreas(a); setThreads(t) })
      .catch(() => {})
    setQuery('')
    setActiveIdx(0)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isOpen])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (s) => !q || (s || '').toLowerCase().includes(q)

    const actionItems = ACTIONS
      .filter((a) => match(a.label))
      .map((a) => ({ kind: 'action', ...a }))

    const areaItems = areas
      .filter((a) => match(a.name))
      .map((a) => ({
        kind: 'area',
        id: `area-${a.id}`,
        label: a.name,
        path: `/area/${a.id}`,
        status: a.status,
      }))

    const threadItems = threads
      .filter((t) => match(t.title) || match(t.area_name))
      .map((t) => ({
        kind: 'thread',
        id: `thread-${t.id}`,
        label: t.title,
        sublabel: t.area_name,
        path: `/thread/${t.id}`,
      }))

    return [...actionItems, ...areaItems, ...threadItems]
  }, [query, areas, threads])

  useEffect(() => { setActiveIdx(0) }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[activeIdx]
      if (item) {
        navigate(item.path)
        onClose()
      }
    }
  }

  // Group items by kind for section headings, but keep a flat index for keyboard nav
  let runningIdx = -1
  const grouped = ['action', 'area', 'thread'].map((kind) => {
    const group = items.filter((it) => it.kind === kind)
    return {
      kind,
      items: group.map((it) => ({ ...it, _idx: ++runningIdx })),
    }
  }).filter((g) => g.items.length > 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Jump to" width="max-w-xl">
      <div className="space-y-3">
        {/* Search input */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-paper-500 dark:text-paper-600"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search areas, threads, or pages…"
            className="
              w-full pl-9 pr-3 py-2.5 text-sm rounded-lg
              bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
              text-pitch-800 dark:text-white
              placeholder:text-paper-400 dark:placeholder:text-paper-700
              focus:outline-none focus:ring-2 focus:ring-mint-500
            "
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto -mx-1 pr-1">
          {items.length === 0 ? (
            <p className="text-xs italic text-paper-500 dark:text-paper-700 px-3 py-4">
              No matches.
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.kind} className="mb-2 last:mb-0">
                <div className="px-3 pt-2 pb-1 text-xs font-sans font-medium uppercase tracking-widest text-paper-500 dark:text-paper-700">
                  {SECTION_LABELS[group.kind]}
                </div>
                {group.items.map((item) => {
                  const active = item._idx === activeIdx
                  return (
                    <button
                      key={item.id}
                      data-idx={item._idx}
                      onClick={() => { navigate(item.path); onClose() }}
                      onMouseEnter={() => setActiveIdx(item._idx)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors
                        ${active
                          ? 'bg-paper-200 dark:bg-pitch-700'
                          : 'hover:bg-paper-200/60 dark:hover:bg-pitch-700/60'
                        }
                      `}
                    >
                      <ItemIcon item={item} />
                      <span className="flex-1 min-w-0 text-xs text-pitch-700 dark:text-paper-200 truncate">
                        {item.label}
                      </span>
                      {item.sublabel && (
                        <span className="font-sans text-xs text-paper-500 dark:text-paper-600 truncate max-w-[40%]">
                          {item.sublabel}
                        </span>
                      )}
                      {active && (
                        <CornerDownLeft
                          size={12}
                          className="text-paper-500 dark:text-paper-600 flex-shrink-0"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 pt-3 border-t border-paper-200 dark:border-pitch-700 text-xs font-mono text-paper-400 dark:text-paper-700">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </Modal>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 font-mono text-paper-600 dark:text-paper-500">
      {children}
    </kbd>
  )
}

function ItemIcon({ item }) {
  if (item.kind === 'action') {
    const Icon = item.icon
    return (
      <span className="p-1.5 rounded-md bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200 flex-shrink-0">
        <Icon size={13} />
      </span>
    )
  }
  if (item.kind === 'area') {
    const config = getAreaStatus(item.status)
    return (
      <span
        className="w-3 h-3 rounded-full flex-shrink-0 ml-1.5 mr-1"
        style={{ backgroundColor: config.dot }}
      />
    )
  }
  return (
    <span className="p-1.5 rounded-md bg-paper-200 dark:bg-pitch-700 text-paper-500 dark:text-paper-600 flex-shrink-0">
      <MessageSquare size={13} />
    </span>
  )
}
