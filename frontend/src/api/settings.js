/**
 * Settings API helpers - talks to the Effro backend's /settings/* routes.
 *
 * All functions throw on non-2xx with the server's `detail` message (falling
 * back to a generic message), so callers can render errors directly without
 * inspecting status codes.
 */

const BASE = '/api'

async function _handle(res, fallback = 'Request failed') {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || fallback)
  }
  return res.json()
}

/** Current AI engine config - api_key is masked to its last 4 chars. */
export async function getAIConfig() {
  const res = await fetch(`${BASE}/settings/ai`)
  return _handle(res, 'Failed to load AI config')
}

/**
 * Catalogue of supported providers + their default URLs and models.
 * Drives the provider picker on the Settings page.
 */
export async function getAIPresets() {
  const res = await fetch(`${BASE}/settings/ai/presets`)
  return _handle(res, 'Failed to load AI presets')
}

/** Persist an AI config. Server returns the canonical config (key masked). */
export async function saveAIConfig(config) {
  const res = await fetch(`${BASE}/settings/ai`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return _handle(res, 'Failed to save AI config')
}

/**
 * Dry-run a config against the provider. Returns
 * `{ ok, message, provider, model }` - UI uses this to gate the Save button.
 */
export async function testAIConfig(config) {
  const res = await fetch(`${BASE}/settings/ai/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return _handle(res, 'Test request failed')
}
