import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Library, Plus, Search, ArrowRight, Tag, Layers,
  FileText, Image as ImageIcon, PenLine, Link2, Loader2,
  LayoutGrid, Grid2x2, Grid3x3, Rows3,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import PageHeader from '../components/PageHeader'
import IntroPanel, { Key } from '../components/IntroPanel'
import { useToast } from '../components/Toast'
import { folioApi } from '../api/client'
import { BionicText } from '../utils/bionic.jsx'
import { parseUTC } from '../utils/time.js'

/**
 * Folio index - your deep dives.
 *
 * A featured dive to pick up where you left off, then the rest, with search
 * across everything and manual topic chips. Rebuilt from
 * folio-index-mockup-3.html using the repo tokens and PageHeader. Calm, no
 * nagging: a quiet folio is normal and never chased.
 */
export default function FolioIndex() {
  const navigate = useNavigate()
  const toast = useToast()
  const [folios, setFolios] = useState(null)
  const [query, setQuery] = useState('')
  const [activeTopic, setActiveTopic] = useState('all')
  const [creating, setCreating] = useState(false)
  // View + sort persist per-user, so the shelf opens how they left it.
  const [view, setView] = useState(() => { try { return localStorage.getItem('folioView') || 'tiles' } catch { return 'tiles' } })
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('folioSort') || 'updated' } catch { return 'updated' } })
  const debounce = useRef(null)

  useEffect(() => { try { localStorage.setItem('folioView', view) } catch { /* ignore */ } }, [view])
  useEffect(() => { try { localStorage.setItem('folioSort', sort) } catch { /* ignore */ } }, [sort])

  const load = useCallback((q) => {
    folioApi.list(q)
      .then(setFolios)
      .catch((e) => { setFolios([]); toast(e.message || 'Could not load your folios', 'error') })
  }, [toast])

  useEffect(() => { load('') }, [load])

  // Debounced search - fast and forgiving, the way back to a quiet folio.
  const onSearch = (v) => {
    setQuery(v)
    setActiveTopic('all')
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(v.trim()), 220)
  }

  const newDive = async () => {
    setCreating(true)
    try {
      const f = await folioApi.create({})
      navigate(`/folios/${f.id}`)
    } catch (e) {
      toast(e.message || 'Could not start a deep dive', 'error')
      setCreating(false)
    }
  }

  // Manual topics for the filter chips, with a per-topic count.
  const topicCounts = {}
  ;(folios || []).forEach((f) => (f.topics || []).forEach((t) => { topicCounts[t.name] = (topicCounts[t.name] || 0) + 1 }))
  const topics = Object.keys(topicCounts).sort()

  const searching = query.trim().length > 0
  const filtered = (folios || []).filter(
    (f) => activeTopic === 'all' || (f.topics || []).some((t) => t.name === activeTopic),
  )
  const shown = [...filtered].sort((a, b) => {
    if (sort === 'title') return (a.title || 'Untitled deep dive').localeCompare(b.title || 'Untitled deep dive')
    const key = sort === 'created' ? 'created_at' : 'updated_at'
    return (parseUTC(b[key]) || 0) - (parseUTC(a[key]) || 0)
  })
  // The "pick up where you left off" hero is a Details-view flourish; the other
  // views are an even grid with no featured item.
  const featured = view === 'details' && !searching && activeTopic === 'all' ? shown[0] : null
  const rest = featured ? shown.slice(1) : shown
  const GRID_COLS = {
    tiles: 'repeat(auto-fill, minmax(230px, 1fr))',
    large: 'repeat(auto-fill, minmax(300px, 1fr))',
    small: 'repeat(auto-fill, minmax(190px, 1fr))',
    details: 'repeat(auto-fill, minmax(300px, 1fr))',
  }

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-pitch-800">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
        <PageHeader
          icon={Library}
          title="Folios"
          subtitle="Your deep dives, captured and kept."
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

        <IntroPanel icon={Library} title="A place for deep dives" storageKey="folioIntroDismissed">
          Folios are where you <Key>go deep</Key>. Capture the links, notes, files and images from a
          research rabbit hole into one place, then <Key>pull them together</Key> into one grounded,
          reading-first digest. It stays your work, <Key>drawn only from your own material</Key>.
        </IntroPanel>

        {/* Search */}
        <div className="flex items-center gap-2.5 max-w-md mb-5 px-3.5 py-2.5 rounded-xl
                        bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                        focus-within:ring-2 focus-within:ring-mint-500 transition-shadow">
          <Search size={16} className="text-paper-500 dark:text-pitch-200 flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search your deep dives"
            spellCheck={false}
            className="flex-1 bg-transparent border-0 outline-none font-lexend text-sm
                       text-pitch-800 dark:text-pitch-50 placeholder:text-paper-500 dark:placeholder:text-pitch-200"
          />
        </div>

        {/* Manual topic chips (no AI suggestions in v1) */}
        {topics.length > 0 && !searching && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <Chip on={activeTopic === 'all'} onClick={() => setActiveTopic('all')}>All</Chip>
            {topics.map((t) => (
              <Chip key={t} on={activeTopic === t} onClick={() => setActiveTopic(t)}>
                <Tag size={11} /> {t} <span className="opacity-60">{topicCounts[t]}</span>
              </Chip>
            ))}
          </div>
        )}

        {folios === null ? (
          <div className="flex justify-center py-20 text-paper-500 dark:text-pitch-200">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          searching
            ? <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 py-16 text-center">
                Nothing matched that. Try another word.
              </p>
            : <EmptyState onStart={newDive} creating={creating} />
        ) : (
          <>
            {/* Sort + view controls */}
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <SortSelect value={sort} onChange={setSort} />
              <ViewSwitch view={view} onChange={setView} />
            </div>

            {view === 'details' ? (
              <>
                {featured && <Hero folio={featured} onOpen={() => navigate(`/folios/${featured.id}`)} />}
                {rest.length > 0 && (
                  <>
                    {featured && (
                      <p className="font-mono text-2xs uppercase tracking-widest text-paper-500 dark:text-pitch-200 mt-7 mb-3 ml-0.5">
                        More deep dives
                      </p>
                    )}
                    <div className="grid gap-3.5" style={{ gridTemplateColumns: GRID_COLS.details }}>
                      {rest.map((f) => (
                        <DiveCard key={f.id} folio={f} onOpen={() => navigate(`/folios/${f.id}`)} />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="grid gap-3.5" style={{ gridTemplateColumns: GRID_COLS[view] }}>
                {shown.map((f) => {
                  const onOpen = () => navigate(`/folios/${f.id}`)
                  if (view === 'tiles') return <TileCard key={f.id} folio={f} onOpen={onOpen} />
                  if (view === 'small') return <SmallCard key={f.id} folio={f} onOpen={onOpen} />
                  return <DiveCard key={f.id} folio={f} onOpen={onOpen} />
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono text-2xs tracking-wide
                  border transition-colors ${
        on
          ? 'bg-mint/10 border-mint/30 text-mint-700 dark:text-mint-300'
          : 'bg-paper-200 dark:bg-pitch-700 border-paper-300 dark:border-pitch-400 text-paper-700 dark:text-pitch-100 hover:border-paper-400 dark:hover:border-pitch-500'
      }`}
    >
      {children}
    </button>
  )
}

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'title', label: 'A to Z' },
]

function SortSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Sort deep dives"
      className="font-mono text-2xs uppercase tracking-wide px-3 py-2 rounded-lg cursor-pointer
                 bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                 text-paper-700 dark:text-pitch-100 focus:outline-none focus:ring-2 focus:ring-mint-500"
    >
      {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  )
}

const VIEW_OPTS = [
  { key: 'tiles', Icon: LayoutGrid, label: 'Tiles' },
  { key: 'large', Icon: Grid2x2, label: 'Large cards' },
  { key: 'small', Icon: Grid3x3, label: 'Small cards' },
  { key: 'details', Icon: Rows3, label: 'Details' },
]

function ViewSwitch({ view, onChange }) {
  return (
    <div className="inline-flex bg-paper-200 dark:bg-pitch-700 rounded-lg p-0.5 gap-0.5
                    border border-paper-300 dark:border-pitch-400">
      {VIEW_OPTS.map(({ key, Icon, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          title={label}
          aria-label={label}
          aria-pressed={view === key}
          className={`p-1.5 rounded-md transition-colors ${
            view === key
              ? 'bg-paper-50 dark:bg-pitch-500 text-pitch-800 dark:text-pitch-50 shadow-sm'
              : 'text-paper-500 dark:text-pitch-200 hover:text-pitch-700 dark:hover:text-pitch-100'
          }`}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}

// Tiles view: cover-forward card - the whole thumbnail (contained, never
// cropped) over the title. The visual shelf.
function TileCard({ folio, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="group text-left flex flex-col rounded-2xl overflow-hidden
                 bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                 shadow-sm hover:-translate-y-0.5 hover:shadow-md hover:border-paper-400 dark:hover:border-pitch-500
                 transition-all motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="h-32 bg-paper-100 dark:bg-pitch-800 border-b border-paper-300 dark:border-pitch-400">
        {folio.thumb_url
          ? <img src={folio.thumb_url} alt="" loading="lazy" className="w-full h-full object-contain p-2" />
          : <div className="w-full h-full bg-gradient-to-br from-sky-muted to-sage opacity-80" />}
      </div>
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <span className="font-display font-semibold text-sm leading-snug text-pitch-800 dark:text-pitch-50 line-clamp-2">
          <BionicText>{folio.title || 'Untitled deep dive'}</BionicText>
        </span>
        <div className="mt-auto pt-1"><MetaLine folio={folio} /></div>
      </div>
    </button>
  )
}

// Small view: dense, title + meta only, many per screen.
function SmallCard({ folio, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="text-left flex flex-col gap-1.5 rounded-xl p-3
                 bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                 shadow-sm hover:border-paper-400 dark:hover:border-pitch-500 transition-colors"
    >
      <span className="font-display font-semibold text-sm leading-snug text-pitch-800 dark:text-pitch-50 line-clamp-2">
        {folio.title || 'Untitled deep dive'}
      </span>
      <MetaLine folio={folio} />
    </button>
  )
}

// The faces of what is inside a dive: real favicons for links, a type marker
// otherwise. Falls back to a letter tile if a favicon fails to load.
function Faces({ faces, count }) {
  if (!faces?.length) return null
  const shown = faces.slice(0, 5)
  const more = count - shown.length
  const TYPE_ICON = { note: PenLine, file: FileText, image: ImageIcon, link: Link2 }
  return (
    <div className="flex items-center gap-1.5">
      {shown.map((f, i) => {
        const Icon = TYPE_ICON[f.type] || Link2
        if (f.type === 'link' && f.favicon_url) {
          return (
            <img
              key={i} src={f.favicon_url} alt="" width={18} height={18} loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
              className="w-[18px] h-[18px] rounded-[5px] object-cover bg-paper-300 dark:bg-pitch-600"
            />
          )
        }
        return (
          <span key={i} className="w-[18px] h-[18px] rounded-[5px] grid place-items-center
                                   bg-paper-300 dark:bg-pitch-600 text-paper-600 dark:text-pitch-100">
            <Icon size={11} />
          </span>
        )
      })}
      {more > 0 && <span className="font-mono text-2xs text-paper-500 dark:text-pitch-200">+{more}</span>}
    </div>
  )
}

function MetaLine({ folio }) {
  return (
    <span className="font-mono text-2xs text-paper-500 dark:text-pitch-200 inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1">
        <Layers size={11} /> {folio.capture_count} capture{folio.capture_count === 1 ? '' : 's'}
      </span>
      <span>·</span>
      <span>{formatDistanceToNow(parseUTC(folio.updated_at), { addSuffix: true })}</span>
    </span>
  )
}

function TopicTag({ name }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-2xs
                     bg-paper-300 dark:bg-pitch-600 text-paper-700 dark:text-pitch-100">
      <Tag size={9} className="opacity-60" /> {name}
    </span>
  )
}

function Hero({ folio, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left flex flex-col sm:flex-row gap-5 rounded-2xl p-5
                 bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                 shadow-sm hover:-translate-y-0.5 hover:shadow-md hover:border-paper-400 dark:hover:border-pitch-500
                 transition-all motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="flex-1 min-w-0">
        <span className="inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-widest text-mint-700 dark:text-mint-300">
          <ArrowRight size={12} className="text-mint" /> Pick up where you left off
        </span>
        <h2 className="font-display font-semibold text-xl tracking-[-0.01em] text-pitch-800 dark:text-pitch-50 mt-2 mb-2">
          <BionicText>{folio.title || 'Untitled deep dive'}</BionicText>
        </h2>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {(folio.topics || []).map((t) => <TopicTag key={t.id} name={t.name} />)}
          <MetaLine folio={folio} />
        </div>
        {folio.snippet && (
          <p className="font-lexend text-sm leading-relaxed text-paper-700 dark:text-pitch-100 mb-3 line-clamp-3">
            {folio.snippet}
          </p>
        )}
        <Faces faces={folio.faces} count={folio.capture_count} />
      </div>
      <div className="sm:w-48 flex-shrink-0 flex flex-col gap-3 sm:items-end">
        <Thumb folio={folio} />
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                         bg-paper-50 dark:bg-pitch-600 border border-paper-300 dark:border-pitch-400
                         text-pitch-800 dark:text-pitch-50">
          Open <ArrowRight size={14} />
        </span>
      </div>
    </button>
  )
}

function Thumb({ folio }) {
  if (folio.thumb_url) {
    // Framed (border + soft inner bg) and object-contain, so the whole image
    // reads as a deliberate thumbnail rather than a cropped fragment stuffed
    // into a box.
    return (
      <div className="w-full sm:w-48 h-32 rounded-xl overflow-hidden p-1.5
                      border border-paper-300 dark:border-pitch-400 bg-paper-100 dark:bg-pitch-800">
        <img src={folio.thumb_url} alt="" className="w-full h-full object-contain rounded-md" loading="lazy" />
      </div>
    )
  }
  // No image capture: a calm gradient, not an empty box.
  return <div className="w-full sm:w-48 h-32 rounded-xl border border-paper-300 dark:border-pitch-400 bg-gradient-to-br from-sky-muted to-sage opacity-80" />
}

function DiveCard({ folio, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="text-left flex flex-col gap-2.5 rounded-2xl p-4
                 bg-paper-200 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                 shadow-sm hover:-translate-y-0.5 hover:shadow-md hover:border-paper-400 dark:hover:border-pitch-500
                 transition-all motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-2.5">
        <span className="font-display font-semibold text-sm leading-snug text-pitch-800 dark:text-pitch-50">
          <BionicText>{folio.title || 'Untitled deep dive'}</BionicText>
        </span>
        {(folio.topics || [])[0] && <TopicTag name={folio.topics[0].name} />}
      </div>
      {folio.snippet && (
        <p className="font-lexend text-xs leading-relaxed text-paper-600 dark:text-pitch-200 line-clamp-2">
          {folio.snippet}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <Faces faces={folio.faces} count={folio.capture_count} />
        <MetaLine folio={folio} />
      </div>
    </button>
  )
}

function EmptyState({ onStart, creating }) {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-paper-200 dark:bg-pitch-700 mb-4">
        <Library size={22} className="text-paper-500 dark:text-pitch-200" />
      </div>
      <p className="font-display text-base text-pitch-800 dark:text-pitch-50 mb-1">No deep dives yet</p>
      <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 max-w-sm mx-auto mb-5 leading-relaxed">
        Start one when you fall down a research rabbit hole. Drop in links, notes and files as you go,
        then pull them together when you are ready.
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
