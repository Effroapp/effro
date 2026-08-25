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
// A To Do is already one line and a Meeting is named by its own title field,
// so neither takes one. Everything else is prose that can run long enough to
// be worth naming, Blocked included.
export const TITLED_TYPES = new Set(['entry', 'decision', 'custom', 'blockage'])

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
