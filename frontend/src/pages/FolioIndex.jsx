import { useState, useEffect, useCallback } from 'react'
import { Library, Plus, Loader2, FileText } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import PageHeader from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { folioApi } from '../api/client'
import { BionicText } from '../utils/bionic.jsx'

/**
 * Folio index - the list of deep dives.
 *
 * Step 1 is a working list + create. The mockup-faithful layout (featured
 * dive, favicon clusters, recent/earlier grouping, search, topic chips) lands
 * in a later step against folio-index-mockup-3.html.
 */
export default function FolioIndex() {
  const toast = useToast()
  const [folios, setFolios] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    folioApi.list()
      .then(setFolios)
      .catch((e) => { setFolios([]); toast(e.message || 'Could not load your folios', 'error') })
  }, [toast])
  useEffect(() => { load() }, [load])

  const newDive = async () => {
    setCreating(true)
    try {
      await folioApi.create({})
      load()
    } catch (e) {
      toast(e.message || 'Could not start a deep dive', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-pitch-800">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
        <PageHeader
          icon={Library}
          title="Folios"
          subtitle="Capture a deep dive, then pull it together into one clear digest."
          right={
            <button
              onClick={newDive}
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                         bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              New deep dive
            </button>
          }
        />

        {folios === null ? (
          <div className="flex justify-center py-20 text-paper-500 dark:text-pitch-200">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : folios.length === 0 ? (
          <EmptyState onStart={newDive} creating={creating} />
        ) : (
          <ul className="space-y-2">
            {folios.map((f) => (
              <li key={f.id}>
                <div className="rounded-xl border border-paper-300 dark:border-pitch-400
                                bg-paper-200 dark:bg-pitch-700 p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-medium text-pitch-800 dark:text-pitch-50 truncate">
                      <BionicText>{f.title || 'Untitled deep dive'}</BionicText>
                    </p>
                    <p className="font-mono text-2xs text-paper-500 dark:text-pitch-200 mt-1">
                      {f.capture_count} capture{f.capture_count === 1 ? '' : 's'}
                      {f.has_digest ? ' · pulled together' : ''}
                      {' · '}touched {formatDistanceToNow(new Date(f.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                  {f.topics?.length > 0 && (
                    <div className="hidden sm:flex flex-wrap gap-1 justify-end max-w-[40%]">
                      {f.topics.map((t) => (
                        <span key={t.id} className="px-2 py-0.5 rounded-full text-2xs
                                                    bg-paper-300 dark:bg-pitch-600
                                                    text-paper-700 dark:text-pitch-100">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EmptyState({ onStart, creating }) {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl
                      bg-paper-200 dark:bg-pitch-700 mb-4">
        <FileText size={22} className="text-paper-500 dark:text-pitch-200" />
      </div>
      <p className="font-display text-base text-pitch-800 dark:text-pitch-50 mb-1">
        No deep dives yet
      </p>
      <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 max-w-sm mx-auto mb-5 leading-relaxed">
        Start one when you fall down a research rabbit hole. Drop in links, notes
        and files as you go, then pull them together when you are ready.
      </p>
      <button
        onClick={onStart}
        disabled={creating}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                   bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
      >
        {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        New deep dive
      </button>
    </div>
  )
}
