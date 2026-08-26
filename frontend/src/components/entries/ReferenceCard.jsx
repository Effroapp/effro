import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Library, Link2, Paperclip, Trash2 } from 'lucide-react'

import { openExternal } from '../../api/tauri'
import { useAuth } from '../../contexts/AuthContext'
import { formatBytes } from '../../utils/status'
import { SECTION_ICONS } from '../../utils/entityIcons'
import ConfirmDialog from '../ConfirmDialog'
import EntryNotes from './EntryNotes'

/**
 * A file, link, linked thread or folio, as a card in the thread's timeline.
 *
 * The card and the thing it points at share one life, so Delete is the only
 * action: there is nothing here to edit, since the name, the type and the date
 * all belong to the object. Notes are the exception, which is why they are
 * here and everything else is not.
 *
 * The name is read live rather than from the entry, so renaming a thread or a
 * file shows through on the card. When the object has gone the card keeps the
 * snapshot name it was created with and says so quietly.
 */
const KIND = {
  file:   { Icon: Paperclip, label: 'File' },
  link:   { Icon: Link2, label: 'Link' },
  thread: { Icon: SECTION_ICONS.thread, label: 'Linked thread' },
  folio:  { Icon: Library, label: 'Folio' },
}

const DELETE_COPY = {
  file:   { title: 'Remove file', message: 'Remove this file? The file and this card both go.' },
  link:   { title: 'Remove link', message: 'Remove this link? The link and this card both go.' },
  thread: { title: 'Unlink thread', message: 'Unlink this thread? The link and this card both go. The other thread is untouched.' },
  folio:  { title: 'Remove from thread', message: 'Remove this Folio from the thread? The Folio itself is kept.' },
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export default function ReferenceCard({ entry, onDelete, onSaveNotes }) {
  const { user } = useAuth()
  const [confirming, setConfirming] = useState(false)

  const kind = entry.ref_kind || 'file'
  const ref = entry.reference
  const meta = KIND[kind] || KIND.file
  const KindIcon = meta.Icon

  // A thread link says what sort of link it is, since blocking is worth
  // knowing at a glance.
  const label = kind === 'thread' && ref?.link_kind === 'blocks' ? 'Blocks' : meta.label
  const name = ref?.name || entry.content
  const copy = DELETE_COPY[kind] || DELETE_COPY.file

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <KindIcon size={12} className="flex-shrink-0 text-paper-500 dark:text-paper-600" />
        <span className="eyebrow text-paper-500 dark:text-paper-600">
          {label}
        </span>
      </div>

      {ref ? (
        <NameLink kind={kind} reference={ref} folioEnabled={!!user?.folio_enabled}>
          {name}
        </NameLink>
      ) : (
        <p className="text-sm font-medium text-paper-500 dark:text-paper-600">{name}</p>
      )}

      <p className="mt-0.5 font-mono text-xs text-paper-400 dark:text-paper-700">
        {ref ? metaLine(kind, ref) : 'This is no longer on the thread.'}
      </p>

      <EntryNotes initial={entry.notes || ''} onSave={onSaveNotes} />

      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={onDelete}
        title={copy.title}
        message={copy.message}
      />

      {/* Delete lives in the card's own hover actions rather than the shared
          header, since a reference has no edit and no pin. */}
      <button
        onClick={() => setConfirming(true)}
        aria-label={copy.title}
        className="absolute top-2.5 right-3 p-1 rounded opacity-0 group-hover:opacity-100
                   text-paper-400 dark:text-paper-700
                   hover:text-terracotta hover:bg-terracotta/10 transition focus-visible:opacity-100"
      >
        <Trash2 size={12} />
      </button>
    </>
  )
}

function metaLine(kind, ref) {
  if (kind === 'file') return ref.size ? formatBytes(ref.size) : 'File'
  if (kind === 'link') return hostOf(ref.url || '') || 'Link'
  if (kind === 'thread') return ref.area_name || 'Thread'
  const n = ref.capture_count ?? 0
  return n === 1 ? '1 capture' : `${n} captures`
}

function NameLink({ kind, reference, folioEnabled, children }) {
  const style = 'text-sm font-medium text-pitch-800 dark:text-white hover:text-mint-700 dark:hover:text-mint-300 transition-colors'

  if (kind === 'thread') {
    return <RouterLink to={`/thread/${reference.thread_id}`} className={style}>{children}</RouterLink>
  }
  if (kind === 'folio') {
    // With Folio switched off the card still reads, it just does not lead
    // anywhere there is nothing to reach.
    if (!folioEnabled) return <p className="text-sm font-medium text-pitch-800 dark:text-white">{children}</p>
    return <RouterLink to={`/folios/${reference.folio_id}`} className={style}>{children}</RouterLink>
  }
  if (kind === 'link') {
    return (
      <button
        onClick={() => openExternal(reference.url)}
        className={`${style} text-left`}
      >
        {children}
      </button>
    )
  }
  // A file opens the way the Files panel opens it.
  return (
    <a
      href={`/uploads/${reference.stored_name}`}
      target="_blank"
      rel="noopener noreferrer"
      className={style}
    >
      {children}
    </a>
  )
}
