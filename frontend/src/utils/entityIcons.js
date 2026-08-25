import * as LucideIcons from 'lucide-react'
import { PenLine, CheckSquare, Scale, Calendar, MessageSquare, Eye, Activity,
         Paperclip, Link2, Ban, Tag, SquareCheckBig, CircleSlash, Library,
         CircleDot } from 'lucide-react'

/**
 * Single source of truth for the icon + label + colour token used for each
 * domain concept. Used across composers, badges, list rows, page headers
 * and the Universal Suggest pipeline so the same idea always reads the
 * same way.
 *
 * Tint classes assume Effro's accent palette + the muted status colours
 * declared in tailwind.config.js.
 *
 * `css` is the same colour as a CSS variable, for the places that have to
 * colour-mix it rather than name a class: the timeline rail medallion and the
 * card's left edge. Every type has one, so those never special-case.
 *
 * Mint is absent by design. It is the brand, focus and selected colour, and a
 * status use would make every one of those read as a state.
 */
export const ENTITY = {
  entry: {
    // Stored type value stays "entry"; the human-facing label is "Update"
    // (a log update). Only this label changes - no data migration.
    label: 'Update',
    Icon: PenLine,
    css: 'var(--sage)',
    dot: 'bg-sage',
    tint: 'text-sage dark:text-sage',
    badge: 'bg-sage/10 text-sage dark:text-sage',
    borderLeft: 'border-l-sage',
  },
  todo: {
    label: 'To Do',
    Icon: SquareCheckBig,
    css: 'var(--sky-muted)',
    dot: 'bg-sky-muted',
    tint: 'text-sky-muted dark:text-sky-muted',
    badge: 'bg-sky-muted/10 text-sky-muted dark:text-sky-muted',
    borderLeft: 'border-l-sky-muted',
  },
  decision: {
    label: 'Decision',
    Icon: Scale,
    css: 'var(--amber-muted)',
    dot: 'bg-amber-muted',
    tint: 'text-amber-muted dark:text-amber-muted',
    badge: 'bg-amber-muted/10 text-amber-muted dark:text-amber-muted',
    borderLeft: 'border-l-amber-muted',
  },
  meeting: {
    label: 'Meeting',
    Icon: Calendar,
    css: 'var(--lavender)',
    dot: 'bg-lavender',
    tint: 'text-lavender dark:text-lavender',
    badge: 'bg-lavender/10 text-lavender dark:text-lavender',
    borderLeft: 'border-l-lavender',
  },
  blockage: {
    label: 'Blocked',
    Icon: CircleSlash,
    css: 'var(--terracotta)',
    dot: 'bg-terracotta',
    tint: 'text-terracotta dark:text-terracotta',
    badge: 'bg-terracotta/10 text-terracotta dark:text-terracotta',
    borderLeft: 'border-l-terracotta',
  },
}

// The neutral fallback for a custom entry with no type attached. Only reachable
// through a direct database edit, since deleting a type converts its entries
// back to Updates first, but the card still has to render something.
// A reference card points at something rather than saying something, so it
// stays neutral in the timeline. It takes no place in the composer, which is
// why it lives here rather than in ENTITY_TYPES.
ENTITY.reference = {
  label: 'Reference',
  Icon: Paperclip,
  // Neutral stone. A reference points at something rather than saying
  // something, so it takes no status hue and reads as its kind icon.
  css: 'var(--ink-muted)',
  dot: 'bg-paper-400 dark:bg-pitch-400',
  tint: 'text-paper-600 dark:text-paper-500',
  badge: 'bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200',
  borderLeft: 'border-l-paper-300',
}

ENTITY.custom = {
  label: 'Custom',
  Icon: Tag,
  css: 'var(--ink-muted)',
  dot: 'bg-paper-400 dark:bg-paper-700',
  tint: 'text-paper-700 dark:text-paper-200',
  badge: 'bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-200',
  borderLeft: 'border-l-paper-400',
}

/**
 * Colours a user-defined type may take.
 *
 * Deliberately none of the built-in type colours. Mint, sky, amber, lavender
 * and terracotta already mean Update, To Do, Decision, Meeting and Blocked, so
 * letting someone paint their own type in one of those would make it read as a
 * built-in at a glance. This is a second muted family in the same register.
 *
 * Every class is written out in full and never assembled from a template,
 * because Tailwind only generates what it can see as a literal string in the
 * source. A `bg-${colour}` would compile and then render nothing.
 */
export const CUSTOM_PALETTE = {
  sage: {
    css: 'var(--sage)',
    dot: 'bg-sage',
    tint: 'text-sage dark:text-sage',
    badge: 'bg-sage/10 text-sage dark:text-sage',
    borderLeft: 'border-l-sage',
  },
  seafoam: {
    css: 'var(--seafoam)',
    dot: 'bg-seafoam',
    tint: 'text-seafoam dark:text-seafoam',
    badge: 'bg-seafoam/10 text-seafoam dark:text-seafoam',
    borderLeft: 'border-l-seafoam',
  },
  dusk: {
    css: 'var(--dusk)',
    dot: 'bg-dusk',
    tint: 'text-dusk dark:text-dusk',
    badge: 'bg-dusk/10 text-dusk dark:text-dusk',
    borderLeft: 'border-l-dusk',
  },
  plum: {
    css: 'var(--plum)',
    dot: 'bg-plum',
    tint: 'text-plum dark:text-plum',
    badge: 'bg-plum/10 text-plum dark:text-plum',
    borderLeft: 'border-l-plum',
  },
  heather: {
    css: 'var(--heather)',
    dot: 'bg-heather',
    tint: 'text-heather dark:text-heather',
    badge: 'bg-heather/10 text-heather dark:text-heather',
    borderLeft: 'border-l-heather',
  },
  pebble: {
    css: 'var(--pebble)',
    dot: 'bg-pebble',
    tint: 'text-pebble dark:text-pebble',
    badge: 'bg-pebble/10 text-pebble dark:text-pebble',
    borderLeft: 'border-l-pebble',
  },
}

// The colour picker in the type popover. Order is the order shown.
export const CUSTOM_COLOURS = [
  { key: 'sage',    label: 'Sage' },
  { key: 'seafoam', label: 'Seafoam' },
  { key: 'dusk',    label: 'Dusk' },
  { key: 'plum',    label: 'Plum' },
  { key: 'heather', label: 'Heather' },
  { key: 'pebble',  label: 'Pebble' },
]

// Built-in types only. Custom ones are appended by the composer from the
// user's own list, so this stays the fixed part of the picker.
export const ENTITY_TYPES = Object.entries(ENTITY)
  .filter(([key]) => !['custom', 'reference'].includes(key))
  .map(([key, v]) => ({
  key,
  label: v.label,
  Icon: v.Icon,
}))

export function entityFor(type) {
  return ENTITY[type] ?? ENTITY.entry
}

/**
 * The look for an entry, following its custom type when it has one.
 *
 * Prefer this over `entityFor` wherever the entry object is to hand, since a
 * bare type string cannot tell a Risk from a Question. `entityFor` stays for
 * the places that only know the type, such as the Generate extraction preview.
 */
// A reference reads as the thing it points at, so its icon follows the kind
// rather than the type. Neutral ground throughout.
export const REFERENCE_LABELS = {
  file: 'File',
  link: 'Link',
  thread: 'Linked thread',
  folio: 'Folio',
}

export const REFERENCE_ICONS = {
  file: Paperclip,
  link: Link2,
  thread: MessageSquare,
  folio: Library,
}

export function entityForEntry(entry) {
  if (!entry) return ENTITY.entry
  if (entry.type === 'reference') {
    return {
      ...ENTITY.reference,
      label: entry.reference?.link_kind === 'blocks' ? 'Blocks' : REFERENCE_LABELS[entry.ref_kind] || 'Reference',
      Icon: REFERENCE_ICONS[entry.ref_kind] || Paperclip,
    }
  }
  if (entry.type !== 'custom') return entityFor(entry.type)
  const custom = entry.custom_type
  if (!custom) return ENTITY.custom
  return {
    label: custom.name,
    // The icon is the identity. Colour narrows a type down to one of six, the
    // icon tells two of them apart at a glance on the rail.
    Icon: iconByName(custom.icon) || Tag,
    ...(CUSTOM_PALETTE[custom.colour] ?? CUSTOM_PALETTE.sage),
  }
}

/**
 * A Lucide component by its kebab-case name, or null.
 *
 * Custom types store the name rather than the component, so this is the one
 * place that turns 'circle-dot' into CircleDot. Lucide's own PascalCase export
 * map is the lookup, so no separate table can drift from it.
 */
export function iconByName(name) {
  if (!name) return null
  const pascal = String(name)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return LucideIcons[pascal] || null
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
