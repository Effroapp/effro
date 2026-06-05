/**
 * Google Drive/Docs integration API. Mirrors the Microsoft client: the OAuth
 * login uses a full-page navigation, so loginUrl() returns the URL and the
 * caller does window.location.href. Connected status is polled via getProfile().
 */

const BASE = '/api/google'

/** Google Cloud OAuth app config (Client ID + Secret). Secret masked on read. */
export async function getGoogleConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load Google config')
  return res.json()
}

export async function saveGoogleConfig({ client_id, client_secret }) {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, client_secret }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

/** Connected Google account, or { connected: false }. Polled during OAuth. */
export async function getGoogleProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load Google profile')
  return res.json()
}

/** URL the user's browser should hit to start the OAuth flow. */
export function loginUrl() {
  return `${BASE}/auth/login`
}

/** Wipe the stored integration (tokens + profile). */
export async function disconnectGoogle() {
  const res = await fetch(`${BASE}/auth/disconnect`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Disconnect failed')
  return res.json()
}
