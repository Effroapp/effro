/**
 * Telegram API helpers. Token-based (a bot token from @BotFather), no OAuth -
 * save/test rather than a redirect flow.
 */

const BASE = '/api/telegram'

export async function getTelegramConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to load Telegram config')
  return res.json()
}

export async function saveTelegramConfig({ token }) {
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

export async function getTelegramProfile() {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error('Failed to load Telegram profile')
  return res.json()
}

export async function testTelegram() {
  const res = await fetch(`${BASE}/test`, { method: 'POST' })
  if (!res.ok) throw new Error('Test failed')
  return res.json()
}

export async function disconnectTelegram() {
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
