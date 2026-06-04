/**
 * Jira Cloud integration API.
 *
 * OAuth uses the same browser-navigation pattern as MS365:
 * window.location.href = loginUrl() triggers the Atlassian consent page,
 * which redirects back to /settings?jira_connected=true on success.
 */

const BASE = '/api/jira'

export async function getJiraConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load Jira config')
  return res.json()
}

export async function saveJiraConfig({ client_id, client_secret }) {
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

export async function getJiraProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load Jira profile')
  return res.json()
}

export async function getJiraScope() {
  const res = await fetch(`${BASE}/scope`)
  if (!res.ok) throw new Error('Failed to load Jira scope')
  return res.json()  // { scope }
}

export async function setJiraScope(scope) {
  const res = await fetch(`${BASE}/scope`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export function loginUrl() {
  return `${BASE}/auth/login`
}

export async function disconnectJira() {
  const res = await fetch(`${BASE}/auth/disconnect`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Disconnect failed')
  return res.json()
}

export async function jiraSyncNow() {
  const res = await fetch(`${BASE}/sync-now`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  return res.json()
}
