import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PinOff } from 'lucide-react'

import { entriesApi, pinsApi } from '../api/client'
import { compactAge } from '../utils/time.js'
import { notifyEntriesChanged, useEntriesChanged } from '../utils/entryEvents'
import { displayTitle } from '../utils/entries'
import { entityForEntry } from '../utils/entityIcons'
import TaskCheckbox from './entries/TaskCheckbox'
import Zone from './Zone'
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

// The 850ms hold and the 330ms collapse live in the .ih-settle keyframe; this
// is when the row can finally be dropped from the list.
const SETTLE_TOTAL_MS = 1180

export default function InHandStrip({ onCount }) {
  const toast = useToast()

  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)
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

  // The header's status line counts what is in hand, and this is the only
  // thing that knows.
  useEffect(() => { onCount?.(count) }, [count, onCount])

  if (!loaded || count === 0) return null

  return (
    <div onMouseLeave={() => setHoveredId(null)}>
      <Zone
        id="inhand"
        title="In hand"
        count={String(count)}
        bodyClass="card"
        actions={
          /* Tidy turns Unpin on for every row at once, so clearing several is
             one decision rather than a hunt with the pointer. It used to wait
             for hover, which meant it was not there when you looked for it. */
          <button type="button" className="zact" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Tidy'}
          </button>
        }
      >
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
      </Zone>
    </div>
  )
}

// ─── One row ──────────────────────────────────────────────────────────────────

function Row({ item, editing, hovered, settling, onEnter, onLeave, onTick, onUnpin }) {
  // The type reads the same here as it does on the card in its thread. The
  // strip used to carry its own tints, which meant an Update was one colour on
  // the dashboard and another in the timeline.
  const glyph = entityForEntry(item)
  const GlyphIcon = glyph.Icon
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
        className="ih-row relative"
      >
        {/* Hover tint sits behind the content so the reveal can fade over it. */}
        {(hovered || settling) && (
          <span
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--ih-veil)' }}
          />
        )}

        {/* Control. Deliberately not .box: that class draws the reference
            mock's own 16px checkbox, and the real control goes here. */}
        <span className="relative mt-0.5 flex flex-shrink-0 items-center">
          {isTodo ? (
            <TaskCheckbox
              completed={settling}
              size={18}
              label={`Complete: ${displayTitle(item)}`}
              onToggle={(e) => { e.preventDefault(); e.stopPropagation(); if (!settling) onTick() }}
            />
          ) : (
            <GlyphIcon size={15} style={{ color: glyph.css }} aria-hidden="true" />
          )}
        </span>

        {/* Title. Up to two lines, no due date, no thread name, no column
            heads. This is the row's flexible child, so the age sits right. */}
        <span
          className={`ih-text transition-colors duration-200
            ${settling ? 'line-through is-settling' : ''}`}
        >
          {displayTitle(item)}
        </span>

        {/* Age, hard right so every row lines up. */}
        {!settling && <span className="age flex-shrink-0">{compactAge(item.pinned_at)}</span>}

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
      className="inline-flex items-center gap-1.5 py-1.5 text-2xs font-medium uppercase
                 tracking-[0.09em] text-paper-700 dark:text-paper-300
                 hover:text-paper-900 dark:hover:text-white transition-colors"
    >
      <PinOff size={13} />
      Unpin
    </button>
  )
}
