const BASE = '/api'

// ─── Core request helper ──────────────────────────────────────────────────────

async function request(path, options = {}) {
  const { body, headers = {}, ...rest } = options

  const init = {
    // Send the session cookie so auth-enabled deployments authenticate the
    // request. Harmless when auth is off (desktop): there is no cookie.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    ...rest,
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const res = await fetch(`${BASE}${path}`, init)

  if (!res.ok) {
    // A 401 means the session is gone. Let the app react globally (the route
    // guard redirects to /login) - except for the auth probes themselves, which
    // expect a 401 and handle it locally to avoid a redirect loop.
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      window.dispatchEvent(new Event('effro:unauthorized'))
    }
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      const d = data.detail
      if (typeof d === 'string') {
        message = d
      } else if (Array.isArray(d)) {
        // FastAPI/Pydantic validation errors come back as an array of objects;
        // surface the human-readable bits instead of "[object Object]".
        message = d.map((e) => e?.msg || JSON.stringify(e)).join('; ')
      } else if (d) {
        message = JSON.stringify(d)
      }
    } catch {
      // ignore parse error
    }
    throw new Error(message)
  }

  if (res.status === 204) return null
  return res.json()
}

// ─── Auth (flag-gated) ──────────────────────────────────────────────────────

export const authApi = {
  // Current user. When auth is off the backend returns the synthetic local
  // admin, so this resolves and the app never shows a login.
  me: () => request('/auth/me'),
  setupStatus: () => request('/auth/setup/status'),
  setup: (payload) => request('/auth/setup', { method: 'POST', body: payload }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
}

// ─── Admin (user management; admin-only, auth-enabled deployments) ────────────

export const adminApi = {
  listUsers: () => request('/admin/users'),
  createUser: (payload) => request('/admin/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: payload }),
  revokeSessions: (id) => request(`/admin/users/${id}/sessions`, { method: 'DELETE' }),
}

// ─── Areas ────────────────────────────────────────────────────────────────────

export const areasApi = {
  list: () =>
    request('/areas'),

  create: (payload) =>
    request('/areas', { method: 'POST', body: payload }),

  get: (id) =>
    request(`/areas/${id}`),

  update: (id, payload) =>
    request(`/areas/${id}`, { method: 'PUT', body: payload }),

  suggestSummary: (id) =>
    request(`/areas/${id}/summary/suggest`, { method: 'POST' }),

  setAutoUpdateAll: (enabled) =>
    request('/areas/auto-update-all', { method: 'POST', body: { auto_update: enabled } }),

  listThreads: (areaId) =>
    request(`/areas/${areaId}/threads`),

  createThread: (areaId, payload) =>
    request(`/areas/${areaId}/threads`, { method: 'POST', body: payload }),

  reorderThreads: (areaId, orderedIds) =>
    request(`/areas/${areaId}/threads/reorder`, { method: 'PUT', body: { ordered_ids: orderedIds } }),

  getActivity: (limit = 10) =>
    request(`/activity?limit=${limit}`),

  getAudit: (areaId) =>
    request(`/areas/${areaId}/audit`),

  getGlobalAudit: (limit = 200) =>
    request(`/audit?limit=${limit}`),

  getRoundupData: () =>
    request('/roundup'),

  generateRoundup: (data) =>
    request('/generate/roundup', { method: 'POST', body: data }),
}

// ─── Threads ──────────────────────────────────────────────────────────────────

export const threadsApi = {
  get: (id) =>
    request(`/threads/${id}`),

  getAll: () =>
    request('/threads/all'),

  update: (id, payload) =>
    request(`/threads/${id}`, { method: 'PUT', body: payload }),

  suggestSummary: (id) =>
    request(`/threads/${id}/summary/suggest`, { method: 'POST' }),

  setAutoUpdateAll: (enabled) =>
    request('/threads/auto-update-all', { method: 'POST', body: { auto_update: enabled } }),

  delete: (id) =>
    request(`/threads/${id}`, { method: 'DELETE' }),

  getAudit: (threadId) =>
    request(`/threads/${threadId}/audit`),

  addLink: (threadId, payload) =>
    request(`/threads/${threadId}/links`, { method: 'POST', body: payload }),

  deleteLink: (linkId) =>
    request(`/links/${linkId}`, { method: 'DELETE' }),
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export const entriesApi = {
  create: (threadId, payload) =>
    request(`/threads/${threadId}/entries`, { method: 'POST', body: payload }),

  update: (id, payload) =>
    request(`/entries/${id}`, { method: 'PUT', body: payload }),

  delete: (id) =>
    request(`/entries/${id}`, { method: 'DELETE' }),

  getUpcoming: (limit = 10) =>
    request(`/todos/upcoming?limit=${limit}`),
}

// ─── Ingest (drag-drop files) ─────────────────────────────────────────────────

export const ingestApi = {
  parseFile: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/ingest/parse`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
    if (!res.ok) {
      if (res.status === 401) window.dispatchEvent(new Event('effro:unauthorized'))
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return res.json()
  },
}


// ─── Generate / Process ───────────────────────────────────────────────────────

export const generateApi = {
  process: (areaName, inputText, sourceKind = null, existingThreads = null, areaId = null, exclude = null, maxItems = null) =>
    request('/generate/process', {
      method: 'POST',
      body: {
        area_name: areaName,
        input_text: inputText,
        source_kind: sourceKind,
        existing_threads: existingThreads,
        area_id: areaId,
        exclude,
        max_items: maxItems,
      },
    }),
  refine: (item, rejectionReason, areaName) =>
    request('/generate/refine', {
      method: 'POST',
      body: { item, rejection_reason: rejectionReason, area_name: areaName },
    }),
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export const attachmentsApi = {
  addLink: (threadId, payload) =>
    request(`/threads/${threadId}/attachments/link`, { method: 'POST', body: payload }),

  uploadFile: async (threadId, file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/threads/${threadId}/attachments/file`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      // NOTE: do NOT set Content-Type; browser sets multipart boundary automatically
    })
    if (!res.ok) {
      if (res.status === 401) window.dispatchEvent(new Event('effro:unauthorized'))
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return res.json()
  },

  delete: (id) =>
    request(`/attachments/${id}`, { method: 'DELETE' }),
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export const insightsApi = {
  get: (lookbackDays = 7) =>
    request(`/insights?lookback_days=${lookbackDays}`),

  // The end-of-day wind-down. tz offset (JS getTimezoneOffset, minutes) lets
  // the backend compute "today" in the user's local day, not UTC.
  today: (tzOffsetMin = new Date().getTimezoneOffset(), nonce = 0) =>
    request(`/insights/today?tz_offset_min=${tzOffsetMin}&nonce=${nonce}`),

  // Reflect → This week: closed loops, celebrations, working-day bars, rhythm.
  week: (tzOffsetMin = new Date().getTimezoneOffset()) =>
    request(`/insights/week?tz_offset_min=${tzOffsetMin}`),

  // Ahead: next meeting, 10-day timeline, load forecast, good window.
  ahead: (tzOffsetMin = new Date().getTimezoneOffset()) =>
    request(`/insights/ahead?tz_offset_min=${tzOffsetMin}`),

  // Balance: per-area activity, drift, "not on you".
  balance: (tzOffsetMin = new Date().getTimezoneOffset()) =>
    request(`/insights/balance?tz_offset_min=${tzOffsetMin}`),

  // Save the "what I'm focused on this week" note (shapes the wind-down tone).
  setFocus: (text) =>
    request('/insights/focus', { method: 'POST', body: { text } }),
}

// ─── Presence / heartbeat ─────────────────────────────────────────────────────
// Pinged while the app is open so Insights can infer the real working window.

export const presenceApi = {
  ping: () =>
    request('/heartbeat', { method: 'POST' }),
}
