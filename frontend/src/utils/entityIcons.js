import { PenLine, CheckSquare, Scale, Calendar, MessageSquare, Eye, Activity, Paperclip, Link2, Ban } from 'lucide-react'

/**
 * Single source of truth for the icon + label + colour token used for each
 * domain concept. Used across composers, badges, list rows, page headers
 * and the Universal Suggest pipeline so the same idea always reads the
 * same way.
 *
 * Tint classes assume Effro's accent palette + the muted status colours
 * declared in tailwind.config.js.
 */
export const ENTITY = {
  entry: {
    // Stored type value stays "entry"; the human-facing label is "Update"
    // (a log update). Only this label changes - no data migration.
    label: 'Update',
    Icon: PenLine,
    tint: 'text-paper-700 dark:text-paper-200',
    badge: 'bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200',
    borderLeft: 'border-l-mint-500',
  },
  todo: {
    label: 'To Do',
    Icon: CheckSquare,
    tint: 'text-sky-muted dark:text-sky-muted',
    badge: 'bg-sky-muted/10 text-sky-muted dark:text-sky-muted',
    borderLeft: 'border-l-sky-muted',
  },
  decision: {
    label: 'Decision',
    Icon: Scale,
    tint: 'text-amber-muted dark:text-amber-muted',
    badge: 'bg-amber-muted/10 text-amber-muted dark:text-amber-muted',
    borderLeft: 'border-l-amber-muted',
  },
  meeting: {
    label: 'Meeting',
    Icon: Calendar,
    tint: 'text-lavender dark:text-lavender',
    badge: 'bg-lavender/10 text-lavender dark:text-lavender',
    borderLeft: 'border-l-lavender',
  },
  blockage: {
    label: 'Blocked',
    Icon: Ban,
    tint: 'text-terracotta dark:text-terracotta',
    badge: 'bg-terracotta/10 text-terracotta dark:text-terracotta',
    borderLeft: 'border-l-terracotta',
  },
}

export const ENTITY_TYPES = Object.entries(ENTITY).map(([key, v]) => ({
  key,
  label: v.label,
  Icon: v.Icon,
}))

export function entityFor(type) {
  return ENTITY[type] ?? ENTITY.entry
}

// Structural concepts (sections, lists, page headers) - not entry types.
export const SECTION_ICONS = {
  thread:     MessageSquare,
  overview:   Eye,
  openTasks:  CheckSquare,
  timeline:   Activity,
  files:      Paperclip,
  links:      Link2,
}
