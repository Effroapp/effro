import { entriesApi } from './client'
import { TITLED_TYPES, TODO_TITLE_FLOOR } from '../utils/entries'

/**
 * Title suggestions.
 *
 * A hint, never a gate. The entry is always saved first and always has a
 * fallback title, so every failure in here is survivable and silent. Nothing
 * the user does waits on any of it.
 */

// Below this an entry is already about as short as a title would be, so there
// is nothing worth shortening. Matches the server's own floor.
const MIN_CONTENT = 20

export async function suggestTitle(content, type = null) {
  const res = await fetch('/api/generate/title', {
    credentials: 'include',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
    } catch {
      // Keep the status line.
    }
    throw new Error(message)
  }
  return (await res.json()).title
}

/**
 * The post-save pass: ask for a title and apply it, or do nothing at all.
 *
 * Only ever replaces a fallback. The server enforces the same rule, so a race
 * with someone typing their own title cannot lose their wording. Returns the
 * updated entry, or null when there was nothing to do or anything went wrong.
 */
export async function suggestAndApplyTitle(entry) {
  if (!entry || entry.title_source !== 'fallback') return null
  if (!TITLED_TYPES.has(entry.type)) return null
  // A short to-do already fits, so shortening it would spend a call to make it
  // no better. Prose is worth naming from much less.
  const floor = entry.type === 'todo' ? TODO_TITLE_FLOOR : MIN_CONTENT
  if ((entry.content || '').trim().length < floor) return null

  try {
    const title = await suggestTitle(entry.content, entry.type)
    if (!title) return null
    return await entriesApi.update(entry.id, { title, title_source: 'ai' })
  } catch {
    // No engine, a refusal, a network blip. The fallback title stands.
    return null
  }
}

// ── Naming what is still on a fallback ───────────────────────────────────────

/** What a tidy-up would work through, so the user can be told before it runs. */
export async function titleBacklog() {
  const res = await fetch('/api/generate/title/backlog', { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Name one entry. Returns {id, title, changed}.
 *
 * The server re-checks eligibility, so a title written since the backlog was
 * read is never overwritten, and one at a time keeps progress honest: stopping
 * half way leaves everything already reached properly named.
 */
export async function suggestTitleForEntry(id) {
  const res = await fetch(`/api/entries/${id}/title/suggest`, {
    credentials: 'include',
    method: 'POST',
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
    } catch {
      // Keep the status line.
    }
    throw new Error(message)
  }
  return res.json()
}
