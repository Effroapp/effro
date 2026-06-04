import { Zap, Bookmark, Check, GitBranch, Bug } from 'lucide-react'

/**
 * Jira-native issue-type indicator.
 *
 * Mirrors the small coloured tile + white glyph Jira shows beside every issue,
 * so Epic / Story / Task / Sub-task / Bug are identifiable at a glance with the
 * exact same visual language a Jira user already knows.
 *
 *   Epic     purple  lightning
 *   Story    green   bookmark
 *   Task     blue    check
 *   Sub-task blue    branch (child of a task)
 *   Bug      red     bug
 *
 * `kind` is our normalised vocabulary from jira_client.issue_to_signal_fields:
 * 'epic' | 'story' | 'task' | 'subtask' | 'bug'.
 */
const JIRA_TYPES = {
  epic:    { label: 'Epic',     bg: '#904EE2', Icon: Zap },
  story:   { label: 'Story',    bg: '#65BA43', Icon: Bookmark },
  task:    { label: 'Task',     bg: '#4BADE8', Icon: Check },
  subtask: { label: 'Sub-task', bg: '#4BADE8', Icon: GitBranch },
  bug:     { label: 'Bug',      bg: '#E5493A', Icon: Bug },
}

export default function JiraIssueType({ kind, showLabel = true, size = 15 }) {
  const t = JIRA_TYPES[kind] || JIRA_TYPES.task
  const { Icon } = t
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" title={`Jira ${t.label}`}>
      <span
        className="inline-flex items-center justify-center rounded-[3px] flex-shrink-0"
        style={{ backgroundColor: t.bg, width: size, height: size }}
      >
        <Icon size={Math.round(size * 0.66)} color="#ffffff" strokeWidth={3} />
      </span>
      {showLabel && (
        <span className="text-[11px] font-medium text-pitch-700 dark:text-paper-300">
          {t.label}
        </span>
      )}
    </span>
  )
}
