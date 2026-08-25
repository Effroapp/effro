import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PenLine, Scale, CircleSlash, Calendar, PinOff } from 'lucide-react'

import { entriesApi, pinsApi } from '../api/client'
import { notifyEntriesChanged, useEntriesChanged } from '../utils/entryEvents'
import TaskCheckbox from './TaskCheckbox'
import { useToast } from './Toast'

/**
 * In Hand - the pinned strip at the top of the dashboard.
 *
 * It answers one question at login: what is burning right now. Entries are
 * pinned from their threads and stay there; this holds references, newest pin
 * first.
 *
 * The load-bearing rule is the resting-state budget. A row carries three
 * things at rest, the control, the title and a bare muted age. Thread name and
 * Unpin wait for the pointer, and they arrive in an absolutely positioned
 * cluster so nothing reflows. Anything added to the resting row is a
 * regression: earlier iterations of this design died of accretion.
 *
 * Nothing hides items automatically, so there is no cap, no scroll and no
 * "show more". With nothing pinned the strip renders nothing at all and the
 * dashboard begins at the area grid, which is why there is no empty state.
 */

// Age is information, never alarm, so this never changes colour or wording as
// it grows. Under an hour reads as "now" rather than counting minutes down.
function relativeAge(pinnedAt) {
  const then = new Date(pinnedAt.endsWith('Z') ? pinnedAt : `${pinnedAt}Z`)
  const mins = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000))
  if (mins < 60) return 'now'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

// Type glyphs. Mint is reserved in this feature for the pin fill, the ticked
// checkbox and the completion settle, and terracotta is reserved app-wide for
// genuine alerts, so blocked reads neutral here rather than red.
const GLYPH = {
  entry:    { Icon: PenLine,     className: 'text-sky-muted' },
  decision: { Icon: Scale,       className: 'text-sage' },
  blockage: { Icon: CircleSlash, className: 'text-paper-700 dark:text-paper-500' },
  meeting:  { Icon: Calendar,    className: 'text-paper-700 dark:text-paper-500' },
}

// The 850ms hold and the 330ms collapse live in the .ih-settle keyframe; this
// is when the row can finally be dropped from the list.
const SETTLE_TOTAL_MS = 1180

export default function InHandStrip() {
  const toast = useToast()

  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [stripHovered, setStripHovered] = useState(false)
  const [hoveredId, setHoveredId] = useState(null)
  const [editing, setEditing] = useState(false)
  // Rows mid-exit after a tick. They hold their space until the collapse ends.
  const [settling, setSettling] = useState(() => new Set())

  const timers = useRef([])
  const after = useCallback((ms, fn) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const refresh = useCallback(async () => {
    try {
      setItems(await pinsApi.list())
    } catch {
      // A strip that cannot load is a strip that is not there. Nothing to warn
      // about: the dashboard simply begins at the area grid.
      setItems([])
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Pinning and completion both happen elsewhere (ThreadView, and the entry's
  // own checkbox), so the strip listens rather than polls.
  useEntriesChanged(refresh)

  // Done or Escape leaves edit mode. No stepper, no confirmation.
  useEffect(() => {
    if (!editing) return
    const onKey = (e) => { if (e.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const stopSettling = useCallback((id) => {
    setSettling((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }, [])

  // Ticking a todo. This is real completion, the same mutation the thread's own
  // checkbox fires, so the entry is done everywhere. No toast: the satisfaction
  // happens where the cursor already is. The row strikes through, says
  // "Dealt with." where the age was, holds, then collapses out.
  //
  // The row leaves because /api/pinned no longer returns it, not because the
  // strip dropped it locally. If the mutation fails the row is still there when
  // we refetch, which is exactly right.
  const tick = useCallback(async (item) => {
    setSettling((s) => new Set(s).add(item.id))
    try {
      await entriesApi.update(item.id, { completed: true })
    } catch (err) {
      stopSettling(item.id)
      toast(err.message, 'error')
      refresh()
      return
    }
    // Coming Up reads the same to-dos, so it has to hear about this.
    notifyEntriesChanged()
    after(SETTLE_TOTAL_MS, () => {
      stopSettling(item.id)
      refresh()
    })
  }, [after, refresh, stopSettling, toast])

  // Unpinning. The row leaves at once and the toast carries the reassurance
  // plus the way back, because this is the moment of doubt.
  const unpin = useCallback((item) => {
    const index = items.findIndex((i) => i.id === item.id)
    setItems((list) => list.filter((i) => i.id !== item.id))
    entriesApi.togglePin(item.id).then(notifyEntriesChanged).catch(refresh)

    toast(`Unpinned. Still in ${item.thread_name}.`, 'info', {
      action: {
        label: 'Undo',
        onClick: () => {
          // Back in its own place, with its own age. The server is handed the
          // original stamp so the row is restored rather than pinned afresh.
          setItems((list) => {
            const next = list.filter((i) => i.id !== item.id)
            next.splice(Math.max(0, index), 0, item)
            return next
          })
          entriesApi.togglePin(item.id, item.pinned_at).then(notifyEntriesChanged).catch(refresh)
        },
      },
    })
  }, [items, toast, refresh])

  const count = items.length

  if (!loaded || count === 0) return null

  return (
    <section
      aria-label="In Hand"
      onMouseEnter={() => setStripHovered(true)}
      onMouseLeave={() => { setStripHovered(false); setHoveredId(null) }}
      className="mb-[26px] rounded-xl overflow-hidden bg-white dark:bg-pitch-700
                 border border-paper-300 dark:border-pitch-500 animate-fade-in"
    >
      {/* Header. The count is the only capacity signal and it never becomes
          warning copy, at any number. */}
      <div className="flex items-center gap-3 h-[46px] px-3.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-paper-600 dark:text-paper-500">
          In Hand
        </span>
        <span className="text-xs tracking-[-0.005em] whitespace-nowrap text-paper-600 dark:text-paper-500">
          {count} in hand
        </span>
        <span className="flex-1" />
        {(editing || stripHovered) && (
          <button
            onClick={() => setEditing((v) => !v)}
            className={`px-0.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.09em] transition-colors
              hover:text-paper-900 dark:hover:text-white
              ${editing
                ? 'text-paper-700 dark:text-paper-300'
                : 'text-paper-600 dark:text-paper-500'}`}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {items.map((item) => (
        <Row
          key={item.id}
          item={item}
          editing={editing}
          hovered={hoveredId === item.id}
          settling={settling.has(item.id)}
          onEnter={() => setHoveredId(item.id)}
          onLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
          onTick={() => tick(item)}
          onUnpin={() => unpin(item)}
        />
      ))}
    </section>
  )
}

// ─── One row ──────────────────────────────────────────────────────────────────

function Row({ item, editing, hovered, settling, onEnter, onLeave, onTick, onUnpin }) {
  const glyph = GLYPH[item.type] || GLYPH.entry
  const isTodo = item.type === 'todo'
  // The reveal cluster clears the fixed 56px age column plus the row padding.
  const showHoverCluster = hovered && !settling && !editing
  const showEditCluster = editing && !settling

  return (
    <div
      className={`overflow-hidden border-t border-paper-900/[0.07] dark:border-white/[0.07]
                  ${settling ? 'ih-settle' : ''}`}
    >
      <Link
        to={`/thread/${item.thread_id}#entry-${item.id}`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="ih-row relative grid items-center h-11 px-3.5
                   [grid-template-columns:26px_minmax(0,1fr)_56px]"
      >
        {/* Hover tint sits behind the content so the reveal can fade over it. */}
        {(hovered || settling) && (
          <span
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--ih-veil)' }}
          />
        )}

        {/* Control */}
        <span className="relative flex items-center">
          {isTodo ? (
            <TaskCheckbox
              completed={settling}
              size={18}
              label={`Complete: ${item.content}`}
              onToggle={(e) => { e.preventDefault(); e.stopPropagation(); if (!settling) onTick() }}
            />
          ) : (
            <glyph.Icon size={15} className={glyph.className} aria-hidden="true" />
          )}
        </span>

        {/* Title. One line, no due date, no thread name, no column heads. */}
        <span className="relative min-w-0 flex items-center">
          <span
            className={`truncate text-sm tracking-[-0.005em] transition-colors duration-200
              ${settling
                ? 'line-through text-paper-600 dark:text-paper-500'
                : 'text-paper-900 dark:text-paper-100'}`}
          >
            {item.content}
          </span>
        </span>

        {/* Age, hard right in a fixed column so every row lines up. */}
        <span className="flex items-center justify-end">
          {!settling && (
            <span className="font-mono text-xs tracking-[0.04em] text-paper-600 dark:text-paper-500">
              {relativeAge(item.pinned_at)}
            </span>
          )}
        </span>

        {/* The settle. It replaces the age rather than adding to the row. */}
        {settling && (
          <span className="absolute right-3.5 inset-y-0 flex items-center font-mono text-xs
                           tracking-[0.04em] text-mint-700 dark:text-mint-400">
            Dealt with.
          </span>
        )}

        {/* Hover reveal. Absolutely positioned over a gradient so the title
            fades underneath it and the row never reflows. */}
        {showHoverCluster && (
          <span
            className="ih-veil-fade absolute right-[70px] inset-y-0 flex items-center gap-4 pl-12"
          >
            <span className="whitespace-nowrap text-xs tracking-[-0.005em] text-paper-600 dark:text-paper-500">
              {item.thread_name}
            </span>
            <UnpinButton onUnpin={onUnpin} />
          </span>
        )}

        {/* Edit mode shows Unpin on every row at once, over the resting
            background. No row demands a decision: keeping is what happens when
            you do nothing. */}
        {showEditCluster && !hovered && (
          <span
            className="ih-rest-fade absolute right-[70px] inset-y-0 flex items-center pl-12"
          >
            <UnpinButton onUnpin={onUnpin} />
          </span>
        )}

        {/* Hovering a row in edit mode also shows its thread name. */}
        {showEditCluster && hovered && (
          <span
            className="ih-veil-fade absolute right-[70px] inset-y-0 flex items-center gap-4 pl-12"
          >
            <span className="whitespace-nowrap text-xs tracking-[-0.005em] text-paper-600 dark:text-paper-500">
              {item.thread_name}
            </span>
            <UnpinButton onUnpin={onUnpin} />
          </span>
        )}
      </Link>
    </div>
  )
}

function UnpinButton({ onUnpin }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnpin() }}
      className="inline-flex items-center gap-1.5 py-1.5 text-[11px] font-medium uppercase
                 tracking-[0.09em] text-paper-700 dark:text-paper-300
                 hover:text-paper-900 dark:hover:text-white transition-colors"
    >
      <PinOff size={13} />
      Unpin
    </button>
  )
}
