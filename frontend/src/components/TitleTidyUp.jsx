import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'

import { suggestTitleForEntry, titleBacklog } from '../api/titles'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { useToast } from './Toast'

/**
 * Name the entries that are still using their own first line as a title.
 *
 * A suggestion normally arrives moments after a save, so this only has work to
 * do for entries written before titles existed, or saved while no engine was
 * configured. For a to-do that first line is the cut-off sentence the compact
 * lists show, which is the whole reason it wants naming.
 *
 * Deliberately a thing the user starts, not something that happens on launch.
 * It is one AI call per entry against their own key, so they are told how many
 * before anything runs, and they can stop it part way without losing what it
 * has already done.
 */
export default function TitleTidyUp() {
  const toast = useToast()
  const { configured } = useAIConfigured()

  const [backlog, setBacklog] = useState(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [named, setNamed] = useState(0)
  const stop = useRef(false)

  const load = useCallback(() => {
    titleBacklog().then(setBacklog).catch(() => setBacklog(null))
  }, [])

  useEffect(() => { if (configured) load() }, [configured, load])
  useEffect(() => () => { stop.current = true }, [])

  if (!configured || !backlog) return null

  const total = backlog.ids.length
  if (total === 0 && !running && done === 0) return null

  const run = async () => {
    stop.current = false
    setRunning(true)
    setDone(0)
    setNamed(0)
    let changed = 0
    // One at a time. A burst of parallel calls is how you meet a rate limit,
    // and this is a background tidy with nobody waiting on it.
    for (const [i, id] of backlog.ids.entries()) {
      if (stop.current) break
      try {
        const result = await suggestTitleForEntry(id)
        if (result.changed) changed++
      } catch (e) {
        // One failure should not end the run. A 503 means the engine went
        // away, which is worth stopping for.
        if (String(e.message).includes("isn't set up")) {
          toast(e.message, 'error')
          break
        }
      }
      setDone(i + 1)
      setNamed(changed)
    }
    setRunning(false)
    load()
    if (!stop.current) {
      toast(changed === 1 ? '1 entry named' : `${changed} entries named`)
    }
  }

  return (
    <div className="mt-4 p-4 rounded-lg bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-500">
      <div className="flex items-start gap-3">
        <Sparkles size={16} className="flex-shrink-0 mt-0.5 text-paper-500 dark:text-paper-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-pitch-800 dark:text-white">
            Name older entries
          </p>
          <p className="text-xs text-paper-500 dark:text-paper-600 mt-0.5 leading-relaxed">
            {running
              ? `Working through them, ${done} of ${total} so far.`
              : total > 0
                ? `${describe(backlog)} still show their first line instead of a name. Naming them is one AI call each, on your own key.`
                : 'Everything has a name.'}
          </p>

          {running && (
            <div className="mt-2 h-1 rounded-full bg-paper-300 dark:bg-pitch-500 overflow-hidden">
              <div
                className="h-full bg-mint-700 transition-all duration-300"
                style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
              />
            </div>
          )}

          {!running && done > 0 && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-mint-700 dark:text-mint-300">
              <Check size={12} />
              {named === 1 ? '1 entry named' : `${named} entries named`}
            </p>
          )}
        </div>

        {total > 0 && (
          <button
            onClick={running ? () => { stop.current = true } : run}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors
              ${running
                ? 'text-paper-600 hover:bg-paper-200 dark:hover:bg-pitch-500'
                : 'bg-mint-700 hover:bg-mint-800 text-white'}`}
          >
            {running ? <><X size={12} /> Stop</> : 'Name them'}
          </button>
        )}
      </div>
    </div>
  )
}

function describe({ todos, prose }) {
  const parts = []
  if (todos) parts.push(todos === 1 ? '1 to-do' : `${todos} to-dos`)
  if (prose) parts.push(prose === 1 ? '1 entry' : `${prose} entries`)
  return parts.join(' and ')
}
