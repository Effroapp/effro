import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { authApi } from '../api/client'

const AuthContext = createContext(null)

/**
 * Tracks the signed-in user.
 *
 * Auth is flag-gated on the backend (EFFRO_AUTH_ENABLED): when it is off - the
 * desktop build - GET /auth/me returns a synthetic local admin, so `user` is
 * always set and the app never shows a login. When it is on (hosted/Docker),
 * `user` is null until the person signs in, and a 401 from any API call drops
 * it again so the route guard can redirect to /login.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // null = unknown; true once a user exists; false on a fresh instance (drives
  // setup-vs-login routing). Irrelevant when auth is off (user is always set).
  const [initialised, setInitialised] = useState(null)

  const refresh = useCallback(async () => {
    const [meRes, statusRes] = await Promise.allSettled([
      authApi.me(),
      authApi.setupStatus(),
    ])
    setUser(meRes.status === 'fulfilled' ? meRes.value : null)
    // On error assume initialised (safer: route to /login, not /setup).
    setInitialised(statusRes.status === 'fulfilled' ? !!statusRes.value.initialised : true)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Any API 401 (session expired or revoked) drops the user so the guard reacts.
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('effro:unauthorized', onUnauthorized)
    return () => window.removeEventListener('effro:unauthorized', onUnauthorized)
  }, [])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch { /* ignore network/late errors */ }
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, initialised, setUser, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
