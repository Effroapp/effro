import { useCallback } from 'react'
import { usePref } from './usePrefs'

/**
 * User's display name - used for the settings avatar's initials and as the
 * identity surface in the sidebar.
 *
 * Stored as a durable user pref rather than plain localStorage, because the
 * desktop shell clears the webview's browsing data on every version update and
 * the app would otherwise forget the user's name each time it updated. See
 * hooks/usePrefs.js for how the cache and the backend relate.
 */
export function useDisplayName() {
  const [displayName, setDisplayNamePref] = usePref('profile.display_name', '')

  // An empty name clears the pref rather than storing an empty string, so the
  // avatar falls cleanly back to its placeholder.
  const setDisplayName = useCallback((next) => {
    setDisplayNamePref(next ? next : null)
  }, [setDisplayNamePref])

  return { displayName: displayName || '', setDisplayName }
}

/**
 * Derive up-to-two-letter initials from a display name.
 * "Luke Keogh" → "LK" ; "luke" → "L" ; "" → "?"
 */
export function getInitials(name) {
  const cleaned = (name || '').trim()
  if (!cleaned) return '?'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}
