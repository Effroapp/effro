import { stripMarkdown } from './markdownEditing'

/**
 * The one-line label for an entry.
 *
 * Prefers the stored title, and falls back to the entry's own first line for
 * anything written before titles existed or saved a beat before the server's
 * fallback lands. The derivation matches `fallback_title` in
 * `backend/entry_text.py`, so the two sides agree.
 *
 * For one-line contexts only: lists, search results, activity rows, the In
 * Hand strip. It is not a heading, and it is never used to invent one on a To
 * Do or Meeting card, which carry no title by design.
 */
const TITLE_CUT = 60

// The types that carry a title. Mirrors TITLED_TYPES in backend/entry_text.py.
// A Meeting is named by its own title field and a reference takes its name from
// the thing it points at. Everything else gets one.
export const TITLED_TYPES = new Set(['entry', 'decision', 'custom', 'blockage', 'todo'])

// The types whose title the composer offers a field for, which is now every
// type that carries one. A To Do's short form is still generated after the
// save when the field is left blank, so nobody has to write one, but someone
// who already knows the short version can say so rather than waiting for a
// model to guess it.
export const AUTHORED_TITLE_TYPES = TITLED_TYPES

// A to-do shorter than this already fits wherever it is listed, so there is
// nothing to shorten. Matches TODO_TITLE_FLOOR on the server.
export const TODO_TITLE_FLOOR = 60

export function displayTitle(entry) {
  if (!entry) return ''
  const stored = (entry.title || '').trim()
  if (stored) return stored

  const plain = stripMarkdown(entry.content || '') || ''
  for (const line of plain.split('\n')) {
    const collapsed = line.split(/\s+/).filter(Boolean).join(' ')
    if (!collapsed) continue
    if (collapsed.length <= TITLE_CUT) return collapsed
    const cut = collapsed.slice(0, TITLE_CUT)
    return cut.slice(0, cut.lastIndexOf(' ')) || cut
  }
  return 'Untitled'
}
