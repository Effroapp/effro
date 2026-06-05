/**
 * Insights - the reflective, temporal lens (past -> future), distinct from the
 * present-tense Dashboard. Three lenses, one at a time, ADHD-first and calm:
 *
 *   Reflect  - what you did (Today wind-down + This week step-back)
 *   Ahead    - what's coming (timeline, forecast, a good window)
 *   Balance  - across areas (attention map, drift, "not on you")
 *
 * All figures come from real aggregates (/insights/today|week|ahead|balance).
 * Narratives are grounded: see docs/INSIGHTS_REDESIGN_SPEC.md.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Telescope, Sparkles, Rewind, CalendarClock, Scale as ScaleIcon,
  CheckSquare, Calendar, Ban, ArrowUpRight, Clock, Trophy,
  Unlock, Undo2, Hourglass, Sun, Sunset, CircleCheck, Ticket, X, ChevronDown, Coffee,
  Eye, EyeOff, RefreshCw,
} from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'
import PageHeader from '../components/PageHeader'
import { AreaIcon } from '../components/IconPicker'
import { getAreaStatus } from '../utils/status'
import { insightsApi } from '../api/client'

// ─── Shared meta ──────────────────────────────────────────────────────────────

const ENTRY_META = {
  todo:     { Icon: CheckSquare, color: '#6B8AB8' },
  decision: { Icon: ScaleIcon,   color: '#C99A5C' },
  meeting:  { Icon: Calendar,    color: '#8A7BB8' },
  blockage: { Icon: Ban,         color: '#B86A5C' },
  resolved: { Icon: CircleCheck, color: '#7A9579' },
  jira:     { Icon: Ticket,      color: '#6B8AB8' },
}

const CELEB_META = {
  unblocked: { Icon: Unlock,      color: '#7A9579' },
  resolved:  { Icon: CircleCheck, color: '#7A9579' },
  comeback:  { Icon: Undo2,       color: '#6B8AB8' },
  decisions: { Icon: ScaleIcon,   color: '#C99A5C' },
}

const TABS = [
  { key: 'reflect', label: 'Reflect', Icon: Rewind,        sub: 'what you did' },
  { key: 'ahead',   label: 'Ahead',   Icon: CalendarClock, sub: "what's coming" },
  { key: 'balance', label: 'Balance', Icon: ScaleIcon,     sub: 'across areas' },
]

// decimal hour -> '5:00pm'
function fmtHour(h) {
  if (h == null) return ''
  const hr = Math.floor(h), mn = Math.round((h - hr) * 60)
  return `${((hr + 11) % 12) + 1}:${String(mn).padStart(2, '0')}${hr < 12 ? 'am' : 'pm'}`
}
function fmtDur(h) {
  if (h == null) return ''
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`
}

// ─── Page ───────────────────────────────────────────────────────────────────

// One calm line per lens, so a first-time viewer understands each at a glance.
const LENS_INTRO = {
  reflect: 'A calm look back at what you have actually done.',
  ahead:   'The shape of what is coming, so nothing catches you off guard.',
  balance: 'Where your attention has been going across your areas.',
}

export default function Insights() {
  const [tab, setTab] = useState('reflect')
  const [scope, setScope] = useState('week')        // reflect scope: week | today
  const [week, setWeek] = useState(null)
  const [today, setToday] = useState(null)
  const [ahead, setAhead] = useState(null)
  const [balance, setBalance] = useState(null)

  useEffect(() => { insightsApi.week().then(setWeek).catch(() => {}) }, [])
  const fetchToday = (nonce = 0) => insightsApi.today(undefined, nonce).then(setToday).catch(() => {})
  useEffect(() => {
    if (tab === 'reflect' && scope === 'today' && !today) fetchToday()
  }, [tab, scope, today])
  useEffect(() => { if (tab === 'ahead' && !ahead) insightsApi.ahead().then(setAhead).catch(() => {}) }, [tab, ahead])
  useEffect(() => { if (tab === 'balance' && !balance) insightsApi.balance().then(setBalance).catch(() => {}) }, [tab, balance])

  // First-run explainer: shown once, then it gets out of the way.
  const [introSeen, setIntroSeen] = useState(() => localStorage.getItem('effro.insightsIntroSeen') === '1')
  const dismissIntro = () => { localStorage.setItem('effro.insightsIntroSeen', '1'); setIntroSeen(true) }

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-pitch-800">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
        <PageHeader
          icon={Telescope}
          title="Insights"
          subtitle="Step back and see how things are really going."
          right={
            <span className="font-mono text-xs text-paper-500 dark:text-paper-200">
              {format(new Date(), 'EEE d MMM')}
            </span>
          }
        />

        {/* First-run explainer - shown once, then dismissed for good. */}
        {!introSeen && (
          <div className="relative rounded-xl bg-gradient-to-br from-mint/10 to-mint/[0.03] dark:from-mint/[0.12] dark:to-mint/[0.03] p-5 pr-10 mb-6 animate-rise motion-reduce:animate-none">
            <button
              onClick={dismissIntro}
              aria-label="Dismiss"
              className="absolute top-3 right-3 p-1 rounded text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
            >
              <X size={15} />
            </button>
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-lg bg-mint/15 flex items-center justify-center flex-shrink-0">
                <Telescope size={17} className="text-mint-600 dark:text-mint-400" />
              </span>
              <div>
                <p className="text-base font-semibold text-pitch-800 dark:text-white">Welcome to Insights</p>
                <p className="text-sm text-paper-600 dark:text-paper-300 leading-relaxed mt-1">
                  A calm place to see how things are really going.{' '}
                  <b className="font-medium text-pitch-700 dark:text-paper-200">Reflect</b> on what you've done,
                  look <b className="font-medium text-pitch-700 dark:text-paper-200">Ahead</b> at what's coming,
                  and check the <b className="font-medium text-pitch-700 dark:text-paper-200">Balance</b> across your areas.
                  It's all real, and none of it is here to nag you.
                </p>
                <button
                  onClick={dismissIntro}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-mint-700 dark:text-mint-300 hover:underline"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Narrative line - the calm "what to notice", deterministic + accurate. */}
        {week?.narrative && (
          <p className="font-lexend text-[13px] leading-relaxed text-paper-600 dark:text-pitch-100 italic mb-6 -mt-1 flex items-start gap-1.5">
            <Sparkles size={13} className="mt-1 flex-shrink-0 text-mint/70" />
            <span>{week.narrative}</span>
          </p>
        )}

        <Tabs tab={tab} onChange={setTab} />

        {/* Per-lens description, with the Reflect scope toggle beside it. */}
        <div className="flex items-center justify-between gap-3 mb-5 -mt-1">
          <p className="text-[13px] text-paper-500 dark:text-paper-600">{LENS_INTRO[tab]}</p>
          {tab === 'reflect' && <ScopeToggle scope={scope} onChange={setScope} />}
        </div>

        <div key={tab} className="animate-rise motion-reduce:animate-none">
          {tab === 'reflect' && (
            <ReflectLens
              scope={scope}
              week={week}
              today={today}
              onRefreshToday={() => fetchToday(Math.floor(Math.random() * 99999) + 1)}
            />
          )}
          {tab === 'ahead'   && <AheadLens data={ahead} />}
          {tab === 'balance' && <BalanceLens data={balance} />}
        </div>
      </div>
    </div>
  )
}

// ─── Tabs / scope ─────────────────────────────────────────────────────────────

function Tabs({ tab, onChange }) {
  return (
    <div className="flex items-stretch gap-1 p-1 mb-5 rounded-lg bg-paper-200 dark:bg-pitch-700/60 border border-paper-300 dark:border-pitch-500">
      {TABS.map(({ key, label, Icon }) => {
        const active = tab === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
              active
                ? 'bg-white dark:bg-pitch-800 shadow-sm text-pitch-800 dark:text-white'
                : 'text-paper-600 dark:text-paper-400 hover:text-pitch-700 dark:hover:text-paper-200 hover:bg-paper-100/60 dark:hover:bg-pitch-800/40'
            }`}
          >
            <Icon size={15} className={active ? 'text-mint-600 dark:text-mint-400' : 'text-paper-500 dark:text-paper-600'} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

function ScopeToggle({ scope, onChange }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-paper-200 dark:bg-pitch-700/60 border border-paper-300 dark:border-pitch-500">
      {[['today', 'Today'], ['week', 'This week']].map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            scope === k
              ? 'bg-white dark:bg-pitch-800 text-pitch-700 dark:text-white shadow-sm'
              : 'text-paper-500 dark:text-paper-500 hover:text-pitch-700 dark:hover:text-paper-300'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

// ─── Reflect ──────────────────────────────────────────────────────────────────

function ReflectLens({ scope, week, today, onRefreshToday }) {
  return scope === 'today'
    ? (today ? <TodayReflect data={today} onRefresh={onRefreshToday} /> : <BlockSkeleton n={3} />)
    : (week ? <WeekReflect data={week} /> : <BlockSkeleton n={4} />)
}

function TodayReflect({ data, onRefresh }) {
  const navigate = useNavigate()
  const items = (data.done_items || []).map((d) => ({
    id: `${d.type}-${d.id}`, type: d.type, content: d.content,
    area: d.area_name, thread_id: d.thread_id,
    right: d.at ? format(parseISO(d.at), 'HH:mm') : '',
  }))
  return (
    <div className="space-y-7 animate-rise motion-reduce:animate-none">
      <Hero
        count={data.headline_count}
        caption={data.headline_count > 0 ? 'finished since you started today' : 'a calm day so far'}
        chips={data.breakdown}
        items={items}
        onOpenItem={(id) => id && navigate(`/thread/${id}`)}
      />
      <WindDownCard mode={data.workday_mode} narrative={data.narrative} startedLabel={data.started_label} tip={data.tip} onRefresh={onRefresh} />
    </div>
  )
}

function WeekReflect({ data }) {
  const navigate = useNavigate()
  const items = (data.closed_items || []).map((d) => ({
    id: `${d.type}-${d.id}`, type: d.type, content: d.content,
    area: d.area_name, thread_id: d.thread_id,
    right: d.at ? format(parseISO(d.at), 'EEE') : '',
  }))
  return (
    <div className="space-y-7 animate-rise motion-reduce:animate-none">
      <Hero
        count={data.headline_count}
        unit="loops closed"
        caption="this week, all real and finished"
        chips={data.breakdown}
        items={items}
        onOpenItem={(id) => id && navigate(`/thread/${id}`)}
      />

      {data.celebrations?.length > 0 && (
        <Section label="Worth celebrating">
          <Celebrations items={data.celebrations} />
        </Section>
      )}

      <Section label="Your days — when you start and stop">
        <RaisedCard><WorkingWindows days={data.your_days || []} /></RaisedCard>
      </Section>

      <Section label="Your rhythm — last 14 days">
        <RaisedCard><RhythmChart rhythm={data.rhythm || []} /></RaisedCard>
      </Section>
    </div>
  )
}

function Hero({ count, unit = 'done today', caption, chips = [], items = [], onOpenItem }) {
  const shown = useCountUp(count)
  const [open, setOpen] = useState(false)
  const hasItems = items.length > 0
  return (
    <section>
      <div className="rounded-xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-10 h-10 rounded-lg bg-mint/10 border border-mint/20 flex items-center justify-center flex-shrink-0">
            <Trophy size={18} className="text-mint-600 dark:text-mint-400" />
          </span>
          <div className="min-w-0">
            <p className="text-2xl font-semibold text-pitch-800 dark:text-white leading-none">
              {shown} {unit}
            </p>
            <p className="text-sm text-paper-500 dark:text-paper-500 mt-1">{caption}</p>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((b) => {
              const m = ENTRY_META[b.type] || ENTRY_META.todo
              return (
                <span key={b.type} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px]" style={{ backgroundColor: `${m.color}1A`, color: m.color }}>
                  <m.Icon size={13} />
                  <b className="font-semibold">{b.count}</b>
                  <span className="opacity-80">{b.label}</span>
                </span>
              )
            })}
            {hasItems && (
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-paper-500 dark:text-paper-400 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
              >
                {open ? 'Hide details' : 'Show details'}
                <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        )}
        {open && hasItems && (
          <div className="mt-4 pt-4 border-t border-paper-200 dark:border-pitch-600">
            <ClosedDetails items={items} onOpenItem={onOpenItem} />
          </div>
        )}
      </div>
    </section>
  )
}

// Two states: a calm "time to stop" once a real day's work is in (>= 7h), or,
// while the day's still in flow, the start time plus a rotating ADHD workday tip.
function WindDownCard({ mode, narrative, startedLabel, tip, onRefresh }) {
  const refresh = onRefresh && (
    <button
      onClick={onRefresh}
      aria-label={mode === 'in_progress' ? 'Show another tip' : 'Reword this'}
      title={mode === 'in_progress' ? 'Show another tip' : 'Reword this'}
      className="absolute top-3 right-3 p-1 rounded text-paper-400 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-200 transition-colors"
    >
      <RefreshCw size={13} />
    </button>
  )
  if (mode === 'in_progress') {
    return (
      <div className="relative rounded-xl border border-paper-300 dark:border-pitch-500 bg-white dark:bg-pitch-700 p-5 pr-10 flex items-start gap-3">
        {refresh}
        <span className="w-9 h-9 rounded-lg bg-sky-muted/10 flex items-center justify-center flex-shrink-0">
          <Coffee size={18} className="text-sky-muted" />
        </span>
        <div className="min-w-0">
          {startedLabel && (
            <p className="font-mono text-[12px] text-paper-500 dark:text-paper-600 mb-1">Going since {startedLabel}</p>
          )}
          <p className="text-sm text-paper-600 dark:text-paper-300 leading-relaxed">{tip}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="relative rounded-xl border border-mint/25 bg-mint/5 p-5 pr-10 flex items-start gap-3">
      {refresh}
      <span className="w-9 h-9 rounded-lg bg-mint/10 flex items-center justify-center flex-shrink-0">
        <Sunset size={18} className="text-mint-600 dark:text-mint-400" />
      </span>
      <div>
        <p className="text-sm font-medium text-pitch-800 dark:text-white">A good place to stop</p>
        <p className="text-sm text-paper-600 dark:text-paper-300 leading-relaxed mt-1">{narrative}</p>
      </div>
    </div>
  )
}

// Celebrations centrepiece. The single hardest-earned win is featured (a cleared
// blocker, a resolved thread, a return to a quiet area - anything but the bare
// decisions tally), with the rest kept quiet beneath. Calm, not confetti.
function Celebrations({ items }) {
  if (!items?.length) return null
  return (
    <div className="rounded-xl bg-gradient-to-br from-mint/10 to-mint/[0.03] dark:from-mint/[0.12] dark:to-mint/[0.03] p-4 space-y-3.5">
      {items.map((c, i) => {
        const m = CELEB_META[c.type] || CELEB_META.decisions
        const lead = i === 0
        return (
          <div key={i} className="flex items-start gap-3">
            <span className={`rounded-lg flex items-center justify-center flex-shrink-0 ${lead ? 'w-9 h-9 bg-mint/15' : 'w-7 h-7 bg-mint/10'}`}>
              <m.Icon size={lead ? 17 : 14} style={{ color: m.color }} />
            </span>
            <p className={`leading-snug ${lead ? 'text-base font-medium text-pitch-800 dark:text-white pt-1.5' : 'text-sm text-pitch-700 dark:text-paper-300 pt-1'}`}>
              {c.text}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// Expanded detail behind the "loops closed" hero: the actual items, grouped by
// type (todos, decisions, blockers cleared, threads resolved, Jira filed).
const CLOSED_ORDER = ['todo', 'decision', 'blockage', 'resolved', 'jira']
const CLOSED_GROUP_LABEL = {
  todo: 'Todos done', decision: 'Decisions made', blockage: 'Blockers cleared',
  resolved: 'Threads resolved', jira: 'Jira items filed',
}

function ClosedDetails({ items, onOpenItem }) {
  const groups = {}
  items.forEach((it) => { (groups[it.type] ||= []).push(it) })
  const types = CLOSED_ORDER.filter((t) => groups[t]?.length)
  return (
    <div className="space-y-4">
      {types.map((t) => {
        const m = ENTRY_META[t] || ENTRY_META.todo
        return (
          <div key={t}>
            <p className="font-mono uppercase tracking-widest text-[10px] mb-1.5" style={{ color: m.color }}>{CLOSED_GROUP_LABEL[t]}</p>
            <ul className="-my-0.5">
              {groups[t].map((c, i) => (
                <li key={`${c.id}-${i}`} className={`flex items-center gap-3 py-1.5 ${i > 0 ? 'border-t border-paper-200 dark:border-pitch-600' : ''}`}>
                  <m.Icon size={14} style={{ color: m.color }} className="flex-shrink-0" />
                  <button
                    onClick={() => onOpenItem?.(c.thread_id)}
                    className="flex-1 text-left text-sm text-pitch-700 dark:text-paper-300 truncate hover:text-mint-700 dark:hover:text-mint-300 transition-colors"
                  >
                    {c.content}
                  </button>
                  {c.area && <span className="text-[11px] font-medium text-paper-500 dark:text-paper-500 flex-shrink-0">{c.area}</span>}
                  {c.right && <span className="font-mono text-[11px] text-paper-400 dark:text-paper-700 flex-shrink-0 w-12 text-right">{c.right}</span>}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// Working-window bars on a 7am-8pm axis. Healthy reads sage; long reads mustard.
function WorkingWindows({ days }) {
  const AX_START = 7, AX_END = 20, SPAN = AX_END - AX_START
  const withData = days.filter((d) => d.start_hour != null)
  const anyOver = withData.some((d) => d.over)
  const clamp = (h) => Math.max(AX_START, Math.min(AX_END, h))
  return (
    <div>
      <ul className="space-y-2">
        {days.map((d, i) => {
          const has = d.start_hour != null
          const left = has ? ((clamp(d.start_hour) - AX_START) / SPAN) * 100 : 0
          const width = has ? ((clamp(d.end_hour) - clamp(d.start_hour)) / SPAN) * 100 : 0
          return (
            <li key={i} className="flex items-center gap-3">
              <span className={`w-12 font-mono text-[11px] flex-shrink-0 ${d.label === 'Today' ? 'text-mint-600 dark:text-mint-400 font-bold' : 'text-paper-500 dark:text-paper-600'}`}>{d.label}</span>
              <div className="relative flex-1 h-3 rounded-full bg-paper-200 dark:bg-pitch-800/60">
                {has && (
                  <div className="absolute top-0 h-3 rounded-full" style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, backgroundColor: d.over ? '#C9A85C' : '#7A9579', opacity: d.label === 'Today' ? 0.6 : 1 }} />
                )}
              </div>
              <span className="w-28 flex-shrink-0 text-right font-mono text-[11px] text-paper-500 dark:text-paper-500">
                {has ? `${fmtDur(d.active_hours)} · ${fmtHour(d.end_hour)}` : '—'}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-3 mt-1.5">
        <span className="w-12 flex-shrink-0" />
        <div className="relative flex-1 h-3 font-mono text-[9px] text-paper-400 dark:text-paper-700">
          <span className="absolute left-0">7am</span>
          <span className="absolute left-1/2 -translate-x-1/2">1pm</span>
          <span className="absolute right-0">8pm</span>
        </div>
        <span className="w-28 flex-shrink-0" />
      </div>
      <p className="text-[12px] text-sage dark:text-sage leading-relaxed mt-4 flex items-start gap-1.5">
        <Sparkles size={12} className="mt-0.5 flex-shrink-0" />
        <span>
          {withData.length === 0
            ? 'No working hours logged yet. As you use the app, your start and stop times will show here.'
            : anyOver
              ? 'A few long days in there. The win is knowing when to stop, so be kind to yourself.'
              : 'A steady, sustainable pace. Knowing when to walk away is a real skill.'}
        </span>
      </p>
    </div>
  )
}

// 14-day entries-per-day bars.
function RhythmChart({ rhythm }) {
  const max = Math.max(...rhythm.map((r) => r.count), 1)
  return (
    <div className="flex items-end gap-1.5">
      {rhythm.map((r, i) => {
        const h = r.count === 0 ? 3 : Math.max(6, (r.count / max) * 92)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="w-full flex items-end justify-center" style={{ height: '92px' }}>
              <div className="w-full rounded-sm" style={{ height: `${h}px`, backgroundColor: r.is_today ? '#10B981' : r.weekend ? '#A8A49E55' : '#7A9579AA' }} title={`${r.count} entries`} />
            </div>
            <span className={`font-mono text-[9px] ${r.is_today ? 'text-mint-600 dark:text-mint-400 font-bold' : 'text-paper-400 dark:text-paper-700'}`}>{r.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Ahead ────────────────────────────────────────────────────────────────────

function AheadLens({ data }) {
  const navigate = useNavigate()
  if (!data) return <BlockSkeleton n={3} />

  const fn = data.forecast_next || { meetings: 0, todos: 0 }
  const fp = data.forecast_prev || { meetings: 0, todos: 0 }
  const nextTotal = fn.meetings + fn.todos
  const prevTotal = fp.meetings + fp.todos
  const compare = nextTotal === 0 ? '' : nextTotal > prevTotal ? ' A little busier than the past week.' : nextTotal < prevTotal ? ' A little lighter than the past week.' : ''

  // "On your plate" is your to-do list - todos only. Meetings already live in
  // Next up and the timeline, so including them here is redundant and mixes
  // two item types (a meeting with a trailing time among area-tagged todos).
  const tl = data.timeline || []
  const onlyTodos = (items) => (items || []).filter((u) => u.kind === 'todo')
  const todayItems = onlyTodos(tl[0]?.items)
  const tmrwItems = onlyTodos(tl[1]?.items)
  const restItems = onlyTodos(tl.slice(2).flatMap((d) => d.items))

  return (
    <div className="space-y-7">
      {nextTotal > 0 && (
        <Callout tone="neutral" icon={CalendarClock}>
          <p className="text-sm text-paper-700 dark:text-paper-300 leading-relaxed">
            The next 7 days hold{' '}
            <b className="font-medium text-pitch-700 dark:text-paper-200">{fn.meetings} {fn.meetings === 1 ? 'meeting' : 'meetings'}</b> and{' '}
            <b className="font-medium text-pitch-700 dark:text-paper-200">{fn.todos} {fn.todos === 1 ? 'todo' : 'todos'}</b> due.{compare} A glance now means no ambush later.
          </p>
        </Callout>
      )}

      <Section label="The shape of your next 10 days">
        <RaisedCard><TimelineStrip days={tl} /></RaisedCard>
      </Section>

      {data.next_meeting && (
        <Section label="Next up">
          <button
            onClick={() => navigate(`/thread/${data.next_meeting.thread_id}`)}
            className="w-full text-left rounded-xl bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500 p-5 flex items-center gap-4 hover:border-paper-400 dark:hover:border-pitch-400 transition-colors"
          >
            <span className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#8A7BB81A' }}>
              <Calendar size={20} className="text-lavender" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-pitch-800 dark:text-white truncate">{data.next_meeting.content}</p>
              <p className="font-mono text-[13px] text-lavender mt-0.5">{format(parseISO(data.next_meeting.at), 'EEE d MMM · HH:mm')}</p>
            </div>
            <ArrowUpRight size={16} className="text-paper-400 dark:text-paper-700 flex-shrink-0" />
          </button>
        </Section>
      )}

      {(todayItems.length + tmrwItems.length + restItems.length) > 0 && (
        <Section label="On your plate">
          <RaisedCard>
            {[['Today', todayItems], ['Tomorrow', tmrwItems], ['This week', restItems]].map(([label, items], bi) =>
              items.length === 0 ? null : (
                <div key={label} className={bi > 0 ? 'mt-4 pt-4 border-t border-paper-200 dark:border-pitch-600' : ''}>
                  <p className="font-mono uppercase tracking-widest text-[10px] text-paper-500 dark:text-paper-600 mb-2">{label}</p>
                  <ul className="space-y-1">
                    {items.map((u, i) => {
                      const m = ENTRY_META[u.kind] || ENTRY_META.todo
                      return (
                        <li key={i} className="flex items-center gap-3 py-1">
                          <m.Icon size={14} style={{ color: m.color }} className="flex-shrink-0" />
                          <span className="flex-1 text-sm text-pitch-700 dark:text-paper-300 truncate">{u.content}</span>
                          {u.area_name && <span className="text-[11px] font-medium text-paper-500 dark:text-paper-500">{u.area_name}</span>}
                          {u.time_local && <span className="font-mono text-[11px] text-paper-400 dark:text-paper-700 w-14 text-right">{u.time_local}</span>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            )}
          </RaisedCard>
        </Section>
      )}

      {data.good_window && (
        <Section label="A good window">
          <Callout tone="mint" icon={Sun}>
            <p className="text-sm text-paper-700 dark:text-paper-300 leading-relaxed">
              <b className="font-medium">{data.good_window.area_name}</b> has gone quiet for {data.good_window.quiet_days} days.
              {data.good_window.day_label ? ` ${data.good_window.day_label} looks light` : ' When you have a quiet moment'}, it's a good window for it, if you have the energy. No pressure either way.
            </p>
          </Callout>
        </Section>
      )}
    </div>
  )
}

function TimelineStrip({ days }) {
  return (
    <div className="flex gap-1.5">
      {days.map((d, i) => (
        <div key={i} className="flex-1 min-w-0 flex flex-col items-center">
          <span className={`font-mono text-[10px] mb-1 ${d.is_today ? 'text-mint-600 dark:text-mint-400 font-bold' : 'text-paper-400 dark:text-paper-700'}`}>{d.label}</span>
          <span className={`font-mono text-[11px] mb-2 ${d.is_today ? 'text-pitch-700 dark:text-paper-200' : 'text-paper-500 dark:text-paper-600'}`}>{d.day_num}</span>
          <div className={`w-full min-h-[88px] rounded-md p-1 flex flex-col gap-1 overflow-hidden ${d.is_today ? 'bg-mint/5 ring-1 ring-mint/30' : d.weekend ? 'bg-paper-200/40 dark:bg-pitch-800/40' : 'bg-paper-100/60 dark:bg-pitch-800/30'}`}>
            {d.items.map((u, j) => u.kind === 'meeting' ? (
              <div key={j} className="max-w-full rounded px-1 py-0.5 text-[9px] leading-tight font-medium truncate" style={{ backgroundColor: '#8A7BB826', color: '#8A7BB8' }} title={`${u.time_local || ''} ${u.content}`.trim()}>
                {u.time_local} {u.content}
              </div>
            ) : (
              <div key={j} className="flex items-center gap-1 px-0.5 min-w-0 w-full" title={u.content}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#6B8AB8' }} />
                <span className="text-[9px] leading-tight text-paper-600 dark:text-paper-400 truncate min-w-0">{u.content}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Balance ──────────────────────────────────────────────────────────────────

function BalanceLens({ data }) {
  if (!data) return <BlockSkeleton n={3} />
  const areas = data.areas || []
  const ranked = [...areas].sort((a, b) => b.total - a.total)
  const active = ranked.filter((a) => a.total > 0)
  const grand = active.reduce((s, a) => s + a.total, 0) || 1

  return (
    <div className="space-y-7">
      {active.length > 0 && (
        <Section label="Where your attention went">
          <RaisedCard>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {active.map((a) => (
                <div key={a.area_id} style={{ width: `${(a.total / grand) * 100}%`, backgroundColor: getAreaStatus(a.status).dot }} title={`${a.name}: ${a.total}`} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {active.map((a) => (
                <span key={a.area_id} className="inline-flex items-center gap-1.5 text-[12px] text-paper-600 dark:text-paper-400">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getAreaStatus(a.status).dot }} />
                  {a.name}
                  <span className="font-mono text-paper-400 dark:text-paper-700">{Math.round((a.total / grand) * 100)}%</span>
                </span>
              ))}
            </div>
          </RaisedCard>
        </Section>
      )}

      <Section label="Each plate, last 14 days">
        <RaisedCard>
          <ul className="-my-1">
            {ranked.map((a, i) => {
              const dot = getAreaStatus(a.status).dot
              return (
                <li key={a.area_id} className={`flex items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-paper-200 dark:border-pitch-600' : ''}`}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                  {a.icon && <AreaIcon name={a.icon} size={14} className="flex-shrink-0 text-pitch-700 dark:text-paper-300" />}
                  <span className="flex-1 text-sm font-medium text-pitch-700 dark:text-paper-200 truncate">{a.name}</span>
                  <Sparkline series={a.series} color={dot} />
                  <span className={`text-[11px] flex-shrink-0 w-24 text-right ${a.quiet_days === 0 ? 'text-sage' : a.quiet_days != null && a.quiet_days >= 7 ? 'text-mustard' : 'text-paper-500 dark:text-paper-600'}`}>
                    {a.quiet_days == null ? 'no activity yet' : a.quiet_days === 0 ? 'active today' : `${a.quiet_days}d quiet`}
                  </span>
                </li>
              )
            })}
          </ul>
        </RaisedCard>
      </Section>

      {data.not_on_you?.length > 0 && (
        <Section label="Not on you">
          <Callout tone="sky" icon={Hourglass}>
            <p className="text-sm text-paper-700 dark:text-paper-300 leading-relaxed">
              <b className="font-medium">{data.not_on_you.length} {data.not_on_you.length === 1 ? 'thread is' : 'threads are'}</b> blocked, waiting on something external. That weight isn't on you right now.
            </p>
            <ul className="space-y-1 mt-3">
              {data.not_on_you.map((n) => (
                <li key={n.thread_id} className="flex items-center gap-2 text-[12px]">
                  <span className="text-pitch-700 dark:text-paper-300 truncate">{n.title}</span>
                  {n.area_name && <span className="ml-auto text-[11px] font-medium text-paper-400 dark:text-paper-600">{n.area_name}</span>}
                </li>
              ))}
            </ul>
          </Callout>
        </Section>
      )}

      {data.drift?.length > 0 && (
        <Section label="A gentle nudge or two">
          <Callout tone="mustard" icon={Clock}>
            <p className="text-sm text-paper-700 dark:text-paper-300 leading-relaxed">
              <b className="font-medium">{data.drift.map((d) => d.name).join(' and ')}</b>{' '}
              {data.drift.length === 1 ? 'has' : 'have'} gone quiet for a while.
              No pressure, just so {data.drift.length === 1 ? "it doesn't" : "they don't"} slip off the radar. Open {data.drift.length === 1 ? 'it' : 'them'} when you have the energy.
            </p>
          </Callout>
        </Section>
      )}
    </div>
  )
}

function Sparkline({ series, color }) {
  const w = 90, h = 22, max = Math.max(...series, 1)
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 3) - 1.5).toFixed(1)}`).join(' ')
  const allZero = series.every((v) => v === 0)
  return (
    <svg width={w} height={h} className="flex-shrink-0">
      {allZero
        ? <line x1="0" y1={h - 2} x2={w} y2={h - 2} stroke={color} strokeWidth="1.5" strokeDasharray="2 3" opacity="0.4" />
        : <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />}
    </svg>
  )
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

// Per-section hide. The eyelid (open eye = visible, closed = hidden) lets an
// ADHD user quietly tuck a section away - but hidden never means gone: a calm
// strip stays, naming what's tucked and offering it back. Persisted per section.
const HIDDEN_KEY = 'effro.insights.hidden'
function _hiddenMap() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}') } catch { return {} }
}
function _setHidden(key, val) {
  const m = _hiddenMap()
  if (val) m[key] = true; else delete m[key]
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(m)) } catch { /* best effort */ }
}

function Section({ label, children, hideable = true }) {
  const key = label
  const [hidden, setHidden] = useState(() => !!_hiddenMap()[key])
  const toggle = () => { const v = !hidden; setHidden(v); _setHidden(key, v) }

  if (hidden) {
    return (
      <section>
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-paper-300 dark:border-pitch-500 text-paper-500 dark:text-paper-600 hover:text-pitch-700 dark:hover:text-paper-300 hover:border-paper-400 dark:hover:border-pitch-400 transition-colors text-left"
          title="Show this section again"
        >
          <EyeOff size={14} className="flex-shrink-0" />
          <span className="text-[13px]"><span className="font-medium">{label}</span> is tucked away</span>
          <span className="ml-auto text-[12px] font-medium">Show</span>
        </button>
      </section>
    )
  }

  return (
    <section>
      <div className="group/sec flex items-center justify-between mb-2.5">
        <h2 className="font-mono uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600">{label}</h2>
        {hideable && (
          <button
            onClick={toggle}
            aria-label={`Hide ${label}`}
            title="Tuck this away"
            className="p-1 -mr-1 rounded text-paper-300 dark:text-paper-700 opacity-60 group-hover/sec:opacity-100 hover:text-paper-600 dark:hover:text-paper-400 transition-all"
          >
            <Eye size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function RaisedCard({ children }) {
  return <div className="rounded-xl p-4 bg-white dark:bg-pitch-700 border border-paper-300 dark:border-pitch-500">{children}</div>
}

// One calm callout style for every tinted note on the page. Colour carries
// meaning (mint = good, sky = reassurance, mustard = gentle attention), never
// decoration - so the whole page reads as one consistent system.
const CALLOUT_TONES = {
  mint:    { border: 'border-mint/25',      bg: 'bg-mint/5',      icon: 'text-mint-600 dark:text-mint-400' },
  sky:     { border: 'border-sky-muted/30', bg: 'bg-sky-muted/5', icon: 'text-sky-muted' },
  mustard: { border: 'border-mustard/35',   bg: 'bg-mustard/5',   icon: 'text-mustard' },
  neutral: { border: 'border-paper-300 dark:border-pitch-500', bg: 'bg-white dark:bg-pitch-700', icon: 'text-paper-500 dark:text-paper-400' },
}

function Callout({ tone = 'mint', icon: Icon, children }) {
  const t = CALLOUT_TONES[tone] || CALLOUT_TONES.mint
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} p-4 flex items-start gap-3`}>
      {Icon && <Icon size={16} className={`${t.icon} flex-shrink-0 mt-0.5`} />}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// Count a number up from zero on mount - quietly rewarding. Honours reduced-motion.
function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(target)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !target) { setValue(target); return }
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function Empty({ children }) {
  return <p className="text-sm text-paper-500 dark:text-paper-600">{children}</p>
}

function BlockSkeleton({ n = 3 }) {
  return (
    <div className="space-y-7 animate-pulse">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-28 rounded-xl bg-paper-200 dark:bg-pitch-700" />
      ))}
    </div>
  )
}
