import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Flame, Moon, CalendarClock, ListChecks, CalendarDays,
  ArrowUpRight, ExternalLink, Sparkles, Telescope,
} from 'lucide-react'
import PageHeader from '../components/PageHeader'
import {
  format, formatDistanceToNow, formatDistanceStrict,
  isToday, isTomorrow, parseISO, differenceInCalendarDays,
} from 'date-fns'
import { insightsApi, entriesApi } from '../api/client'
import { getTodayNudge } from '../api/nudges'
import { getAreaStatus } from '../utils/status'
import { AreaIcon } from '../components/IconPicker'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Concrete, friendly relative time for a due date. We deliberately avoid vague
// language ("soon") in favour of concrete cues - time-blindness-aware.
function dueLabel(dueIso) {
  if (!dueIso) return { text: 'no date', tone: 'muted' }
  const d = parseISO(dueIso)
  if (isToday(d)) return { text: 'today', tone: 'urgent' }
  if (isTomorrow(d)) return { text: 'tomorrow', tone: 'soft' }
  const days = differenceInCalendarDays(d, new Date())
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'urgent' }
  if (days <= 7) return { text: format(d, 'EEE'), tone: 'soft' }
  return { text: format(d, 'd MMM'), tone: 'muted' }
}

// "in 1h 40m" / "in 3 days" - concrete countdown to the next meeting.
function untilLabel(whenIso) {
  const d = parseISO(whenIso)
  const now = new Date()
  if (d < now) return 'now'
  return `in ${formatDistanceStrict(d, now)}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Insights() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [todos, setTodos] = useState([])
  const [nudge, setNudge] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([insightsApi.get(7), entriesApi.getUpcoming(5)])
      .then(([insights, upcoming]) => {
        if (!alive) return
        setData(insights)
        setTodos(upcoming)
      })
      .catch((e) => alive && setError(e.message || 'Failed to load insights'))
      .finally(() => alive && setLoading(false))
    getTodayNudge().then((n) => alive && setNudge(n?.text || null)).catch(() => {})
    return () => { alive = false }
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
      {/* Header */}
      <PageHeader
        icon={Telescope}
        title="Insights"
        subtitle="Trends across your areas."
        right={
          <span className="font-mono text-xs text-paper-500 dark:text-paper-200">
            {format(new Date(), 'EEE d MMM')}
          </span>
        }
      />
      {nudge && (
        <p className="text-sm text-paper-600 dark:text-paper-500 italic mb-7 flex items-start gap-1.5 -mt-2">
          <Sparkles size={13} className="mt-0.5 flex-shrink-0 text-mint/70" />
          {nudge}
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-terracotta/30 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            <div className="h-28 rounded-lg bg-paper-200 dark:bg-pitch-700" />
            <div className="h-28 rounded-lg bg-paper-200 dark:bg-pitch-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-28 rounded-lg bg-paper-200 dark:bg-pitch-700" />
            <div className="h-28 rounded-lg bg-paper-200 dark:bg-pitch-700" />
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-7">
          {/* ── Momentum ─────────────────────────────────────────────────── */}
          <Section label="Momentum">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.most_active && (
                <MomentumCard
                  icon={Flame}
                  kicker="Most active"
                  area={data.most_active}
                  detail={
                    data.most_active.entry_count > 0
                      ? `${data.most_active.entry_count} ${data.most_active.entry_count === 1 ? 'entry' : 'entries'} this week`
                      : 'no entries this week'
                  }
                  onClick={() => navigate(`/area/${data.most_active.area_id}`)}
                />
              )}
              {data.quietest ? (
                <MomentumCard
                  icon={Moon}
                  kicker="Quietest"
                  area={data.quietest}
                  detail={
                    data.quietest.days_since_activity == null
                      ? 'no activity yet'
                      : data.quietest.days_since_activity === 0
                        ? 'active today'
                        : `no activity in ${data.quietest.days_since_activity} ${data.quietest.days_since_activity === 1 ? 'day' : 'days'}`
                  }
                  onClick={() => navigate(`/area/${data.quietest.area_id}`)}
                />
              ) : (
                // When there aren't enough areas to rank, keep the grid balanced
                // with a calm placeholder rather than a lone card.
                data.most_active && (
                  <div className="rounded-lg bg-paper-100/60 dark:bg-pitch-800/40 border border-dashed border-paper-300 dark:border-pitch-700 p-4 flex items-center justify-center text-center">
                    <span className="text-xs text-paper-500 dark:text-paper-700 max-w-[18ch]">
                      Add a few more areas to surface your quietest plate
                    </span>
                  </div>
                )
              )}
            </div>
          </Section>

          {/* ── What's ahead ─────────────────────────────────────────────── */}
          <Section label="What's ahead">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Next meeting */}
              <RaisedCard>
                <CardKicker icon={CalendarClock}>Next meeting</CardKicker>
                {data.next_meeting ? (
                  <button
                    onClick={() => navigate(`/thread/${data.next_meeting.thread_id}?entry=${data.next_meeting.id}`)}
                    className="group text-left w-full"
                  >
                    <p className="text-sm font-medium text-pitch-800 dark:text-white group-hover:text-mint-700 dark:group-hover:text-mint-300 transition-colors line-clamp-2">
                      {data.next_meeting.content}
                    </p>
                    <p className="font-mono text-xs text-sky-muted mt-1.5">
                      {untilLabel(data.next_meeting.meeting_at)} · {format(parseISO(data.next_meeting.meeting_at), 'HH:mm')}
                    </p>
                  </button>
                ) : (
                  <EmptyHint>No upcoming meetings logged</EmptyHint>
                )}
              </RaisedCard>

              {/* Due todos */}
              <RaisedCard>
                <CardKicker icon={ListChecks}>Due todos</CardKicker>
                {todos.length > 0 ? (
                  <ul className="-mx-1">
                    {todos.slice(0, 4).map((t, i) => {
                      const due = dueLabel(t.due_date)
                      return (
                        <li
                          key={t.id}
                          className={`flex items-center justify-between gap-2 px-1 py-1.5 ${i > 0 ? 'border-t border-paper-200 dark:border-pitch-700' : ''}`}
                        >
                          <span className="text-[13px] text-pitch-700 dark:text-paper-300 truncate">
                            {t.content}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-[11px] ${
                              due.tone === 'urgent' ? 'text-terracotta'
                                : due.tone === 'soft' ? 'text-paper-600 dark:text-paper-500'
                                : 'text-paper-500 dark:text-paper-700'
                            }`}>
                              {due.text}
                            </span>
                            <button
                              onClick={() => navigate(`/thread/${t.thread_id}?entry=${t.id}`)}
                              aria-label={`Go to "${t.content}" in ${t.thread_title}`}
                              title={`Open in ${t.thread_title}`}
                              className="p-1 rounded text-paper-500 dark:text-paper-600 hover:text-mint-700 dark:hover:text-mint-300 hover:bg-paper-200 dark:hover:bg-pitch-700 transition-colors"
                            >
                              <ExternalLink size={13} />
                            </button>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <EmptyHint>Nothing due. You're clear.</EmptyHint>
                )}
              </RaisedCard>
            </div>
          </Section>

          {/* ── Latest calendar entries ──────────────────────────────────── */}
          {data.recent_meetings.length > 0 && (
            <Section label="Latest calendar entries">
              <RaisedCard>
                <ul className="-my-0.5">
                  {data.recent_meetings.map((m, i) => {
                    const when = parseISO(m.meeting_at)
                    const past = when < new Date()
                    return (
                      <li
                        key={m.id}
                        className={`flex items-center justify-between gap-3 py-1.5 ${i > 0 ? 'border-t border-paper-200 dark:border-pitch-700' : ''}`}
                      >
                        <button
                          onClick={() => navigate(`/thread/${m.thread_id}?entry=${m.id}`)}
                          className="group flex items-center gap-2 min-w-0 text-left"
                        >
                          <span className={`text-[13px] truncate ${past ? 'text-paper-500 dark:text-paper-600' : 'text-pitch-700 dark:text-paper-300'} group-hover:text-mint-700 dark:group-hover:text-mint-300 transition-colors`}>
                            {m.content}
                          </span>
                        </button>
                        <span className={`font-mono text-xs flex-shrink-0 ${
                          past ? 'text-paper-500 dark:text-paper-700' : 'text-sky-muted'
                        }`}>
                          {isToday(when) ? format(when, 'HH:mm') : format(when, 'd MMM HH:mm')}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </RaisedCard>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <section>
      <h2 className="font-mono uppercase tracking-[0.12em] text-[11px] text-paper-500 dark:text-paper-700 mb-2.5">
        {label}
      </h2>
      {children}
    </section>
  )
}

// Momentum card - option A: whole card is the click target, with a corner
// arrow that brightens to mint on hover, plus a subtle lift.
function MomentumCard({ icon: Icon, kicker, area, detail, onClick }) {
  const status = getAreaStatus(area.status)
  return (
    <button
      onClick={onClick}
      title={`Go to ${area.area_name}`}
      className="
        group relative text-left w-full
        rounded-lg p-4
        bg-paper-100 dark:bg-pitch-800
        border border-paper-200 dark:border-pitch-700
        hover:border-paper-400 dark:hover:border-pitch-500
        hover:-translate-y-0.5
        transition-all duration-150 ease-out
      "
    >
      <ArrowUpRight
        size={16}
        className="absolute top-3 right-3 text-paper-400 dark:text-paper-700 group-hover:text-mint-600 dark:group-hover:text-mint-400 transition-colors"
      />
      <div className="flex items-center gap-1.5 text-xs text-paper-600 dark:text-paper-500 mb-2">
        <Icon size={13} />
        {kicker}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: status.dot }}
        />
        {area.icon && <AreaIcon name={area.icon} size={14} className="flex-shrink-0 text-pitch-700 dark:text-paper-300" />}
        <span className="text-base font-medium text-pitch-800 dark:text-white truncate">
          {area.area_name}
        </span>
      </div>
      <p className="text-xs text-paper-500 dark:text-paper-700">{detail}</p>
    </button>
  )
}

function RaisedCard({ children }) {
  return (
    <div className="rounded-lg p-4 bg-white dark:bg-pitch-800 border border-paper-200 dark:border-pitch-700">
      {children}
    </div>
  )
}

function CardKicker({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-paper-600 dark:text-paper-500 mb-2.5">
      <Icon size={13} />
      {children}
    </div>
  )
}

function EmptyHint({ children }) {
  return (
    <p className="text-[13px] text-paper-500 dark:text-paper-700">{children}</p>
  )
}
