import { useState } from 'react'
import { Ban, Calendar, Check, Edit3, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'

import Markdown, { InlineMarkdown } from '../Markdown'
import MarkdownArea from '../MarkdownArea'
import PinControl from '../PinControl'
import SubtaskList from '../SubtaskList'
import { entityForEntry } from '../../utils/entityIcons'
import { getDueDateClass } from '../../utils/status'
import EntryNotes from './EntryNotes'
import MeetingBody from './MeetingBody'
import TaskCheckbox from './TaskCheckbox'

// ─── Entry block ──────────────────────────────────────────────────────────────

export default function EntryBlock({ entry, highlighted, editing, draft, onEditStart, onDraftChange, onSave, onCancel, onDelete, onToggleComplete, onTogglePin, onSaveNotes, onSaveMeeting, onBreakDown, onSubtasksChange }) {
  const date = new Date(entry.created_at)
  const wasEdited = entry.updated_at !== entry.created_at
  const isDecision = entry.type === 'decision'
  const isTodo = entry.type === 'todo'
  const isMeeting = entry.type === 'meeting'
  const isBlockage = entry.type === 'blockage'
  const isCustom = entry.type === 'custom'
  // A custom entry behaves exactly like an Update. Only its dot, accent bar,
  // badge and icon come from the user's own type.
  const meta = entityForEntry(entry)
  const MetaIcon = meta.Icon

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
        ${meta.dot}
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
        {isCustom && (
          <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${meta.dot}`} />
        )}

        {/* Entry header */}
        <div className={`flex items-center justify-between px-4 py-2.5 border-b border-paper-100 dark:border-pitch-500 ${isBlockage ? 'bg-terracotta/5 dark:bg-terracotta/10' : 'bg-paper-100/50 dark:bg-pitch-800/30'} ${(isDecision || isMeeting || isBlockage || isCustom) ? 'pl-5' : ''}`}>
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
            {isCustom && (
              <span className={`font-display uppercase text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${meta.badge}`}>
                <MetaIcon size={10} /> {meta.label}
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
          <div className="flex items-center gap-1">
            {/* The pin stays visible at rest, unlike edit and delete. It has to
                be findable without hunting, and once filled it is reporting a
                state rather than offering an action. */}
            <PinControl
              entryId={entry.id}
              pinned={!!entry.pinned_at}
              onChange={onTogglePin}
            />
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
        </div>

        {/* Content */}
        <div className={`px-4 py-3 ${(isDecision || isMeeting || isCustom) ? 'pl-5' : ''}`}>
          {editing ? (
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
            <Markdown className="text-pitch-500 dark:text-paper-300">{entry.content}</Markdown>
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
