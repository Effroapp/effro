import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Layers, ArrowRight, Plus, Loader2 } from 'lucide-react'
import { folioApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'

/**
 * "Deep dives" rail card on an Area page: the folios filed under this area,
 * plus a shortcut to start a new dive already filed here. Uses the Folios nav
 * icon (Library) so it visibly ties back to the Folios section. Renders nothing
 * unless Folio is enabled for this deployment.
 */
export default function AreaFolios({ areaId }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const enabled = !!user?.folio_enabled
  const [folios, setFolios] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    folioApi.byArea(areaId).then((f) => { if (alive) setFolios(f || []) }).catch(() => { if (alive) setFolios([]) })
    return () => { alive = false }
  }, [areaId, enabled])

  if (!enabled) return null

  const newDive = async () => {
    setCreating(true)
    try {
      const f = await folioApi.create({ area_id: Number(areaId) })
      navigate(`/folios/${f.id}`)
    } catch (e) {
      toast(e.message || 'Could not start a deep dive', 'error')
      setCreating(false)
    }
  }

  const list = folios || []
  return (
    <div className="rounded-xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400 p-3.5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="eyebrow flex items-center gap-2 text-paper-500 dark:text-pitch-200">
          <Library size={14} className="text-mint" /> Deep dives
          {list.length > 0 && <span className="text-paper-400 dark:text-pitch-300">{list.length}</span>}
        </span>
        <button
          onClick={newDive}
          disabled={creating}
          title="Start a deep dive filed to this area"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-mono text-2xs uppercase tracking-wide
                     bg-paper-100 dark:bg-pitch-600 border border-paper-300 dark:border-pitch-400
                     text-pitch-800 dark:text-pitch-50 hover:border-mint/40 transition-colors disabled:opacity-50"
        >
          {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} className="text-mint" />} New
        </button>
      </div>
      {list.length === 0 ? (
        <p className="font-lexend text-xs text-paper-500 dark:text-pitch-200 leading-relaxed">
          No deep dives filed here yet. Start one to research a corner of this area.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((f) => (
            <button
              key={f.id}
              onClick={() => navigate(`/folios/${f.id}`)}
              className="group text-left flex items-center gap-2.5 rounded-lg p-2
                         border border-paper-300 dark:border-pitch-400 bg-paper-100 dark:bg-pitch-800
                         hover:border-mint/40 transition-colors"
            >
              <span className="flex-shrink-0 w-8 h-8 rounded-md overflow-hidden grid place-items-center
                               bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400">
                {f.thumb_url
                  ? <img src={f.thumb_url} alt="" className="w-full h-full object-contain p-0.5" loading="lazy" />
                  : <Library size={13} className="text-paper-500 dark:text-pitch-200" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-pitch-800 dark:text-pitch-50 truncate">{f.title || 'Untitled deep dive'}</span>
                <span className="font-mono text-2xs text-paper-500 dark:text-pitch-200 inline-flex items-center gap-1">
                  <Layers size={9} /> {f.capture_count}
                </span>
              </span>
              <ArrowRight size={13} className="flex-shrink-0 text-paper-400 dark:text-pitch-300 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
