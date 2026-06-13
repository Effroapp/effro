import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Layers, ArrowRight } from 'lucide-react'
import { folioApi } from '../api/client'

/**
 * "Deep dives" section on an Area page: the folios filed under this area.
 * Areas rarely close, so a dive filed here stays surfaced as long-lived
 * reference. Renders nothing when there are none (or when Folio is disabled,
 * in which case the endpoint 404s and we just stay quiet).
 */
export default function AreaFolios({ areaId }) {
  const navigate = useNavigate()
  const [folios, setFolios] = useState([])

  useEffect(() => {
    let alive = true
    folioApi.byArea(areaId).then((f) => { if (alive) setFolios(f || []) }).catch(() => {})
    return () => { alive = false }
  }, [areaId])

  if (!folios.length) return null

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Library size={15} className="text-mint" />
        <h3 className="font-display font-semibold text-sm text-pitch-800 dark:text-white">Deep dives</h3>
        <span className="font-mono text-2xs text-paper-500 dark:text-paper-600">{folios.length}</span>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {folios.map((f) => (
          <button
            key={f.id}
            onClick={() => navigate(`/folios/${f.id}`)}
            className="group text-left flex items-center gap-3 rounded-xl p-3
                       bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                       hover:border-mint/40 hover:bg-paper-200/60 dark:hover:bg-pitch-600 transition-colors"
          >
            <span className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-paper-200 dark:bg-pitch-800
                             border border-paper-300 dark:border-pitch-400 grid place-items-center">
              {f.thumb_url
                ? <img src={f.thumb_url} alt="" className="w-full h-full object-contain p-0.5" loading="lazy" />
                : <Library size={15} className="text-paper-500 dark:text-pitch-200" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-pitch-800 dark:text-pitch-50 truncate">{f.title || 'Untitled deep dive'}</span>
              <span className="font-mono text-2xs text-paper-500 dark:text-pitch-200 inline-flex items-center gap-1">
                <Layers size={10} /> {f.capture_count} capture{f.capture_count === 1 ? '' : 's'}
              </span>
            </span>
            <ArrowRight size={14} className="flex-shrink-0 text-paper-400 dark:text-pitch-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  )
}
