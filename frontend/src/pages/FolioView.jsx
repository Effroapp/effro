import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, BookOpen, Plus, Pencil, Check, X,
  RefreshCw, Sparkles, Link2, PenLine, FileText, Image as ImageIcon,
  Loader2, Trash2, Layers, History,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import PageShell from '../components/PageShell'
import FolioRail from '../components/FolioRail'
import FolioFiledUnder from '../components/FolioFiledUnder'
import Logo from '../components/Logo'
import { folioApi } from '../api/client'
import { BionicText } from '../utils/bionic.jsx'
import { parseUTC } from '../utils/time.js'

// Brand tones cycled across section kickers and topic chips, so the piece has
// a little colour variety while mint stays the lead accent (first in the cycle).
const SECTION_TONES = [
  { bar: 'bg-mint', text: 'text-mint-700 dark:text-mint-300' },
  { bar: 'bg-sage', text: 'text-sage' },
  { bar: 'bg-sky-muted', text: 'text-sky-muted' },
  { bar: 'bg-mustard', text: 'text-mustard' },
  { bar: 'bg-lavender', text: 'text-lavender' },
]
const TOPIC_TONES = [
  'bg-mint/10 border-mint/20 text-mint-700 dark:text-mint-300',
  'bg-sage/10 border-sage/25 text-sage',
  'bg-sky-muted/10 border-sky-muted/25 text-sky-muted',
  'bg-mustard/10 border-mustard/25 text-mustard',
  'bg-lavender/10 border-lavender/25 text-lavender',
]

// Subtle paper grain for the reading sheet (a generic fractal-noise SVG, used
// only as a faint texture, never content).
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

const isUrl = (s) => /^https?:\/\/\S+$/i.test((s || '').trim())

function readingTime(digest) {
  if (!digest) return 1
  const words = [
    digest.summary || '',
    ...(digest.sections || []).flatMap((s) => [s.heading || '', s.body || '', s.quote?.text || '']),
    ...(digest.key_points || []),
    ...(digest.sources || []),
    ...(digest.open_threads || []),
  ].join(' ').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

// Where a capture came from, for quote attributions and figure captions.
function captureLabel(c) {
  if (!c) return null
  const m = c.source_meta || {}
  if (c.type === 'link') return m.domain || m.title || 'a link'
  if (c.type === 'file') return m.original_name || 'a document'
  if (c.type === 'image') return m.original_name || 'an image'
  return 'a note'
}

export default function FolioView() {
  const { folioId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [folio, setFolio] = useState(null)
  const [view, setView] = useState('read')       // read | captures
  const [pulling, setPulling] = useState(false)
  const [related, setRelated] = useState([])
  const noteRef = useRef(null)

  const load = useCallback(() => {
    folioApi.get(folioId)
      .then(setFolio)
      .catch((e) => { toast(e.message || 'Could not open this folio', 'error'); navigate('/folios') })
  }, [folioId, navigate, toast])
  useEffect(() => { load() }, [load])

  // Related threads power one rail widget; fetched lazily so the digest never
  // waits on the workspace scan. Refreshed after a pull (new digest text can
  // change the matches).
  const loadRelated = useCallback(() => {
    folioApi.related(folioId).then((r) => setRelated(r || [])).catch(() => {})
  }, [folioId])
  useEffect(() => { loadRelated() }, [loadRelated])

  const focusAdd = () => {
    setView('captures')
    setTimeout(() => noteRef.current?.focus(), 60)
  }

  const pullTogether = async () => {
    setPulling(true)
    try {
      await folioApi.pullTogether(folioId)
      await new Promise((r) => setTimeout(r, 30))
      load()
      loadRelated()
      setView('read')
      toast('Pulled together. This is your work.')
    } catch (e) {
      toast(e.message || 'Could not pull it together just now', 'error')
    } finally {
      setPulling(false)
    }
  }

  if (!folio) {
    return (
      <PageShell bodyClassName="py-24">
        <div className="flex justify-center text-paper-500 dark:text-pitch-200">
          <Loader2 size={22} className="animate-spin" />
        </div>
      </PageShell>
    )
  }

  const capCount = folio.captures.length

  // The rail only earns its column when it has something to show. Computed here
  // (not inside the rail) so an empty rail doesn't reserve dead grid space.
  const dg = folio.digest
  const railHasContent = !!dg && (
    (dg.tensions || []).length > 0 ||
    (dg.key_points || []).length > 0 ||
    (dg.key_terms || []).length > 0 ||
    folio.captures.some((c) => c.type === 'link' && c.raw_content) ||
    related.length > 0
  )

  return (
    <PageShell
      bodyClassName="py-8"
      header={
        <>
          {/* Back */}
          <button
            onClick={() => navigate('/folios')}
            className="inline-flex items-center gap-1.5 text-sm text-paper-500 dark:text-pitch-200
                       hover:text-pitch-800 dark:hover:text-pitch-50 px-2 py-1 -ml-2 rounded-md
                       hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors"
          >
            <ChevronLeft size={15} /> Folios
          </button>

          {/* Header: the dive's icon (mint accent chip) + editable title + meta.
              The view toggle and Add live on their own row below, so the title
              gets the full width instead of being squeezed by the actions. */}
          <div className="mt-3">
            <PageHeader
              icon={BookOpen}
              accent
              title={<TitleField folio={folio} onSaved={setFolio} />}
              subtitle={
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-2xs text-paper-500 dark:text-pitch-200">
                  {(folio.topics || []).map((t, i) => (
                    <span key={t.id} className={`px-2 py-0.5 rounded-full border ${TOPIC_TONES[i % TOPIC_TONES.length]}`}>
                      {t.name}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1"><Layers size={11} /> {capCount} capture{capCount === 1 ? '' : 's'}</span>
                  <span className="opacity-50">·</span>
                  <span>updated {formatDistanceToNow(parseUTC(folio.updated_at), { addSuffix: true })}</span>
                </span>
              }
            />
          </div>
        </>
      }
    >
      {/* Toolbar: view toggle + where the dive is filed + always-visible Add. */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex bg-paper-200 dark:bg-pitch-700 rounded-lg p-0.5 gap-0.5">
            <Tab on={view === 'read'} onClick={() => setView('read')}><BookOpen size={13} /> Read</Tab>
            <Tab on={view === 'captures'} onClick={() => setView('captures')}>
              Captures <span className="text-paper-500 dark:text-pitch-200">{capCount}</span>
            </Tab>
          </div>
          <FolioFiledUnder folio={folio} onSaved={setFolio} />
        </div>
        <button
          onClick={focusAdd}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium
                     bg-paper-50 dark:bg-pitch-600 border border-paper-400 dark:border-pitch-400
                     text-pitch-800 dark:text-pitch-50 hover:border-mint/40 hover:bg-mint/5
                     transition-colors"
        >
          <Plus size={15} className="text-mint" /> Add capture
        </button>
      </div>

      {/* Read view with a populated rail becomes a magazine spread: the digest
          on the left, grounded widgets filling the right. The rail is sticky
          on wide screens and drops below the digest on narrow ones. Everything
          else (captures, the empty/edit states) keeps the centred measure. */}
      {view === 'read' && railHasContent ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_19rem] gap-6 items-start">
          <div className="min-w-0">
            <ReadView folio={folio} onReload={load} onPull={pullTogether} pulling={pulling} onGoCaptures={focusAdd} />
          </div>
          {/* mt-5 matches the article card's own top margin so the rail and
              the digest share a baseline (they're separate grid columns). */}
          <div className="mt-5 xl:sticky xl:top-6">
            <FolioRail folio={folio} related={related} />
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto">
          {view === 'read'
            ? <ReadView folio={folio} onReload={load} onPull={pullTogether} pulling={pulling} onGoCaptures={focusAdd} />
            : <CapturesView folio={folio} onReload={load} onPull={pullTogether} pulling={pulling} noteRef={noteRef} />}
        </div>
      )}
    </PageShell>
  )
}

function Tab({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md font-mono text-2xs uppercase tracking-wider
                  transition-colors ${
        on
          ? 'bg-paper-50 dark:bg-pitch-500 text-pitch-800 dark:text-pitch-50 shadow-sm'
          : 'text-paper-500 dark:text-pitch-200 hover:text-pitch-700 dark:hover:text-pitch-100'
      }`}
    >
      {children}
    </button>
  )
}

function TitleField({ folio, onSaved }) {
  const [value, setValue] = useState(folio.title || '')
  useEffect(() => { setValue(folio.title || '') }, [folio.title])
  const save = async () => {
    const next = value.trim()
    if (next === (folio.title || '')) return
    try {
      const updated = await folioApi.update(folio.id, { title: next })
      onSaved((f) => ({ ...f, title: updated.title }))
    } catch { /* keep typed value; non-fatal */ }
  }
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      placeholder="Untitled deep dive"
      spellCheck={false}
      aria-label="Folio title"
      className="w-full min-w-0 font-display font-semibold text-xl tracking-[-0.01em]
                 text-pitch-800 dark:text-pitch-50 bg-transparent border-0 outline-none
                 px-1.5 -mx-1.5 py-0.5 rounded-md hover:bg-paper-200 dark:hover:bg-pitch-700
                 focus:ring-2 focus:ring-mint-500 transition-shadow placeholder:text-paper-400 dark:placeholder:text-pitch-300"
    />
  )
}

// ─── Read view: the reading sheet ─────────────────────────────────────────────

function ReadView({ folio, onReload, onPull, pulling, onGoCaptures }) {
  const [editing, setEditing] = useState(false)
  const [zoom, setZoom] = useState(null)   // {src, caption} of the image being viewed
  const digest = folio.digest

  if (!digest) {
    return (
      <div className="mt-5 rounded-2xl bg-paper-50 dark:bg-pitch-700/60 border border-paper-300 dark:border-pitch-400 p-10 text-center">
        <Sparkles size={22} className="mx-auto text-mint mb-3" />
        <p className="font-display text-base text-pitch-800 dark:text-pitch-50 mb-1">Nothing pulled together yet</p>
        <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 max-w-sm mx-auto mb-5 leading-relaxed">
          Add a few captures, then pull them together into one clear digest. It stays your work, drawn
          from your own material.
        </p>
        {folio.captures.length > 0 ? (
          <button onClick={onPull} disabled={pulling}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium
                       bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors">
            {pulling ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Pull it together
          </button>
        ) : (
          <button onClick={onGoCaptures}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium
                       bg-mint-700 hover:bg-mint-800 text-white transition-colors">
            <Plus size={15} /> Add your first capture
          </button>
        )}
      </div>
    )
  }

  if (editing) {
    return <DigestEditor folio={folio} onDone={() => { setEditing(false); onReload() }} onCancel={() => setEditing(false)} />
  }

  const mins = readingTime(digest)
  const capturesById = Object.fromEntries((folio.captures || []).map((c) => [c.id, c]))
  const sections = digest.sections || []
  // Hero: the first captured image no section claims for itself. Shown even on
  // digests pulled before sections existed - a captured image always earns a
  // place on the page.
  const sectionImageIds = new Set(sections.map((s) => s.image).filter(Boolean))
  const hero = (folio.captures || []).find(
    (c) => c.type === 'image' && c.raw_content && !sectionImageIds.has(c.id),
  ) || (folio.captures || []).find((c) => c.type === 'image' && c.raw_content)

  return (
    <>
    <article
      className="effro-rise relative mt-5 rounded-2xl bg-paper-50 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400
                 shadow-sm px-7 sm:px-11 py-9 overflow-hidden"
    >
      <div aria-hidden className="absolute inset-0 pointer-events-none opacity-[0.045] dark:opacity-[0.03] mix-blend-multiply dark:mix-blend-screen"
           style={{ backgroundImage: GRAIN }} />
      {/* The whole piece sits in one centred reading measure, so the sheet
          reads like a magazine column rather than text pinned to the left
          edge of a wide card. */}
      <div className="relative max-w-[46rem] mx-auto">
        {/* Masthead: the Effro mark + kicker, the headline, then an issue line
            (when it was pulled together, read time, sources drawn on). */}
        <div className="flex items-start justify-between gap-3">
          <span className="group inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.22em] text-mint-700 dark:text-mint-300">
            <Logo size={15} /> Deep dive digest
          </span>
          <button onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 text-xs text-paper-500 dark:text-pitch-200
                       hover:text-pitch-800 dark:hover:text-pitch-50 px-2 py-1 rounded-md
                       hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors flex-shrink-0">
            <Pencil size={13} /> Edit
          </button>
        </div>
        <h1 className="font-display font-semibold text-[1.75rem] leading-[1.2] tracking-[-0.02em] text-pitch-800 dark:text-pitch-50 mt-3">
          {digest.headline || 'Your deep dive, pulled together'}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 font-mono text-2xs text-paper-500 dark:text-pitch-200">
          {digest.generated_at && (
            <>
              <span>{format(parseUTC(digest.generated_at), 'd MMM yyyy')}</span>
              <span className="opacity-40">·</span>
            </>
          )}
          <span>{mins} min read</span>
          <span className="opacity-40">·</span>
          <span>{folio.captures.length} source{folio.captures.length === 1 ? '' : 's'}</span>
        </div>
        <div className="border-t-2 border-pitch-800/80 dark:border-pitch-50/70 mt-4 mb-0.5" />
        <div className="border-t border-paper-300 dark:border-pitch-400 mb-6" />

        {folio.new_capture_count > 0 && (
          <div className="flex items-center gap-2.5 mb-5 font-mono text-2xs text-paper-700 dark:text-pitch-100">
            <span><b className="font-medium text-pitch-800 dark:text-pitch-50">{folio.new_capture_count} new capture{folio.new_capture_count === 1 ? '' : 's'}</b> since you pulled this together</span>
            <button onClick={onPull} disabled={pulling}
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-pitch-800 dark:hover:text-pitch-50 disabled:opacity-50">
              {pulling ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
            </button>
          </div>
        )}

        {/* Hero: the dive's first image. Padded off the masthead rule, framed,
            and object-contain so the whole image shows (never cropped) - a
            captured diagram is usually the point, so it must be readable. */}
        {hero && (
          <figure className="mt-2 mb-7">
            <button type="button" aria-label="View image larger"
              onClick={() => setZoom({ src: `/uploads/${hero.raw_content}`, caption: hero.source_meta?.original_name })}
              className="block w-full cursor-zoom-in rounded-xl overflow-hidden
                         border border-paper-300 dark:border-pitch-400 bg-paper-100 dark:bg-pitch-800">
              <img
                src={`/uploads/${hero.raw_content}`}
                alt={captureLabel(hero) || ''}
                loading="lazy"
                className="w-full max-h-[28rem] object-contain"
              />
            </button>
            {hero.source_meta?.original_name && (
              <figcaption className="mt-2 flex items-center gap-2 font-mono text-2xs text-paper-500 dark:text-pitch-200">
                <span className="text-mint-700 dark:text-mint-300">Figure</span>
                <span className="opacity-40">·</span>
                {hero.source_meta.original_name}
              </figcaption>
            )}
          </figure>
        )}

        {/* Lede with a drop cap */}
        {digest.summary && (
          <p className="font-lexend text-[16.5px] leading-[1.68] text-pitch-800 dark:text-pitch-50 mb-6
                        first-letter:float-left first-letter:font-display first-letter:font-semibold
                        first-letter:text-[3.2em] first-letter:leading-[0.82] first-letter:pr-3 first-letter:pt-1.5
                        first-letter:text-mint-700 dark:first-letter:text-mint-300">
            <BionicText>{digest.summary}</BionicText>
          </p>
        )}

        {/* The body of the piece: themed sections with pull quotes and figures,
            everything traceable to a capture (quotes verified verbatim). */}
        {sections.map((sec, i) => (
          <section key={i} className="mb-8">
            {sec.heading && (
              <>
                {/* A numbered kicker lifts each section title off the page; the
                    tone cycles through the brand palette for gentle variety. */}
                <div className="flex items-center gap-2.5 mb-2" aria-hidden>
                  <span className={`h-[3px] w-7 rounded-full ${SECTION_TONES[i % SECTION_TONES.length].bar}`} />
                  <span className={`font-mono text-2xs tracking-[0.18em] ${SECTION_TONES[i % SECTION_TONES.length].text}`}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h2 className="font-display font-semibold text-xl tracking-[-0.015em] text-pitch-800 dark:text-pitch-50 mb-3">
                  {sec.heading}
                </h2>
              </>
            )}
            {(sec.body || '').split(/\n{2,}/).map((para, j) => (
              <p key={j} className="font-lexend text-[15px] leading-[1.7] text-pitch-800 dark:text-pitch-50 mb-3">
                <BionicText>{para}</BionicText>
              </p>
            ))}
            {sec.quote?.text && (
              <blockquote className="my-5 pl-5 border-l-[3px] border-mint">
                <p className="font-display text-xl leading-snug tracking-[-0.01em] text-pitch-800 dark:text-pitch-50">
                  “{sec.quote.text}”
                </p>
                {capturesById[sec.quote.capture] && (
                  <cite className="block mt-1.5 font-mono text-2xs not-italic text-paper-500 dark:text-pitch-200">
                    from {captureLabel(capturesById[sec.quote.capture])}
                  </cite>
                )}
              </blockquote>
            )}
            {sec.image && capturesById[sec.image]?.raw_content && (
              <figure className="my-6">
                <button type="button" aria-label="View image larger"
                  onClick={() => setZoom({ src: `/uploads/${capturesById[sec.image].raw_content}`, caption: capturesById[sec.image].source_meta?.original_name })}
                  className="block w-full cursor-zoom-in rounded-xl overflow-hidden
                             border border-paper-300 dark:border-pitch-400 bg-paper-100 dark:bg-pitch-800">
                  <img
                    src={`/uploads/${capturesById[sec.image].raw_content}`}
                    alt={captureLabel(capturesById[sec.image]) || ''}
                    loading="lazy"
                    className="w-full max-h-80 object-contain"
                  />
                </button>
                {capturesById[sec.image].source_meta?.original_name && (
                  <figcaption className="mt-2 flex items-center gap-2 font-mono text-2xs text-paper-500 dark:text-pitch-200">
                    <span className="text-mint-700 dark:text-mint-300">Figure</span>
                    <span className="opacity-40">·</span>
                    {capturesById[sec.image].source_meta.original_name}
                  </figcaption>
                )}
              </figure>
            )}
          </section>
        ))}

        <Section title="Key points" count={digest.key_points?.length} defaultOpen={sections.length === 0}>
          <ul className="flex flex-col gap-2.5">
            {digest.key_points.map((p, i) => (
              <li key={i} className="relative pl-4 font-lexend text-sm leading-relaxed text-pitch-800 dark:text-pitch-50
                                     before:content-[''] before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-sage">
                {p}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Sources" count={digest.sources?.length}>
          <ul className="flex flex-col gap-2.5">
            {digest.sources.map((s, i) => (
              <li key={i} className="font-lexend text-sm text-paper-700 dark:text-pitch-100 flex items-center gap-2">
                <Link2 size={13} className="text-paper-500 dark:text-pitch-200 flex-shrink-0" /> {s}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Open threads" count={digest.open_threads?.length}>
          <ul className="flex flex-col gap-2.5">
            {digest.open_threads.map((t, i) => (
              <li key={i} className="relative pl-4 font-lexend text-sm leading-relaxed text-pitch-800 dark:text-pitch-50
                                     before:content-[''] before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-muted">
                {t}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </article>
    {zoom && <Lightbox src={zoom.src} caption={zoom.caption} onClose={() => setZoom(null)} />}
    </>
  )
}

// Tap any article image to view it larger. A simple modal lightbox: Esc or a
// backdrop click closes it, body scroll is locked while open. The image is
// local (/uploads), shown in-app rather than opened externally.
function Lightbox({ src, caption, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Image viewer"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-12 bg-pitch-900/85 backdrop-blur-sm">
      <button onClick={onClose} aria-label="Close image"
        className="absolute top-4 right-4 p-2 rounded-lg text-paper-100 hover:bg-white/10 transition-colors">
        <X size={20} />
      </button>
      <figure onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-3 max-w-6xl">
        <img src={src} alt={caption || ''} className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl" />
        {caption && <figcaption className="font-mono text-2xs text-paper-200">{caption}</figcaption>}
      </figure>
    </div>
  )
}

function Section({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-paper-300 dark:border-pitch-400">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 py-3.5 px-0.5 font-mono text-2xs uppercase tracking-[0.1em]
                   text-pitch-800 dark:text-pitch-50">
        <ChevronRight size={14} className={`text-paper-500 dark:text-pitch-200 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        {title} {count != null && <span className="text-paper-500 dark:text-pitch-200">{count}</span>}
      </button>
      {open && <div className="pb-4 pl-6 pr-0.5">{children}</div>}
    </div>
  )
}

// ─── Digest editor (edit any section in place; preserved on the next pull) ────

function DigestEditor({ folio, onDone, onCancel }) {
  const toast = useToast()
  const d = folio.digest
  const [headline, setHeadline] = useState(d.headline || '')
  const [summary, setSummary] = useState(d.summary || '')
  // Full section objects ride through the editor; only heading/body are
  // editable here, so a section's pull quote and figure survive an edit.
  const [sections, setSections] = useState(d.sections || [])
  const [keyPoints, setKeyPoints] = useState(d.key_points || [])
  const [sources, setSources] = useState(d.sources || [])
  const [openThreads, setOpenThreads] = useState(d.open_threads || [])
  const [saving, setSaving] = useState(false)
  // Image captures available to place in sections (plus any uploaded mid-edit).
  const [imgs, setImgs] = useState(() => (folio.captures || []).filter((c) => c.type === 'image' && c.raw_content))
  const [uploadingFor, setUploadingFor] = useState(null)
  const imgById = Object.fromEntries(imgs.map((c) => [c.id, c]))
  const imgName = (c) => c.source_meta?.original_name || 'Image'
  const setImage = (i, captureId) =>
    setSections((prev) => prev.map((s, j) => (j === i ? { ...s, image: captureId || undefined } : s)))
  const uploadFor = async (i, file) => {
    if (!file) return
    setUploadingFor(i)
    try {
      const cap = await folioApi.uploadCapture(folio.id, file)
      setImgs((prev) => [...prev, cap])
      setImage(i, cap.id)
    } catch (e) {
      toast(e.message || 'Could not add that image', 'error')
    } finally {
      setUploadingFor(null)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await folioApi.editDigest(folio.id, {
        headline,
        summary,
        sections: sections.filter((s) => (s.body || '').trim()),
        key_points: keyPoints.filter((s) => s.trim()),
        sources: sources.filter((s) => s.trim()),
        open_threads: openThreads.filter((s) => s.trim()),
      })
      toast('Your edits are saved.')
      onDone()
    } catch (e) {
      toast(e.message || 'Could not save your edits', 'error')
      setSaving(false)
    }
  }

  return (
    <div className="mt-5 rounded-2xl bg-paper-50 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400 shadow-sm px-7 sm:px-9 py-7">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-2xs uppercase tracking-[0.18em] text-mint-700 dark:text-mint-300">Editing your digest</span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={saving}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-paper-700 dark:text-pitch-100
                       hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors"><X size={14} /> Cancel</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium
                       bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        </div>
      </div>
      <FieldLabel>Headline</FieldLabel>
      <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140}
        placeholder="A title for the piece"
        className="w-full mb-5 px-3 py-2 rounded-lg font-display font-medium text-sm
                   bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-400
                   text-pitch-800 dark:text-pitch-50 focus:outline-none focus:ring-2 focus:ring-mint-500" />

      <FieldLabel>Summary</FieldLabel>
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={5}
        className="w-full mb-5 px-3 py-2 rounded-lg font-lexend text-sm leading-relaxed resize-y
                   bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-400
                   text-pitch-800 dark:text-pitch-50 focus:outline-none focus:ring-2 focus:ring-mint-500" />

      {/* Sections: heading + body editable; a section's quote and figure are
          kept as they are and follow the section through the edit. */}
      <div className="mb-5">
        <FieldLabel>Sections</FieldLabel>
        <div className="flex flex-col gap-4">
          {sections.map((sec, i) => (
            <div key={i} className="rounded-lg border border-paper-300 dark:border-pitch-400 p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={sec.heading || ''}
                  onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, heading: e.target.value } : s)))}
                  placeholder="Section heading"
                  className="flex-1 px-3 py-1.5 rounded-lg font-display font-medium text-sm bg-paper-100 dark:bg-pitch-800
                             border border-paper-300 dark:border-pitch-400 text-pitch-800 dark:text-pitch-50
                             focus:outline-none focus:ring-2 focus:ring-mint-500"
                />
                <button onClick={() => setSections(sections.filter((_, j) => j !== i))}
                  aria-label="Remove section"
                  className="p-1.5 rounded-md text-paper-500 dark:text-pitch-200 hover:text-terracotta hover:bg-terracotta/10 transition-colors">
                  <X size={14} />
                </button>
              </div>
              <textarea
                value={sec.body || ''}
                onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)))}
                rows={4}
                className="w-full px-3 py-2 rounded-lg font-lexend text-sm leading-relaxed resize-y
                           bg-paper-100 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-400
                           text-pitch-800 dark:text-pitch-50 focus:outline-none focus:ring-2 focus:ring-mint-500"
              />
              {/* Figure: pick which captured image sits in this section, swap
                  it, clear it, or upload a new one straight into the section.
                  An image left unplaced becomes the digest's hero. */}
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                {sec.image && imgById[sec.image] && (
                  <img src={`/uploads/${imgById[sec.image].raw_content}`} alt=""
                    className="w-12 h-9 rounded object-contain bg-paper-200 dark:bg-pitch-800 border border-paper-300 dark:border-pitch-400" />
                )}
                <select
                  value={sec.image || ''}
                  onChange={(e) => setImage(i, Number(e.target.value) || undefined)}
                  aria-label="Section image"
                  className="font-mono text-2xs px-2 py-1.5 rounded-md bg-paper-100 dark:bg-pitch-800
                             border border-paper-300 dark:border-pitch-400 text-pitch-800 dark:text-pitch-50
                             focus:outline-none focus:ring-2 focus:ring-mint-500"
                >
                  <option value="">No image</option>
                  {imgs.map((c) => <option key={c.id} value={c.id}>{imgName(c)}</option>)}
                </select>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer font-mono text-2xs
                                  border border-paper-300 dark:border-pitch-400 text-paper-600 dark:text-pitch-100
                                  hover:border-mint/40 hover:text-pitch-800 dark:hover:text-pitch-50 transition-colors">
                  <ImageIcon size={12} /> {uploadingFor === i ? 'Uploading…' : 'Upload'}
                  <input type="file" accept="image/*" className="hidden" disabled={uploadingFor !== null}
                    onChange={(e) => { uploadFor(i, e.target.files?.[0]); e.target.value = '' }} />
                </label>
                {sec.quote?.text && (
                  <span className="font-mono text-2xs text-paper-500 dark:text-pitch-200">keeps its pull quote</span>
                )}
              </div>
            </div>
          ))}
          <button onClick={() => setSections([...sections, { heading: '', body: '' }])}
            className="inline-flex items-center gap-1.5 text-xs text-paper-600 dark:text-pitch-100
                       hover:text-pitch-800 dark:hover:text-pitch-50 px-1 py-1 self-start transition-colors">
            <Plus size={13} /> Add section
          </button>
        </div>
      </div>

      <ListEditor label="Key points" items={keyPoints} setItems={setKeyPoints} />
      <ListEditor label="Sources" items={sources} setItems={setSources} />
      <ListEditor label="Open threads" items={openThreads} setItems={setOpenThreads} />
    </div>
  )
}

function FieldLabel({ children }) {
  return <p className="font-mono text-2xs uppercase tracking-wider text-paper-500 dark:text-pitch-200 mb-1.5">{children}</p>
}

function ListEditor({ label, items, setItems }) {
  const set = (i, v) => setItems(items.map((x, j) => (j === i ? v : x)))
  const remove = (i) => setItems(items.filter((_, j) => j !== i))
  return (
    <div className="mb-5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={it} onChange={(e) => set(i, e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg font-lexend text-sm bg-paper-100 dark:bg-pitch-800
                         border border-paper-300 dark:border-pitch-400 text-pitch-800 dark:text-pitch-50
                         focus:outline-none focus:ring-2 focus:ring-mint-500" />
            <button onClick={() => remove(i)} className="p-1.5 rounded-md text-paper-500 dark:text-pitch-200
                       hover:text-terracotta hover:bg-terracotta/10 transition-colors"><X size={14} /></button>
          </div>
        ))}
        <button onClick={() => setItems([...items, ''])}
          className="inline-flex items-center gap-1.5 text-xs text-paper-600 dark:text-pitch-100
                     hover:text-pitch-800 dark:hover:text-pitch-50 px-1 py-1 self-start transition-colors">
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  )
}

// ─── Captures view: the working area ──────────────────────────────────────────

const CAP_META = {
  link: { Icon: Link2, cls: 'bg-sky-muted' },
  note: { Icon: PenLine, cls: 'bg-sage' },
  file: { Icon: FileText, cls: 'bg-paper-500 dark:bg-pitch-500' },
  image: { Icon: ImageIcon, cls: 'bg-gradient-to-br from-sky-muted to-sage' },
}

function captureTitle(c) {
  const m = c.source_meta || {}
  if (c.type === 'link') return m.title || m.domain || c.raw_content
  if (c.type === 'file') return m.original_name || 'Document'
  if (c.type === 'image') return m.original_name || 'Image'
  return c.raw_content || 'Note'
}

function CapturesView({ folio, onReload, onPull, pulling, noteRef }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const addNote = async () => {
    const v = note.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      await folioApi.addCapture(folio.id, isUrl(v) ? { type: 'link', url: v } : { type: 'note', text: v })
      setNote('')
      onReload()
    } catch (e) {
      toast(e.message || 'Could not add that', 'error')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const f of files) await folioApi.uploadCapture(folio.id, f)
      onReload()
    } catch (e) {
      toast(e.message || 'Could not add that file', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeCapture = async (id) => {
    try { await folioApi.deleteCapture(folio.id, id); onReload() }
    catch (e) { toast(e.message || 'Could not remove that capture', 'error') }
  }

  const caps = [...folio.captures].reverse()      // newest first in the working area

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="font-mono text-2xs uppercase tracking-widest text-paper-500 dark:text-pitch-200">
          {folio.captures.length} capture{folio.captures.length === 1 ? '' : 's'} in this dive
        </span>
        <button onClick={onPull} disabled={pulling || folio.captures.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium
                     bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-40 transition-colors">
          {pulling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {folio.digest ? 'Pull it together again' : 'Pull it together'}
        </button>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Add a file or image: choose a file, or drop one here"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
        className={`rounded-xl border border-dashed p-5 text-center cursor-pointer mb-3 transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 ${
          dragOver ? 'border-mint bg-mint/5' : 'border-paper-400 dark:border-pitch-400 bg-paper-200 dark:bg-pitch-700 hover:bg-paper-300/60 dark:hover:bg-pitch-600'
        }`}
      >
        <input ref={fileRef} type="file" multiple className="hidden"
          onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
        <Plus size={20} className="mx-auto text-paper-500 dark:text-pitch-200" />
        <p className="font-lexend text-sm text-pitch-800 dark:text-pitch-50 mt-1.5">Drop anything in</p>
        <p className="font-mono text-2xs text-paper-500 dark:text-pitch-200 mt-0.5">a file, an image, or a screenshot</p>
      </div>

      {/* Note / link input */}
      <input
        ref={noteRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') addNote() }}
        placeholder="Add a note or paste a link"
        spellCheck={false}
        disabled={busy}
        className="w-full mb-4 px-3.5 py-2.5 rounded-lg font-lexend text-sm bg-paper-200 dark:bg-pitch-700
                   border border-paper-300 dark:border-pitch-400 text-pitch-800 dark:text-pitch-50
                   placeholder:text-paper-500 dark:placeholder:text-pitch-200
                   focus:outline-none focus:ring-2 focus:ring-mint-500 transition-shadow"
      />

      {/* Capture list */}
      {caps.length === 0 ? (
        <p className="font-lexend text-sm text-paper-600 dark:text-pitch-100 text-center py-8">
          Nothing captured yet. Drop in a link, a note or a file above.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {caps.map((c) => <CaptureRow key={c.id} c={c} onRemove={() => removeCapture(c.id)} />)}
        </div>
      )}
    </div>
  )
}

function CaptureRow({ c, onRemove }) {
  const meta = CAP_META[c.type] || CAP_META.note
  const Icon = meta.Icon
  const sm = c.source_meta || {}
  const sub = []
  if (c.type === 'link') sub.push(sm.domain || 'link')
  else if (c.type === 'file') sub.push('Document')
  else if (c.type === 'note') sub.push('Your note')
  else if (c.type === 'image') sub.push('Image')

  return (
    <div className="group flex gap-3 items-start rounded-xl bg-paper-200 dark:bg-pitch-700
                    border border-paper-300 dark:border-pitch-400 p-3 hover:border-paper-400 dark:hover:border-pitch-500 transition-colors">
      <span className={`flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center text-white ${meta.cls}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-lexend text-sm text-pitch-800 dark:text-pitch-50 leading-snug truncate">{captureTitle(c)}</p>
        <div className="font-mono text-2xs text-paper-500 dark:text-pitch-200 mt-1 flex items-center gap-1.5 flex-wrap">
          {sub.map((s, i) => <span key={i}>{s}</span>)}
          <span className="opacity-50">·</span>
          <span>{formatDistanceToNow(parseUTC(c.created_at), { addSuffix: true })}</span>
          {c.type === 'image' && (
            <span className={`px-1.5 py-0.5 rounded-full text-[9.5px] uppercase tracking-wide ${
              sm.vision_read ? 'bg-sage/15 text-sage' : 'bg-paper-300 dark:bg-pitch-600 text-paper-500 dark:text-pitch-200'
            }`}>
              {sm.vision_read ? 'text read' : 'not read'}
            </span>
          )}
          {c.type === 'link' && sm.error && (
            <span className="px-1.5 py-0.5 rounded-full text-[9.5px] uppercase tracking-wide bg-paper-300 dark:bg-pitch-600 text-paper-500 dark:text-pitch-200">
              link saved
            </span>
          )}
        </div>
      </div>
      <button onClick={onRemove} aria-label="Remove capture"
        className="flex-shrink-0 p-1.5 rounded-md text-paper-400 dark:text-pitch-300 opacity-0 group-hover:opacity-100
                   hover:text-terracotta hover:bg-terracotta/10 transition-all">
        <Trash2 size={14} />
      </button>
    </div>
  )
}
