import { useState } from 'react'
import { Ban, Calendar, Check, Edit3, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'

import Markdown, { InlineMarkdown } from '../Markdown'
import MarkdownArea from '../MarkdownArea'
import PinControl from '../PinControl'
import SubtaskList from '../SubtaskList'
import { entityForEntry } from '../../utils/entityIcons'
import { TITLED_TYPES } from '../../utils/entries'
import { Tooltip } from '../Tooltip'
import ReferenceCard from './ReferenceCard'
import TitleField from './TitleField'
import { getDueDateClass } from '../../utils/status'
import EntryNotes from './EntryNotes'
import MeetingBody from './MeetingBody'
import TaskCheckbox from './TaskCheckbox'

// ─── Entry block ──────────────────────────────────────────────────────────────

export default function EntryBlock({ entry, highlighted, editing, draft, onEditStart, onDraftChange, onSave, onCancel, onDelete, onToggleComplete, onTogglePin, onSaveNotes, onSaveMeeting, onSaveTitle, onTitleEditOpen, onTitleEditClose, onBreakDown, onSubtasksChange }) {
  const date = new Date(entry.created_at)
  const wasEdited = entry.updated_at !== entry.created_at
  const isDecision = entry.type === 'decision'
  const isTodo = entry.type === 'todo'
  const isMeeting = entry.type === 'meeting'
  const isBlockage = entry.type === 'blockage'
  const isCustom = entry.type === 'custom'
  const isReference = entry.type === 'reference'
  const isTitled = TITLED_TYPES.has(entry.type)
  // Every entry that carries a title shows one, fallback included, so the
  // timeline has one rhythm rather than two.
  //
  // A fallback repeats the first line of the prose beneath it, which is the
  // cost of that consistency. The tidy-up in Settings is how those become real
  // names. A To Do shows its short form here and the task in full below, which
  // reads as a heading and its detail rather than a repetition once the short
  // form is a real one.
  const showsHeading = isTitled && !!entry.title
  // A custom entry behaves exactly like an Update. Only its dot, accent bar,
  // badge and icon come from the user's own type.
  const meta = entityForEntry(entry)
  const MetaIcon = meta.Icon

  // Inline meeting-edit state (independent of the regular content edit path)
  const [editingMeeting, setEditingMeeting] = useState(false)

  // Inline title edit, opened from the heading or from Add a title.
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const openTitleEditor = () => {
    // Pre-filled with whatever is stored, including a fallback, so there is
    // something to tweak rather than a blank box.
    setTitleDraft(entry.title || '')
    setEditingTitle(true)
    onTitleEditOpen?.(entry.id)
  }
  const closeTitleEditor = () => {
    setEditingTitle(false)
    onTitleEditClose?.(entry.id)
  }
  const commitTitle = async () => {
    const next = titleDraft
    closeTitleEditor()
    if (next === (entry.title || '')) return
    await onSaveTitle?.(next)
  }

  return (
    <div
      id={`entry-${entry.id}`}
      className={`relative pl-12 group animate-fade-in rounded-lg transition duration-700 ${
        highlighted
          ? 'ring-2 ring-mint/60 bg-mint-50/40 dark:bg-mint-900/15 -mx-2 px-2'
          : 'ring-0'
      }`}
    >
      {/* Rail medallion. The type, readable down a long thread without reading
          any of it. It sits in this entry's own 48px gutter, so `left-0` is the
          gutter rather than the card: putting the padding on the list instead
          landed it on top of the card. Opaque, so the rail line cannot show
          through it. */}
      <div
        className="absolute left-0 top-3 w-8 h-8 rounded-[10px] z-10 flex items-center justify-center"
        style={{
          background: `color-mix(in srgb, ${meta.css} 14%, var(--rail-ground))`,
          border: `1px solid color-mix(in srgb, ${meta.css} 34%, transparent)`,
        }}
      >
        <MetaIcon size={15} strokeWidth={2} style={{ color: meta.css }} />
      </div>

      <div
        className={`
          relative rounded-xl border overflow-hidden
          bg-white dark:bg-pitch-700
          border-paper-200 dark:border-pitch-500
          group-hover:border-paper-300 dark:group-hover:border-paper-700
          group-hover:shadow-lg dark:group-hover:shadow-pitch-900/50
          transition duration-200
          ${isTodo && entry.completed ? 'opacity-60' : ''}
        `}
        style={{ borderLeft: `3px solid ${meta.css}` }}
      >
        {/* Entry header */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-paper-100 dark:border-pitch-500">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono font-medium text-paper-700 dark:text-paper-200">
              {format(date, 'dd MMM yyyy')}
            </span>
            <span className="text-xs font-mono text-paper-500 dark:text-paper-600">
              {format(date, 'HH:mm')}
            </span>
            {wasEdited && (
              <span className="text-xs font-mono text-paper-400 dark:text-paper-700">(edited)</span>
            )}
            {isTodo && entry.due_date && !entry.completed && (
              <span className={`text-xs font-mono ${getDueDateClass(entry.due_date)}`}>
                · due {format(parseISO(entry.due_date), 'dd MMM')}
              </span>
            )}
            {showsHeading && entry.title_source === 'ai' && (
              <Tooltip content="Written from the entry. Click the title to change it.">
                <span className="eyebrow text-paper-400 dark:text-paper-700">
                  suggested
                </span>
              </Tooltip>
            )}
          </div>
          {isCustom && (
            <span className="eyebrow ml-auto mr-2 flex-shrink-0 text-paper-400 dark:text-paper-700">
              Custom
            </span>
          )}
          {/* A reference card has no pin and no edit. It brings its own
              delete, which sits with the name it is about to remove. */}
          {!isReference && (
            <div className="flex items-center gap-1">
              {/* The pin stays visible at rest, unlike edit and delete. It has
                  to be findable without hunting, and once filled it is
                  reporting a state rather than offering an action. */}
              <PinControl
                entryId={entry.id}
                pinned={!!entry.pinned_at}
                onChange={onTogglePin}
              />
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-visible:opacity-100">
                {isTitled && !editing && !editingTitle && (isTodo || !showsHeading) && (
                  <button
                    onClick={openTitleEditor}
                    className="px-1.5 py-1 rounded text-2xs font-sans font-medium uppercase tracking-widest
                               text-paper-400 dark:text-paper-700
                               hover:text-paper-700 dark:hover:text-paper-200
                               hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors"
                  >
                    {isTodo ? 'Short form' : 'Add a title'}
                  </button>
                )}
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
          )}
        </div>

        {/* Content */}
        <div className="px-[18px] pt-[15px] pb-4">
          {/* The type in words, above the title. The rail says it in colour
              and shape; this says it for anyone reading rather than scanning. */}
          {!isReference && !editing && (
            <p
              className="eyebrow mb-[7px]"
              style={{ color: meta.css }}
            >
              {meta.label}
            </p>
          )}
          {/* Title. Editable in place, and only ever shown when someone or
              something actually named the entry. */}
          {isTitled && editingTitle && (
            <div className="mb-3">
              <TitleField
                autoFocus
                value={titleDraft}
                onChange={setTitleDraft}
                content={entry.content}
                entryType={entry.type}
                placeholder={isTodo ? 'Short form (optional)' : 'Title (optional)'}
                onEnter={commitTitle}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={closeTitleEditor}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
                >
                  <X size={12} /> Cancel
                </button>
                <button
                  onClick={commitTitle}
                  className="btn btn-sm btn-primary"
                >
                  <Check size={12} /> Save
                </button>
              </div>
            </div>
          )}
          {showsHeading && !editingTitle && (
            <>
              <h3
                onClick={openTitleEditor}
                title="Click to edit"
                className="text-[1.3125rem] font-bold leading-[1.25] tracking-[-0.03em] cursor-text
                           text-paper-900 dark:text-pitch-50 animate-fade-in"
                style={{ textWrap: 'pretty' }}
              >
                {entry.title}
              </h3>
              {/* The fourth separator, after size, weight and ink. */}
              <div className="my-[14px] border-t border-paper-200 dark:border-pitch-500" />
            </>
          )}

          {isReference ? (
            <ReferenceCard
              entry={entry}
              onDelete={onDelete}
              onSaveNotes={onSaveNotes}
            />
          ) : editing ? (
            <div>
              <MarkdownArea
                autoFocus
                value={draft}
                onChange={onDraftChange}
                rows={6}
                className="bg-paper-100 dark:bg-pitch-700 border-paper-300 dark:border-paper-700"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={onCancel} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors">
                  <X size={12} /> Cancel
                </button>
                <button onClick={onSave} className="btn btn-sm btn-primary">
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
                  <InlineMarkdown>{entry.content}</InlineMarkdown>
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
            <Markdown className="entry-prose">
              {entry.content}
            </Markdown>
          )}
          {/* Notes - collapsible context, on every entry type for consistency.
              A reference card carries its own, below its meta line. */}
          {!editing && !isReference && (
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
