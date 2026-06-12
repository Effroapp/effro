/**
 * Mail (generic IMAP) API helpers. Credential-based (host + username + app
 * password), like iCloud - save/test rather than a redirect flow.
 */

const BASE = '/api/mail'

export async function getMailConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load mail config')
  return res.json()
}

export async function saveMailConfig({ host, username, password, port }) {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, username, password, port }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getMailProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load mail profile')
  return res.json()
}

export async function testMail() {
  const res = await fetch(`${BASE}/test`, { method: 'POST' })
  if (!res.ok) throw new Error('Test failed')
  return res.json()
}

export async function disconnectMail() {
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
