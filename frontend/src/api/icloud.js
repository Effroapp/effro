/**
 * iCloud API helpers. Credential-based (Apple ID + app-specific password) over
 * CalDAV + IMAP - no OAuth, so it's save/test rather than a redirect flow.
 */

const BASE = '/api/icloud'

export async function getIcloudConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load iCloud config')
  return res.json()
}

export async function saveIcloudConfig({ apple_id, app_password }) {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apple_id, app_password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getIcloudProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load iCloud profile')
  return res.json()
}

export async function testIcloud() {
  const res = await fetch(`${BASE}/test`, { method: 'POST' })
  if (!res.ok) throw new Error('Test failed')
  return res.json()
}

export async function disconnectIcloud() {
  const res = await fetch(`${BASE}/disconnect`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Disconnect failed')
  return res.json()
}

export async function syncNow() {
  const res = await fetch(`${BASE}/sync-now`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}
