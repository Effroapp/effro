import { addDays, endOfWeek, addWeeks, endOfMonth, format } from 'date-fns'

// ─── Due date quick options ───────────────────────────────────────────────────

export const DUE_DATE_OPTIONS = [
  { label: 'Today',      resolve: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Tomorrow',   resolve: () => format(addDays(new Date(), 1), 'yyyy-MM-dd') },
  { label: 'This week',  resolve: () => format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') },
  { label: 'Next week',  resolve: () => format(endOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 }), 'yyyy-MM-dd') },
  { label: 'This month', resolve: () => format(endOfMonth(new Date()), 'yyyy-MM-dd') },
  { label: 'Pick date',  resolve: () => null },
]

// ─── Area statuses (Effro v2 palette - muted, ADHD-friendly) ─────────────────
//
// Hex values match the design tokens defined in tokens.css. Tailwind classes
// reference the new colour namespaces in tailwind.config.js. Both must stay
// in sync if values are ever changed.

export const AREA_STATUSES = {
  stable: {
    label: 'Stable',
    dot: 'var(--sage)',         // sage
    textClass: 'text-sage dark:text-sage',
    bgClass: 'bg-sage/10 dark:bg-sage/15',
    borderClass: 'border-sage/30 dark:border-sage/40',
    ringClass: 'ring-sage',
  },
  active: {
    label: 'Active',
    dot: 'var(--sky-muted)',         // sky-muted
    textClass: 'text-sky-muted dark:text-sky-muted',
    bgClass: 'bg-sky-muted/10 dark:bg-sky-muted/15',
    borderClass: 'border-sky-muted/30 dark:border-sky-muted/40',
    ringClass: 'ring-sky-muted',
  },
  review: {
    label: 'On Hold',
    dot: 'var(--amber-muted)',         // amber-muted
    textClass: 'text-amber-muted dark:text-amber-muted',
    bgClass: 'bg-amber-muted/10 dark:bg-amber-muted/15',
    borderClass: 'border-amber-muted/30 dark:border-amber-muted/40',
    ringClass: 'ring-amber-muted',
  },
  blocked: {
    label: 'Blocked',
    dot: 'var(--terracotta)',         // terracotta
    textClass: 'text-terracotta dark:text-terracotta',
    bgClass: 'bg-terracotta/10 dark:bg-terracotta/15',
    borderClass: 'border-terracotta/30 dark:border-terracotta/40',
    ringClass: 'ring-terracotta',
  },
}

// ─── Thread statuses ──────────────────────────────────────────────────────────

export const THREAD_STATUSES = {
  open: {
    label: 'Open',
    dot: 'var(--sky-muted)',         // sky-muted
    textClass: 'text-sky-muted dark:text-sky-muted',
    bgClass: 'bg-sky-muted/10 dark:bg-sky-muted/15',
    borderClass: 'border-sky-muted/30 dark:border-sky-muted/40',
  },
  'in-progress': {
    label: 'In Progress',
    dot: 'var(--mustard)',         // mustard
    textClass: 'text-mustard dark:text-mustard',
    bgClass: 'bg-mustard/10 dark:bg-mustard/15',
    borderClass: 'border-mustard/30 dark:border-mustard/40',
  },
  resolved: {
    label: 'Resolved',
    dot: 'var(--sage)',         // sage
    textClass: 'text-sage dark:text-sage',
    bgClass: 'bg-sage/10 dark:bg-sage/15',
    borderClass: 'border-sage/30 dark:border-sage/40',
  },
  parked: {
    label: 'Parked',
    dot: 'var(--lavender)',         // lavender
    textClass: 'text-lavender dark:text-lavender',
    bgClass: 'bg-lavender/10 dark:bg-lavender/15',
    borderClass: 'border-lavender/30 dark:border-lavender/40',
  },
  blocked: {
    label: 'Blocked',
    dot: 'var(--terracotta)',         // terracotta
    textClass: 'text-terracotta dark:text-terracotta',
    bgClass: 'bg-terracotta/10 dark:bg-terracotta/15',
    borderClass: 'border-terracotta/30 dark:border-terracotta/40',
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getAreaStatus(key) {
  return AREA_STATUSES[key] ?? AREA_STATUSES.stable
}

export function getThreadStatus(key) {
  return THREAD_STATUSES[key] ?? THREAD_STATUSES.open
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Due-date urgency colour. Shared by the entry card and the open-task rows, so
// a task reads the same wherever it is shown.
export function getDueDateClass(dueDateStr) {
  const today = format(new Date(), 'yyyy-MM-dd')
  if (dueDateStr === today) return 'text-mustard font-semibold'
  if (dueDateStr < today)  return 'text-terracotta font-semibold'
  return 'text-paper-500 dark:text-paper-600'
}
