import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Split, Lightbulb, BookText, Link2, Network, ArrowRight, ExternalLink, ChevronDown,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { openExternal } from '../api/tauri'
import { parseUTC } from '../utils/time.js'

/**
 * The Folio reading rail: grounded widgets that fill the space beside the
 * digest. Everything here traces to the user's own captures, their digest, or
 * their workspace - never the open web.
 *
 * Built from an ordered registry. Each widget renders null when it has no
 * content, so a quiet dive shows a short rail (or none) rather than empty
 * cards. The registry is also the seam for a future "choose what to show"
 * preference: filter RAIL_ORDER by an enabled-set and the rest just works.
 */
const RAIL_ORDER = ['tensions', 'good', 'terms', 'sources', 'related']

export default function FolioRail({ folio, related = [] }) {
  const navigate = useNavigate()
  const d = folio.digest || {}
  const captures = folio.captures || []
  const sources = captures.filter((c) => c.type === 'link' && c.raw_content)

  const data = {
    tensions: d.tensions || [],
    good: d.key_points || [],
    terms: d.key_terms || [],
    sources,
    related,
  }
  const render = {
    tensions: () => <TensionsCard tensions={data.tensions} />,
    good: () => <GoodToKnowCard points={data.good} />,
    terms: () => <KeyTermsCard terms={data.terms} />,
    sources: () => <SourcesCard sources={data.sources} />,
    related: () => <RelatedThreadsCard threads={data.related} onOpen={(id) => navigate(`/thread/${id}`)} />,
  }

  const shown = RAIL_ORDER.filter((k) => (data[k] || []).length > 0)
  if (!shown.length) return null

  return (
    <div className="flex flex-col gap-3">
      {shown.map((k, i) => (
        <div key={k} className="effro-rise" style={{ animationDelay: `${i * 70}ms` }}>{render[k]()}</div>
      ))}
      <p className="text-center font-mono text-2xs tracking-wide text-paper-400 dark:text-pitch-300 pt-0.5">
        drawn only from your captures and workspace
      </p>
    </div>
  )
}

// ─── Shared card chrome ───────────────────────────────────────────────────────

function Card({ icon: Icon, iconClass, title, count, children, tight }) {
  return (
    <section className={`rounded-xl bg-paper-50 dark:bg-pitch-700 border border-paper-300 dark:border-pitch-400 px-3.5 pt-3 ${tight ? 'pb-1.5' : 'pb-3.5'}`}>
      <div className="flex items-center justify-between">
        <span className="eyebrow flex items-center gap-2 text-paper-500 dark:text-pitch-200">
          <Icon size={14} className={iconClass} strokeWidth={1.9} /> {title}
        </span>
        {count != null && <span className="font-mono text-2xs text-paper-400 dark:text-pitch-300">{count}</span>}
      </div>
      {children}
    </section>
  )
}

const SIDE_TONES = [
  { dot: 'bg-sky-muted', text: 'text-sky-muted' },
  { dot: 'bg-terracotta', text: 'text-terracotta' },
  { dot: 'bg-mustard', text: 'text-mustard' },
]

// Long lists stay calm: show the first `limit`, with a quiet toggle for the
// rest. Used by the unbounded widgets (Good to know, Sources).
function useCapped(items, limit) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, limit)
  return { shown, extra: items.length - limit, open, toggle: () => setOpen((o) => !o) }
}

function MoreToggle({ extra, open, onToggle }) {
  if (extra <= 0) return null
  return (
    <button onClick={onToggle}
      className="mt-2.5 inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-wider
                 text-paper-500 dark:text-pitch-200 hover:text-pitch-800 dark:hover:text-pitch-50 transition-colors">
      <ChevronDown size={12} className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      {open ? 'Show less' : `Show ${extra} more`}
    </button>
  )
}

// ─── Widgets ──────────────────────────────────────────────────────────────────

function TensionsCard({ tensions }) {
  return (
    <Card icon={Split} iconClass="text-mint" title="Where sources differ">
      <div className="mt-3 flex flex-col gap-3">
        {tensions.map((t, i) => (
          <div key={i} className={i > 0 ? 'border-t border-paper-200 dark:border-pitch-600 pt-3' : ''}>
            <p className="font-lexend text-xs leading-snug text-pitch-800 dark:text-pitch-50 mb-1.5">{t.point}</p>
            <div className="flex flex-col gap-1">
              {(t.sides || []).map((s, j) => {
                const tone = SIDE_TONES[j % SIDE_TONES.length]
                return (
                  <div key={j} className="flex items-start gap-2">
                    <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-[5px] ${tone.dot}`} />
                    <span className="text-xs leading-snug text-paper-600 dark:text-pitch-100">
                      {s.source && <span className={tone.text}>{s.source}</span>}
                      {s.source && ' — '}{s.stance}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function GoodToKnowCard({ points }) {
  const { shown, extra, open, toggle } = useCapped(points, 5)
  return (
    <Card icon={Lightbulb} iconClass="text-mustard" title="Good to know">
      <div className="mt-2.5 flex flex-col gap-2.5">
        {shown.map((p, i) => (
          <div key={i} className="flex gap-2.5 font-lexend text-xs leading-snug text-pitch-800 dark:text-pitch-50">
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-sage mt-[6px]" />{p}
          </div>
        ))}
      </div>
      <MoreToggle extra={extra} open={open} onToggle={toggle} />
    </Card>
  )
}

function KeyTermsCard({ terms }) {
  return (
    <Card icon={BookText} iconClass="text-lavender" title="Key terms">
      <div className="mt-2.5 flex flex-col gap-2.5">
        {terms.map((t, i) => (
          <div key={i}>
            <span className="font-medium text-xs text-mint-700 dark:text-mint-300">{t.term}</span>
            <p className="font-lexend text-xs leading-snug text-paper-600 dark:text-pitch-100 mt-0.5">{t.definition}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SourcesCard({ sources }) {
  const { shown, extra, open, toggle } = useCapped(sources, 5)
  return (
    <Card icon={Link2} iconClass="text-sky-muted" title="Sources" count={sources.length} tight>
      <div className="mt-2">
        {shown.map((c) => {
          const m = c.source_meta || {}
          const domain = m.domain || c.raw_content
          return (
            <button
              key={c.id}
              onClick={() => openExternal(c.raw_content)}
              className="group w-full flex items-center gap-2.5 px-1.5 -mx-1.5 py-1.5 rounded-lg
                         hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors text-left"
            >
              {m.favicon_url
                ? <img src={m.favicon_url} alt="" referrerPolicy="no-referrer"
                       className="flex-shrink-0 w-5 h-5 rounded bg-paper-200 dark:bg-pitch-600 object-contain" />
                : <span className="flex-shrink-0 w-5 h-5 rounded bg-paper-200 dark:bg-pitch-600 grid place-items-center text-2xs text-paper-500 dark:text-pitch-200">{(domain || '?')[0]?.toUpperCase()}</span>}
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-pitch-800 dark:text-pitch-50 truncate">{domain}</span>
                {m.title && <span className="block text-2xs text-paper-500 dark:text-pitch-300 truncate">{m.title}</span>}
              </span>
              <ExternalLink size={13} className="flex-shrink-0 text-paper-400 dark:text-pitch-300 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )
        })}
      </div>
      {extra > 0 && <div className="px-1.5 pb-1"><MoreToggle extra={extra} open={open} onToggle={toggle} /></div>}
    </Card>
  )
}

const STATUS_DOT = {
  open: 'bg-amber-muted',
  'in-progress': 'bg-sky-muted',
  resolved: 'bg-sage',
  parked: 'bg-paper-400 dark:bg-pitch-400',
}

function RelatedThreadsCard({ threads, onOpen }) {
  return (
    <Card icon={Network} iconClass="text-mint" title="Related threads" tight>
      <div className="mt-2">
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => onOpen(t.id)}
            className="group w-full flex items-start gap-2.5 px-1.5 -mx-1.5 py-1.5 rounded-lg
                       hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors text-left"
          >
            <span className={`flex-shrink-0 w-[7px] h-[7px] rounded-full mt-[5px] ${STATUS_DOT[t.status] || 'bg-paper-400 dark:bg-pitch-400'}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-pitch-800 dark:text-pitch-50 truncate">{t.title}</span>
              <span className="block font-mono text-2xs text-paper-500 dark:text-pitch-300">
                {t.area ? `in ${t.area}` : 'thread'}{t.updated_at ? ` · ${formatDistanceToNow(parseUTC(t.updated_at), { addSuffix: true })}` : ''}
              </span>
            </span>
            <ArrowRight size={13} className="flex-shrink-0 text-paper-400 dark:text-pitch-300 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
        <p className="font-mono text-2xs text-paper-400 dark:text-pitch-300 px-1.5 py-1.5 tracking-wide">from your workspace</p>
      </div>
    </Card>
  )
}
