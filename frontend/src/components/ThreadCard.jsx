import { Link } from 'react-router-dom'
import { MessageSquare, Paperclip, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getThreadStatus } from '../utils/status'
import { BionicText } from '../utils/bionic.jsx'
import { parseUTC } from '../utils/time.js'
import { stripMarkdown } from '../utils/markdownEditing'

/**
 * Dense thread row for the Area page. Status is carried by the group header and
 * the coloured left border, so the row itself stays tight: title + an optional
 * one-line description, with counts and recency on the right.
 */
export default function ThreadCard({ thread, areaId }) {
  const config = getThreadStatus(thread.status)
  const relativeTime = formatDistanceToNow(parseUTC(thread.updated_at), { addSuffix: true })

  return (
    <Link
      to={`/thread/${thread.id}`}
      draggable={false}
      style={{ borderLeftColor: config.dot }}
      className="group block rounded-lg border border-l-[3px]
                 border-paper-300 dark:border-pitch-500
                 bg-white dark:bg-pitch-700
                 hover:border-paper-400 dark:hover:border-pitch-400
                 hover:bg-paper-50 dark:hover:bg-pitch-600/50
                 transition-colors"
    >
      <div className="px-3.5 py-2.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-semibold text-sm text-pitch-800 dark:text-white truncate
                         group-hover:text-paper-700 dark:group-hover:text-paper-200 transition-colors">
            <BionicText>{thread.title}</BionicText>
          </h3>
          {thread.description && (
            <p className="text-xs text-paper-600 dark:text-paper-500 line-clamp-1 leading-relaxed mt-0.5">
              {stripMarkdown(thread.description)}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-3 font-mono text-2xs text-paper-500 dark:text-paper-600">
          <span className={`hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded uppercase tracking-wide ${config.bgClass} ${config.textClass}`}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: config.dot }} />
            {config.label}
          </span>
          <span className="flex items-center gap-1"><MessageSquare size={11} />{thread.entry_count}</span>
          {thread.attachment_count > 0 && (
            <span className="flex items-center gap-1"><Paperclip size={11} />{thread.attachment_count}</span>
          )}
          <span className="text-paper-400 dark:text-paper-700">{relativeTime}</span>
          <ChevronRight size={14} className="text-paper-400 dark:text-paper-700 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  )
}
