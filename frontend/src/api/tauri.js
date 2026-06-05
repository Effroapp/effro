/**
 * Tauri bridge - thin wrappers around Tauri invoke calls.
 *
 * Every function is a no-op (returns null) when running outside Tauri so
 * the rest of the app stays unaware. The browser/Docker build of the
 * frontend has zero Tauri-specific behaviour.
 *
 * The dynamic import of `@tauri-apps/api/core` is what keeps the browser
 * build healthy: Vite tree-shakes it out when isTauri() is false, and
 * the import itself never resolves outside the WebView2 process.
 */

export const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke(cmd, args = {}) {
  if (!isTauri()) return null
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke(cmd, args)
}

/**
 * Open a URL in the user's real browser.
 *
 * The desktop webview blocks ordinary `target="_blank"` navigation (only
 * localhost is allow-listed), so external links did nothing. Here we hand the
 * URL to the OS via the shell plugin's `open` command (gated by shell:allow-open
 * in capabilities). In the browser/Docker build we just use window.open.
 */
export async function openExternal(url) {
  if (!url) return
  if (isTauri()) {
    try {
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
      await tauriInvoke('plugin:shell|open', { path: url })
      return
    } catch (e) {
      // Fall through to a normal window.open as a last resort.
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** Returns the current data directory path string, or null outside Tauri. */
export async function getDataDir() {
  return invoke('get_data_dir')
}

/**
 * Opens a native OS folder picker. Returns the absolute path string of the
 * chosen folder, or null if the user cancelled (or we're not in Tauri).
 */
export async function pickDataDir() {
  return invoke('pick_data_dir')
}

/**
 * Copies trace.db + uploads/ from the current data dir to `newPath` and
 * saves the new path to the config store. The old data is **not** deleted -
 * intentional safety net. Caller must `relaunch()` afterwards because the
 * running sidecar still points at the old location.
 *
 * Surfaces Tauri's Err(String) as a rejected promise with the message.
 */
export async function migrateAndSetDataDir(newPath) {
  if (!isTauri()) return
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke('migrate_and_set_data_dir', { newPath })
}

/** Restarts the Tauri app (no-op in browser). */
export async function relaunch() {
  return invoke('relaunch')
}

// ── Updater ──────────────────────────────────────────────────────────────

/** "stable" | "beta" - defaults to "stable" outside Tauri. */
export async function getUpdateChannel() {
  if (!isTauri()) return 'stable'
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke('get_update_channel')
}

/**
 * Persist the channel. Takes effect on the *next* app launch (updater
 * endpoint is wired at plugin-init time).
 */
export async function setUpdateChannel(channel) {
  if (!isTauri()) return
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke('set_update_channel', { channel })
}

/**
 * Returns the update endpoint URL the user's current channel would hit.
 * The Rust side reads the channel from the store and resolves to the
 * right GitHub Releases URL.
 */
async function getUpdateEndpoint() {
  if (!isTauri()) return null
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke('get_update_endpoint')
}

/**
 * Returns the "Bearer <pat>" header value baked into the binary at build
 * time, or null when the binary was built without a token (local dev).
 * We use this to authenticate against the private GitHub Releases endpoint.
 */
async function getUpdaterAuthHeader() {
  if (!isTauri()) return null
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke('get_updater_auth_header')
}

/**
 * Check for an update. Returns:
 *   - { available: true, version, currentVersion, body, downloadAndInstall }
 *     when a newer version is found. Call `downloadAndInstall()` to apply.
 *   - { available: false } when up to date.
 *   - null outside Tauri.
 *
 * We pass the endpoint override on every check because the tauri-plugin-
 * updater Rust Builder doesn't allow runtime endpoint changes - but the JS
 * `check({ endpoints })` does.
 *
 * NB: NO Authorization header. The Effroapp/effro repo is PUBLIC, so release
 * assets download anonymously. Sending a stale Bearer token (left over from
 * when the repo was the private lukeogh/Trace) makes GitHub return 401 even
 * for public files — which is exactly what broke auto-update through v0.9.x.
 */
export async function checkForUpdate() {
  if (!isTauri()) return null
  const endpoint = await getUpdateEndpoint()
  const options = {}
  if (endpoint) options.endpoints = [endpoint]
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check(Object.keys(options).length ? options : undefined)
  if (!update) return { available: false }
  return {
    available: true,
    version: update.version,
    currentVersion: update.currentVersion,
    body: update.body,
    // Download + install in one shot. Caller should also call
    // relaunchForUpdate() afterwards.
    downloadAndInstall: (onEvent) => update.downloadAndInstall(onEvent),
  }
}

/**
 * Relaunch the app after the updater has finished applying the new bundle.
 * Uses tauri-plugin-process (not the same as our `relaunch` command, which
 * goes through app.restart()).
 */
export async function relaunchForUpdate() {
  if (!isTauri()) return
  const { relaunch: processRelaunch } = await import('@tauri-apps/plugin-process')
  return processRelaunch()
}
