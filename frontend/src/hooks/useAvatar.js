import { useCallback } from 'react'
import { usePref } from './usePrefs'

/**
 * Profile photo for the top-right avatar, held as a base64 data URL.
 *
 * Stored as a durable user pref rather than plain localStorage, because the
 * desktop shell clears the webview's browsing data on every version update and
 * the photo would otherwise vanish each time the app updated. Clearing the
 * value falls back to the initials-rendered avatar.
 */
export function useAvatar() {
  const [avatar, setAvatarPref] = usePref('profile.avatar', '')

  const setAvatar = useCallback((next) => {
    setAvatarPref(next ? next : null)
  }, [setAvatarPref])

  return { avatar: avatar || '', setAvatar }
}
