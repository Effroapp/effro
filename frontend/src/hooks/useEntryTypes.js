import { useCallback, useEffect, useState } from 'react'

import { entryTypesApi } from '../api/client'

/**
 * The user's own entry types, fetched once and shared.
 *
 * The composer and Quick Capture both offer the same list, and Quick Capture
 * can open over a thread that already has it, so the cache lives at module
 * level rather than per component. A mutation refreshes it and every mounted
 * consumer follows, which keeps a type added in the composer visible in Quick
 * Capture without a reload.
 */
let cache = null
let inFlight = null
const listeners = new Set()

function publish(next) {
  cache = next
  listeners.forEach((fn) => fn(next))
}

async function load(force = false) {
  if (cache && !force) return cache
  // Share one request when several components mount together.
  if (!inFlight || force) {
    inFlight = entryTypesApi.list()
      .then((rows) => { publish(rows); return rows })
      .catch(() => { publish(cache ?? []); return cache ?? [] })
      .finally(() => { inFlight = null })
  }
  return inFlight
}

export function useEntryTypes() {
  const [types, setTypes] = useState(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    listeners.add(setTypes)
    load().then(() => setLoading(false))
    return () => { listeners.delete(setTypes) }
  }, [])

  const refresh = useCallback(() => load(true), [])

  const create = useCallback(async (payload) => {
    const made = await entryTypesApi.create(payload)
    await load(true)
    return made
  }, [])

  const update = useCallback(async (id, payload) => {
    const changed = await entryTypesApi.update(id, payload)
    await load(true)
    return changed
  }, [])

  const remove = useCallback(async (id) => {
    const result = await entryTypesApi.remove(id)
    await load(true)
    return result
  }, [])

  return { types, loading, refresh, create, update, remove }
}
