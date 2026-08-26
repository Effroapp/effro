import { getAreaStatus, getThreadStatus } from '../utils/status'

/**
 * Renders a small coloured pill badge.
 * @param {string} status  - status key
 * @param {'area'|'thread'} type - which status map to use
 * @param {'sm'|'xs'} size
 */
export default function StatusBadge({ status, type = 'area', size = 'sm' }) {
  const config =
    type === 'thread' ? getThreadStatus(status) : getAreaStatus(status)

  const sizeClasses =
    size === 'xs'
      ? 'text-xs px-1.5 py-0.5 gap-1'
      : 'text-xs px-2 py-1 gap-1.5'

  return (
    <span
      className={`inline-flex items-center font-sans font-medium rounded uppercase tracking-wide
        ${sizeClasses}
        ${config.textClass}
        ${config.bgClass}
        border ${config.borderClass}
      `}
    >
      {/* Status dot */}
      <span
        className="rounded-full flex-shrink-0"
        style={{
          width: size === 'xs' ? 5 : 6,
          height: size === 'xs' ? 5 : 6,
          backgroundColor: config.dot,
          boxShadow: `0 0 4px ${config.dot}`,
        }}
      />
      {config.label}
    </span>
  )
}
