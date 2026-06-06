/**
 * useAIConfigured - single source of truth for "is the AI engine ready?".
 *
 * Returns:
 *   - configured: boolean | null    (null = still loading)
 *   - loading:    boolean
 *
 * All AI-dependent surfaces (Smart Generate page, area Update button,
 * Weekly Roundup button) call this hook and gate their UI on it - so the
 * user doesn't get to invest effort before discovering AI isn't set up.
 *
 * Cross-page sync: when the wizard on /settings finishes saving, it
 * dispatches a `effro:ai-config-changed` window event. Every open instance
 * of this hook listens for it and re-fetches, so the gate flips off
 * instantly without a page reload.
 */
import { useEffect, useState, useCallback } from 'react'
import { getAIConfig } from '../api/settings'

export const AI_CONFIG_CHANGED_EVENT = 'effro:ai-config-changed'

/** Notify all listeners that the AI config has changed. Call this from
 *  anywhere that mutates `/settings/ai` (currently just the wizard). */
export function notifyAIConfigChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AI_CONFIG_CHANGED_EVENT))
}

export function useAIConfigured() {
  const [configured, setConfigured] = useState(null)
  // True when the active engine is a small/free/local preset (Groq, Gemini,
  // Ollama). Lets AI surfaces set honest expectations - see Smart Generate.
  const [smallModel, setSmallModel] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchStatus = useCallback(() => {
    setLoading(true)
    getAIConfig()
      .then((cfg) => {
        setConfigured(!!cfg?.is_configured)
        setSmallModel(!!cfg?.small_model)
      })
      .catch(() => {                          // treat fetch error as unconfigured
        setConfigured(false)
        setSmallModel(false)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchStatus()
    window.addEventListener(AI_CONFIG_CHANGED_EVENT, fetchStatus)
    return () => window.removeEventListener(AI_CONFIG_CHANGED_EVENT, fetchStatus)
  }, [fetchStatus])

  return { configured, loading, smallModel }
}
