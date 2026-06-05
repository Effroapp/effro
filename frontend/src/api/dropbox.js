/**
 * Dropbox API helpers. Dropbox is a storage-only OAuth connection (encrypted
 * backups), configured inside the Storage flow. Mirrors the Google client shape.
 */

const BASE = '/api/dropbox'

export async function getDropboxConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load Dropbox config')
  return res.json()
}

export async function saveDropboxConfig({ app_key, app_secret }) {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key, app_secret }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getDropboxProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load Dropbox profile')
  return res.json()
}

export function loginUrl() {
  return `${BASE}/auth/login`
}

export async function disconnectDropbox() {
  const res = await fetch(`${BASE}/auth/disconnect`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Disconnect failed')
  return res.json()
}
