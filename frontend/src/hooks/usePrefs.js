import { useCallback, useSyncExternalStore } from 'react'
import { getPrefs, putPrefs } from '../api/prefs'

/**
 * Durable user preferences, cached in localStorage and owned by the backend.
 *
 * Why: the desktop shell clears all webview browsing data on every version
 * update as a deliberate cache bust, which takes localStorage with it. Anything
 * that has to survive an update (onboarding completion, display name, avatar,
 * intro-panel dismissals) therefore lives in the user_prefs table.
 *
 * The shape of it:
 *   - localStorage is a read-through CACHE, so a returning user sees their name
 *     and photo on the very first frame with no network wait.
 *   - The backend is the SOURCE OF TRUTH. On boot we GET once and reconcile,
 *     with the backend winning, then refresh the cache.
 *   - Writes update the cache immediately and PUT in the background. A failed
 *     PUT retries once and is then logged quietly. Prefs are never worth a toast.
 *
 * The cache is stamped with the user id it belongs to, so signing in as someone
 * else on a hosted deployment cannot show the previous person's name or photo.
 *
 * This is a module-level store rather than a React context because the readers
 * sit at opposite ends of the tree (App root, Shell, every page's IntroPanel)
 * and all of them need to share one hydration.
 */

const CACHE_KEY = 'effro.prefs'

/* ─── Store state ─────────────────────────────────────────────────────────── */

let values = {}            // key -> value
let cachedUserId = null    // who the cached values belong to
let currentUserId = null   // who is signed in right now
let status = 'idle'        // idle | hydrating | ready | failed

// Keys written locally since hydration began. They win over the backend's copy
// in the reconcile, so a fast typist cannot have their edit undone by an
// in-flight GET.
let locallyWritten = new Set()

let hydration = null       // in-flight hydrate promise, so we only run one
let snapshot = { values, status }
const listeners = new Set()

function notify() {
  snapshot = { values, status }
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return snapshot
}

/* ─── Cache ───────────────────────────────────────────────────────────────── */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.values !== 'object') return null
    return { userId: parsed.userId ?? null, values: parsed.values || {} }
  } catch {
    return null
  }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: cachedUserId, values }))
  } catch {
    // Quota or a locked-down webview. The backend still has the truth, so this
    // only costs the instant-boot shortcut.
  }
}

// Seed from the cache at module load so the first paint already has the user's
// name and photo. If hydration later reveals a different user, this is dropped.
const seed = readCache()
if (seed) {
  values = seed.values
  cachedUserId = seed.userId
  snapshot = { values, status }
}

/* ─── Legacy localStorage migration (one time) ────────────────────────────── */

const LEGACY_ONBOARDING = 'effro_onboarding_v1'
const LEGACY_DISPLAY_NAME = 'displayName'
const LEGACY_AVATAR = 'displayAvatar'

/** True for a key an IntroPanel used to write its "dismissed for good" flag to.
 *  Some are fixed names and some are built per tab or per lens, so this matches
 *  the shapes rather than a fixed list. */
function isLegacyIntroKey(key) {
  return (
    key === 'folioIntroDismissed' ||
    key.startsWith('effro.introPanel.') ||
    key.startsWith('effro.lensIntro.') ||
    (key.startsWith('effro.') && key.endsWith('IntroSeen'))
  )
}

/**
 * Collect anything worth rescuing from the pre-prefs localStorage layout.
 * Returns { patch, legacyKeys } where legacyKeys are the old keys to clear once
 * the rescue has actually landed on the backend.
 */
function collectLegacy() {
  const patch = {}
  const legacyKeys = []
  try {
    const onboarding = localStorage.getItem(LEGACY_ONBOARDING)
    if (onboarding) {
      legacyKeys.push(LEGACY_ONBOARDING)
      let completed = false
      try { completed = !!JSON.parse(onboarding)?.completed } catch { completed = false }
      // Anyone who has already finished the wizard must never see it again
      // because of this change.
      if (completed) patch['onboarding.completed_version'] = 'v1'
    }

    const name = localStorage.getItem(LEGACY_DISPLAY_NAME)
    if (name) {
      legacyKeys.push(LEGACY_DISPLAY_NAME)
      patch['profile.display_name'] = name
    }

    const avatar = localStorage.getItem(LEGACY_AVATAR)
    if (avatar) {
      legacyKeys.push(LEGACY_AVATAR)
      patch['profile.avatar'] = avatar
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && isLegacyIntroKey(key)) {
        legacyKeys.push(key)
        patch[`intro.${key}`] = true
      }
    }
  } catch {
    // No localStorage at all. Nothing to migrate.
  }
  return { patch, legacyKeys }
}

function clearLegacy(legacyKeys) {
  try {
    legacyKeys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // ignore
  }
}

/* ─── Background writes ───────────────────────────────────────────────────── */

let pending = null
let flushTimer = null

const FLUSH_DELAY_MS = 250
const RETRY_DELAY_MS = 2000

function queuePut(patch) {
  pending = { ...(pending || {}), ...patch }
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
}

async function flush() {
  flushTimer = null
  if (!pending || currentUserId == null) return
  const batch = pending
  pending = null
  try {
    await putPrefs(batch)
  } catch {
    try {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      await putPrefs(batch)
    } catch (err) {
      // Quiet by design. A pref that did not save is a small annoyance next
      // launch, never something to interrupt the user with.
      console.warn('Prefs could not be saved.', err)
    }
  }
}

/* ─── Hydration ───────────────────────────────────────────────────────────── */

async function hydrate() {
  status = 'hydrating'
  notify()

  const { patch: legacyPatch, legacyKeys } = collectLegacy()

  let remote
  try {
    remote = await getPrefs()
  } catch {
    // Leave the cache exactly as it is and try again on the next boot. Showing a
    // returning user the welcome wizard because one GET failed is far worse than
    // a new user waiting a launch for it.
    status = 'failed'
    notify()
    return
  }

  // Backend wins over the cache, except for keys this session has just written.
  const merged = { ...values, ...remote }
  locallyWritten.forEach((k) => {
    if (k in values) merged[k] = values[k]
    else delete merged[k]
  })

  // Legacy values only fill keys the backend does not already hold.
  const rescue = {}
  Object.entries(legacyPatch).forEach(([k, v]) => {
    if (!(k in remote) && !locallyWritten.has(k)) {
      merged[k] = v
      rescue[k] = v
    }
  })

  values = merged
  cachedUserId = currentUserId
  writeCache()
  status = 'ready'
  notify()

  if (legacyKeys.length) {
    try {
      if (Object.keys(rescue).length) await putPrefs(rescue)
      // Only drop the old keys once the rescue has actually landed, so a failed
      // write leaves them in place for the next boot to retry.
      clearLegacy(legacyKeys)
    } catch (err) {
      console.warn('Prefs migration will retry on the next launch.', err)
    }
  }
}

/**
 * Tell the store who is signed in. Called once from App with the id from
 * /auth/me. On the desktop that is always the synthetic local admin (id 1), so
 * this settles immediately. On a hosted deployment it is null until sign-in,
 * and changes when someone else signs in - which drops the previous person's
 * cached values before hydrating fresh ones.
 */
export function syncPrefsUser(userId) {
  if (userId == null) {
    currentUserId = null
    return
  }
  if (currentUserId === userId && hydration) return

  currentUserId = userId
  if (cachedUserId !== userId) {
    // The cache belongs to somebody else. Drop it rather than show their name.
    values = {}
    cachedUserId = userId
    locallyWritten = new Set()
    writeCache()
    notify()
  }
  hydration = hydrate()
}

/* ─── Reading and writing ─────────────────────────────────────────────────── */

/** Set one pref. Pass null to clear it. */
export function setPref(key, value) {
  setPrefs({ [key]: value })
}

/** Set several prefs at once. Any key set to null is cleared. */
export function setPrefs(patch) {
  const next = { ...values }
  Object.entries(patch).forEach(([k, v]) => {
    locallyWritten.add(k)
    if (v === null || v === undefined) delete next[k]
    else next[k] = v
  })
  values = next
  writeCache()
  notify()
  queuePut(
    Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]),
    ),
  )
}

/**
 * The whole store. `hydrated` means hydration has settled, successfully or
 * not - it is the signal to stop waiting, never a promise the values are
 * complete. `trustworthy` is the stricter one: false when the GET failed and
 * there was no cache to fall back on, which is the case where we must not
 * conclude anything from an absent key.
 */
export function usePrefs() {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  const settled = snap.status === 'ready' || snap.status === 'failed'
  return {
    prefs: snap.values,
    status: snap.status,
    hydrated: settled,
    trustworthy: snap.status === 'ready'
      || (snap.status === 'failed' && Object.keys(snap.values).length > 0),
    setPref,
    setPrefs,
  }
}

/**
 * One pref as a [value, setValue] pair. `fallback` is returned while the value
 * is absent, so a caller never has to handle undefined.
 */
export function usePref(key, fallback = undefined) {
  const { prefs, hydrated, trustworthy } = usePrefs()
  const value = prefs[key] === undefined ? fallback : prefs[key]
  const set = useCallback((next) => setPref(key, next), [key])
  return [value, set, { hydrated, trustworthy }]
}
