import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import ConfirmDialog from '../ConfirmDialog'
import { useToast } from '../Toast'
import { useEntryTypes } from '../../hooks/useEntryTypes'
import { CUSTOM_COLOURS, CUSTOM_PALETTE, ENTITY_TYPES } from '../../utils/entityIcons'

/**
 * The composer's type picker: the built-in types, then the user's own, then a
 * pill that opens the small manager for adding, renaming and deleting them.
 *
 * The row wraps rather than collapsing into an overflow menu. Someone with a
 * handful of their own types should see all of them at once, and a second row
 * of pills is calmer than a hidden list.
 */
const PILL = 'px-3 py-1 rounded-full text-xs font-display uppercase tracking-wide transition-colors'
const UNSELECTED = 'text-paper-600 dark:text-paper-500 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300 dark:hover:bg-pitch-500'

export default function EntryTypeRow({ value, customTypeId, onChange }) {
  const { types, create, update, remove } = useEntryTypes()
  const [open, setOpen] = useState(false)
  const pillRef = useRef(null)

  const close = () => {
    setOpen(false)
    pillRef.current?.focus()
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 mb-3">
      {ENTITY_TYPES.filter((t) => t.key !== 'meeting').map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key, null)}
          className={`${PILL} ${value === key ? 'bg-mint-700 text-white' : UNSELECTED}`}
        >
          {label}
        </button>
      ))}

      {types.map((t) => {
        const selected = value === 'custom' && customTypeId === t.id
        const palette = CUSTOM_PALETTE[t.colour] ?? CUSTOM_PALETTE.sage
        return (
          <button
            key={t.id}
            onClick={() => onChange('custom', t.id)}
            className={`${PILL} inline-flex items-center gap-1.5 ${selected ? 'bg-mint-700 text-white' : UNSELECTED}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${selected ? 'bg-white' : palette.dot}`} />
            {t.name}
          </button>
        )
      })}

      <button
        ref={pillRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${PILL} ${UNSELECTED} inline-flex items-center gap-1`}
      >
        <Plus size={11} />
        Your own…
      </button>

      {open && (
        <TypeManager
          types={types}
          onClose={close}
          onCreate={create}
          onRename={update}
          onRemove={remove}
          selectedId={value === 'custom' ? customTypeId : null}
          onSelect={(id) => onChange('custom', id)}
          onDeselect={() => onChange('entry', null)}
        />
      )}
    </div>
  )
}

// ─── The manager popover ──────────────────────────────────────────────────────

function TypeManager({ types, onClose, onCreate, onRename, onRemove, selectedId, onSelect, onDeselect }) {
  const toast = useToast()
  const ref = useRef(null)
  const nameRef = useRef(null)

  const [name, setName] = useState('')
  const [colour, setColour] = useState(CUSTOM_COLOURS[0].key)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(null)   // id being renamed
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  // Esc and a click outside both close, and focus goes back to the pill.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !pendingDelete) onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose, pendingDelete])

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const made = await onCreate({ name: trimmed, colour })
      onSelect(made.id)
      toast('Type added')
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const commitRename = async (id) => {
    const trimmed = renameDraft.trim()
    setRenaming(null)
    const current = types.find((t) => t.id === id)
    if (!trimmed || trimmed === current?.name) return
    try {
      await onRename(id, { name: trimmed })
      toast('Type renamed')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const confirmDelete = async () => {
    const target = pendingDelete
    setPendingDelete(null)
    try {
      await onRemove(target.id)
      // A deleted type cannot stay selected in the composer.
      if (selectedId === target.id) onDeselect()
      toast('Type deleted')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <>
      <div
        ref={ref}
        className="absolute z-30 top-full left-0 mt-2 w-full max-w-sm p-3 rounded-xl
                   bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500
                   shadow-lg animate-fade-in"
      >
        <p className="text-2xs font-display uppercase tracking-widest text-paper-500 dark:text-paper-600 mb-2">
          Your entry types
        </p>

        {types.length === 0 ? (
          <p className="text-xs italic text-paper-500 dark:text-paper-600 mb-3">
            Nothing here yet. Add a type you&apos;d use often.
          </p>
        ) : (
          <ul className="mb-3 space-y-0.5">
            {types.map((t) => {
              const palette = CUSTOM_PALETTE[t.colour] ?? CUSTOM_PALETTE.sage
              return (
                <li key={t.id} className="group flex items-center gap-2 px-1.5 py-1 rounded
                                          hover:bg-paper-100 dark:hover:bg-pitch-800">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${palette.dot}`} />
                  {renaming === t.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      maxLength={24}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(t.id) }
                        if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) }
                      }}
                      className="flex-1 min-w-0 px-1.5 py-0.5 text-sm rounded
                                 bg-paper-100 dark:bg-pitch-800
                                 border border-paper-300 dark:border-pitch-500
                                 text-pitch-800 dark:text-white
                                 focus:outline-none focus:ring-2 focus:ring-mint-500"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 truncate text-sm text-pitch-800 dark:text-paper-100">
                      {t.name}
                    </span>
                  )}
                  <button
                    onClick={() => { setRenaming(t.id); setRenameDraft(t.name) }}
                    aria-label={`Rename ${t.name}`}
                    className="p-1 rounded text-paper-400 dark:text-paper-700
                               hover:text-paper-700 dark:hover:text-paper-200
                               hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => setPendingDelete(t)}
                    aria-label={`Delete ${t.name}`}
                    className="p-1 rounded text-paper-400 dark:text-paper-700
                               hover:text-terracotta hover:bg-terracotta/10 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="pt-2 border-t border-paper-200 dark:border-pitch-500">
          <input
            ref={nameRef}
            value={name}
            maxLength={24}
            placeholder="Name, like Risk or Question"
            onChange={(e) => { setName(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className="w-full px-2.5 py-1.5 text-sm rounded-md
                       bg-paper-100 dark:bg-pitch-800
                       border border-paper-300 dark:border-pitch-500
                       text-pitch-800 dark:text-white
                       focus:outline-none focus:ring-2 focus:ring-mint-500"
          />
          {error && (
            <p className="mt-1 text-xs text-terracotta">{error}</p>
          )}

          <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1.5 mt-2">
            {CUSTOM_COLOURS.map(({ key, label }) => (
              <button
                key={key}
                role="radio"
                aria-checked={colour === key}
                aria-label={label}
                onClick={() => setColour(key)}
                className={`w-5 h-5 rounded-full transition-transform
                  ${CUSTOM_PALETTE[key].dot}
                  ${colour === key
                    ? 'ring-2 ring-offset-2 ring-paper-700 dark:ring-paper-300 ring-offset-white dark:ring-offset-pitch-700'
                    : 'hover:scale-110'}`}
              />
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded text-paper-600
                         hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={add}
              disabled={!name.trim() || busy}
              className="px-3 py-1.5 text-xs rounded bg-mint-700 hover:bg-mint-800
                         text-white disabled:opacity-50 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete type"
        message={pendingDelete ? deleteMessage(pendingDelete) : ''}
      />
    </>
  )
}

function deleteMessage(type) {
  const n = type.usage_count ?? 0
  if (n === 0) return `Delete "${type.name}"? No entries use it yet.`
  const noun = n === 1 ? 'entry' : 'entries'
  return `Delete "${type.name}"? The ${n} ${noun} using it will become Updates.`
}
