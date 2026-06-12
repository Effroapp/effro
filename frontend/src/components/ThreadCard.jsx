import { Link } from 'react-router-dom'
import { MessageSquare, Paperclip, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import StatusBadge from './StatusBadge'
import { getThreadStatus } from '../utils/status'
import { BionicText } from '../utils/bionic.jsx'
import { parseUTC } from '../utils/time.js'

export default function ThreadCard({ thread, areaId }) {
  const config = getThreadStatus(thread.status)
  const relativeTime = formatDistanceToNow(parseUTC(thread.updated_at), { addSuffix: true })

  return (
    <Link
      to={`/thread/${thread.id}`}
      draggable={false}
      className="
        group block rounded-lg border transition-all duration-200
        bg-white dark:bg-pitch-700
        border-paper-300 dark:border-pitch-500
        hover:border-paper-400 dark:hover:border-paper-700
        hover:shadow-md dark:hover:shadow-pitch-800/50
        hover:-translate-y-px
      "
    >
      {/* Status accent line */}
      <div
        className="h-0.5 rounded-t-lg"
        style={{ backgroundColor: config.dot }}
      />

      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-display font-semibold text-sm text-pitch-800 dark:text-white group-hover:text-paper-700 dark:group-hover:text-paper-200 transition-colors leading-snug">
            <BionicText>{thread.title}</BionicText>
          </h3>
          <ChevronRight
            size={14}
            className="text-paper-400 dark:text-paper-700 flex-shrink-0 mt-0.5 group-hover:text-paper-700 group-hover:translate-x-0.5 transition-all"
          />
        </div>

        {/* Description */}
        {thread.description && (
          <p className="text-xs text-paper-600 dark:text-paper-500 line-clamp-2 mb-3 leading-relaxed">
            <BionicText>{thread.description}</BionicText>
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={thread.status} type="thread" size="xs" />

          <div className="flex items-center gap-3">
            {/* Entry count */}
            <span className="flex items-center gap-1 text-xs text-paper-500 dark:text-paper-600">
              <MessageSquare size={11} />
              <span className="font-mono">{thread.entry_count}</span>
            </span>

            {/* Attachment count */}
            {thread.attachment_count > 0 && (
              <span className="flex items-center gap-1 text-xs text-paper-500 dark:text-paper-600">
                <Paperclip size={11} />
                <span className="font-mono">{thread.attachment_count}</span>
              </span>
            )}

            {/* Last updated */}
            <span className="text-xs font-mono text-paper-400 dark:text-paper-700">
              {relativeTime}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
