import { useState, useRef, useEffect } from 'react'
import { RefreshCw, Edit3, Wand2, Clock, Check, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { SECTION_ICONS } from '../utils/entityIcons'
import { parseUTC } from '../utils/time.js'
import Markdown from './Markdown'
import MarkdownArea from './MarkdownArea'

/**
 * OverviewCard — the AI "Current Overview" for an Area or a Thread. One
 * component so both behave identically. Tracks the live situation; the stable
 * "what this is" text lives in the entity's description field, not here.
 *
 * The parent owns the entity and its summary_* fields; this card manages its
 * own edit / generate / save / auto-toggle UI state and calls back through:
 *   onSuggest()            -> Promise<{ summary }>        (generate text)
 *   onSave(text)           -> Promise<updatedEntity>      (persist text)
 *   onToggleAuto(enabled)  -> Promise<updatedEntity>      (per-entity opt-in)
 *   onSetAutoAll()         -> Promise<updatedEntity>      (bulk + re-fetch self)
 *   onChange(updatedEntity)-> void                        (push state upward)
 *
 * Loading state follows the researched pattern: keep the previous text, dim it,
 * sweep a mint shimmer across it, show one muted "Generating…" label. No
 * spinner, no blur, no overlay. Honors prefers-reduced-motion (see index.css).
 */
export default function OverviewCard({
  data,
  aiConfigured,
  onSuggest,
  onSave,
  onToggleAuto,
  onSetAutoAll,
  onChange,
  onError = () => {},
  scopeNoun = 'area',          // "area" | "thread" — used in the auto-all prompt
  emptyHint = 'No overview yet. Click Update to generate one, or write your own.',
  placeholder = 'Describe what is happening here...',
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.summary || '')
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [togglingAuto, setTogglingAuto] = useState(false)
  const [autoPrompt, setAutoPrompt] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      ref.current.selectionStart = ref.current.value.length
    }
  }, [editing])

  const OverviewIcon = SECTION_ICONS.overview
  const hasSummary = Boolean(data.summary)
  const aiOff = aiConfigured === false

  // ── Actions ──────────────────────────────────────────────────────────────
  const suggest = async () => {
    setSuggesting(true)
    try {
      const result = await onSuggest()
      setDraft(result.summary)
      setEditing(true)
    } catch (e) {
      onError(e)
    } finally {
      setSuggesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await onSave(draft)
      onChange(updated)
      setEditing(false)
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setDraft(data.summary || '')
    setEditing(false)
  }

  const toggleAuto = () => {
    if (data.summary_auto_update) {
      applyAuto(() => onToggleAuto(false))
    } else {
      setAutoPrompt(true)
    }
  }

  const applyAuto = async (fn) => {
    setTogglingAuto(true)
    setAutoPrompt(false)
    try {
      const updated = await fn()
      if (updated) onChange(updated)
    } catch (e) {
      onError(e)
    } finally {
      setTogglingAuto(false)
    }
  }

  // ── Freshness + subtle sync indicator ────────────────────────────────────
  const Freshness = () => {
    if (!data.summary_updated_at) return null
    const when = formatDistanceToNow(parseUTC(data.summary_updated_at))
    return (
      <div className="px-4 pt-2.5 flex items-center gap-1.5 text-2xs font-mono text-paper-500 dark:text-pitch-200">
        <Clock size={11} className="flex-shrink-0" />
        <span>
          {data.summary_auto_generated ? 'Auto-generated' : 'Updated'} {when} ago
        </span>
        {/* Subtle sync state — a small dot, not a pill. */}
        {hasSummary && (
          data.summary_stale ? (
            <span className="flex items-center gap-1 text-mustard">
              <span className="w-1.5 h-1.5 rounded-full bg-mustard flex-shrink-0" />
              {data.summary_new_count > 0
                ? `${data.summary_new_count} new since`
                : 'out of sync'}
            </span>
          ) : (
            <span
              className="w-1.5 h-1.5 rounded-full bg-mint-500/80 flex-shrink-0"
              title="Up to date"
            />
          )
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="mb-8 rounded-xl border border-paper-300 dark:border-pitch-600 bg-paper-200/40 dark:bg-pitch-700/30 overflow-hidden">
      {/* Header: label (left), controls (right) */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-paper-300/70 dark:border-pitch-600/70">
        <div className="flex items-center gap-2 min-w-0">
          <OverviewIcon size={13} className="text-paper-500 dark:text-pitch-100 flex-shrink-0" />
          <span className="eyebrow text-paper-500 dark:text-pitch-100">
            Current Overview
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={toggleAuto}
            disabled={togglingAuto || aiOff}
            title={
              aiOff
                ? 'Set up an AI engine in Settings to use auto-update'
                : data.summary_auto_update
                  ? 'Auto-update is on. Click to turn off.'
                  : 'Keep this overview refreshed automatically each day'
            }
            className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              data.summary_auto_update
                ? 'text-mint-600 dark:text-mint-400'
                : 'text-paper-500 dark:text-pitch-100 hover:text-paper-700 dark:hover:text-paper-200'
            }`}
          >
            <Wand2 size={12} />
            Auto {data.summary_auto_update ? 'on' : 'off'}
          </button>
          <button
            onClick={suggest}
            disabled={suggesting || aiOff}
            title={aiOff ? 'Set up an AI engine in Settings to use this' : 'Regenerate from recent activity'}
            className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-pitch-100 hover:text-paper-700 dark:hover:text-paper-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={12} />
            {suggesting ? 'Generating…' : 'Update'}
          </button>
          {!editing && (
            <button
              onClick={() => { setDraft(data.summary || ''); setEditing(true) }}
              className="flex items-center gap-1.5 text-xs text-paper-500 dark:text-pitch-100 hover:text-paper-700 dark:hover:text-paper-200 transition-colors"
            >
              <Edit3 size={12} />
              Edit
            </button>
          )}
        </div>
      </div>

      <Freshness />

      {/* Auto-update "apply to all" prompt */}
      {autoPrompt && (
        <div className="mx-4 mt-3 rounded-lg bg-mint-50/60 dark:bg-mint-900/15 border border-mint/20 px-3 py-2.5">
          <p className="text-xs text-pitch-600 dark:text-paper-300 mb-2">
            Keep this overview refreshed automatically each day. Apply to every {scopeNoun} too?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => applyAuto(onSetAutoAll)}
              disabled={togglingAuto}
              className="btn btn-sm btn-primary"
            >
              All {scopeNoun}s
            </button>
            <button
              onClick={() => applyAuto(() => onToggleAuto(true))}
              disabled={togglingAuto}
              className="px-3 py-1.5 text-xs rounded-md bg-paper-200 dark:bg-pitch-600 text-pitch-700 dark:text-paper-200 hover:bg-paper-300 dark:hover:bg-pitch-500 disabled:opacity-60 transition-colors"
            >
              Just this {scopeNoun}
            </button>
            <button
              onClick={() => setAutoPrompt(false)}
              className="px-3 py-1.5 text-xs rounded-md text-paper-600 dark:text-pitch-100 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="px-4 py-3">
        {editing ? (
          <div>
            <MarkdownArea
              textareaRef={ref}
              value={draft}
              onChange={setDraft}
              rows={4}
              placeholder={placeholder}
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
        ) : suggesting ? (
          /* Generating: keep prior text, dim + shimmer it, single muted label */
          <div>
            <p className="text-base leading-relaxed whitespace-pre-wrap ov-generating">
              {data.summary || 'Generating a fresh overview from recent activity'}
            </p>
            <p className="mt-2 text-2xs font-mono text-paper-500 dark:text-pitch-200">
              Generating…
            </p>
          </div>
        ) : (
          <div
            className="cursor-text"
            onClick={() => { setDraft(data.summary || ''); setEditing(true) }}
          >
            {data.summary ? (
              <Markdown className="prose-base text-pitch-700 dark:text-paper-200">
                {data.summary}
              </Markdown>
            ) : (
              <p className="text-base leading-relaxed italic text-paper-400 dark:text-paper-700">{emptyHint}</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
