/**
 * Storage API helpers - talks to the Effro backend's /storage/* routes.
 *
 * Mirrors the pattern in api/settings.js: throws on non-2xx with the
 * server's `detail` message so callers can surface the error verbatim.
 */

const BASE = '/api'

async function _handle(res, fallback) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || fallback)
  }
  return res.json()
}

/** Current storage config - `is_connected: false` until the user sets up a remote. */
export async function getStorageConfig() {
  return _handle(await fetch(`${BASE}/storage/config`), 'Failed to load storage config')
}

/** Save the storage config. Password is encrypted server-side before persistence. */
export async function saveStorageConfig(config) {
  return _handle(
    await fetch(`${BASE}/storage/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),
    'Failed to save config'
  )
}

/** Disconnect - falls back to local. Remote files are NOT touched. */
export async function disconnectStorage() {
  return _handle(
    await fetch(`${BASE}/storage/config`, { method: 'DELETE' }),
    'Failed to disconnect'
  )
}

/**
 * Dry-run a connection. Pass a config to test those values without saving
 * (the wizard path) - or call with no args to test the currently-saved config.
 *
 * Critical: the wizard MUST pass a config, otherwise a failed test would
 * still leave the previous saved config in place + the UI's is_connected
 * flag would lie about working credentials.
 */
export async function testStorageConnection(config) {
  return _handle(
    await fetch(`${BASE}/storage/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: config ? JSON.stringify(config) : 'null',
    }),
    'Test request failed'
  )
}

/** Queue an immediate backup. Returns instantly - backup runs in the background. */
export async function runManualBackup() {
  return _handle(
    await fetch(`${BASE}/storage/backup/run`, { method: 'POST' }),
    'Backup request failed'
  )
}

/** Most recent 20 sync log entries - drives the Manage view's history list. */
export async function getBackupLogs() {
  return _handle(
    await fetch(`${BASE}/storage/backup/logs`),
    'Failed to load backup logs'
  )
}
