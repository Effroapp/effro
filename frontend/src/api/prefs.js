/**
 * Prefs API - durable, per-user key/value state.
 *
 * Kept out of client.js on purpose. A 401 here is expected and harmless (it
 * just means nobody is signed in yet on a hosted deployment), so this module
 * must NOT raise the global "effro:unauthorized" event the shared helper does,
 * or loading the login page would bounce the app around.
 *
 * Every call sends the session cookie so the same code serves the desktop build
 * (auth off, synthetic local user) and a hosted one (auth on, real sessions).
 */

const BASE = '/api/prefs'

/** Every pref held for the current user, as one dict. */
export async function getPrefs() {
  const res = await fetch(BASE, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Merge a partial dict of prefs. A key sent as null is deleted. Resolves to
 *  the full set afterwards. */
export async function putPrefs(patch) {
  const res = await fetch(BASE, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
