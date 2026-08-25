/**
 * The one to-do checkbox. Used by the thread timeline, the open-task rows and
 * the In Hand strip, so ticking a task looks and feels the same everywhere.
 *
 * `size` drives the box, its radius and its border weight together: the 24px
 * default is the thread's, and the strip asks for 18px, where a 2px border
 * would read as heavy.
 */
export default function TaskCheckbox({ completed, onToggle, size = 24, label = 'Complete' }) {
  const small = size < 22

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={completed}
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: small ? 5 : 6,
        borderWidth: small ? 1 : 2,
      }}
      className={`
        border flex items-center justify-center flex-shrink-0
        transition-all duration-150
        ${completed
          ? 'bg-mint-700 border-mint-700'
          : 'border-paper-400 dark:border-paper-700 bg-transparent hover:border-mint-500'
        }
      `}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} fill="none">
        <path
          d="M4 12l5 5 11-11"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="24"
          strokeDashoffset={completed ? 0 : 24}
          style={{ transition: 'stroke-dashoffset 200ms ease 150ms' }}
        />
      </svg>
    </button>
  )
}
