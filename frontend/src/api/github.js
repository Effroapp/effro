/**
 * GitHub API helpers. Token-based (personal access token), no OAuth - save/test
 * rather than a redirect flow.
 */

const BASE = '/api/github'

export async function getGithubConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load GitHub config')
  return res.json()
}

export async function saveGithubConfig({ token }) {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getGithubProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load GitHub profile')
  return res.json()
}

export async function testGithub() {
  const res = await fetch(`${BASE}/test`, { method: 'POST' })
  if (!res.ok) throw new Error('Test failed')
  return res.json()
}

export async function disconnectGithub() {
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
