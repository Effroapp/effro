"""
Insights - read-only aggregates for the Insights page.

A single GET /api/insights returns everything the page needs in one round-trip:
  - most active / quietest area over a lookback window ("momentum")
  - the next upcoming meeting + a short list of recent calendar entries

Design notes
------------
Everything is computed live from existing tables (areas, threads, entries).
No new storage, no schema migration. The page is a pure pull surface.

"Activity" for momentum = entries created within the lookback window, attributed
to an area via its threads. We rank on entry_count, tie-breaking on the most
recent activity timestamp.

The quietest card is intentionally suppressed when there are fewer than
MIN_AREAS_FOR_RANKING areas - with two or three plates a "least active" callout
is noise, not insight. The frontend also guards on area_count, but enforcing it
here keeps the contract honest for any future consumer.

This module is the natural home for future integration insights (assigned Jira
issues, PR review requests, unread priority mail). Add sibling helpers + fields
on InsightsOut rather than reshaping the existing ones.
"""
import re
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta

import models
import schemas
from database import get_db
from routers.presence import working_window, recent_finishes

router = APIRouter(tags=["insights"])

# Below this many areas, the "quietest area" ranking is suppressed - it only
# becomes useful once you're juggling several plates.
MIN_AREAS_FOR_RANKING = 4


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _days_since(when: datetime | None, now: datetime) -> int | None:
    if when is None:
        return None
    # Stored timestamps are naive UTC (server_default=func.now()); compare on
    # naive UTC to avoid tz-aware/naive subtraction errors.
    ref = now.replace(tzinfo=None)
    delta = ref - when
    return max(0, delta.days)


def _momentum(db: Session, lookback_days: int):
    """Return (most_active, quietest) MomentumArea or (None, None).

    most_active: highest entry_count in the window (tie → most recent activity).
    quietest:    lowest entry_count (tie → longest since last activity), only
                 returned when there are enough areas to rank.
    """
    now = _utcnow()
    window_start = now.replace(tzinfo=None) - timedelta(days=lookback_days)

    areas = db.query(models.Area).all()
    if not areas:
        return None, None, 0

    # entry_count per area within the window, via thread join.
    counts = dict(
        db.query(models.Area.id, func.count(models.Entry.id))
        .select_from(models.Area)
        .outerjoin(models.Thread, models.Thread.area_id == models.Area.id)
        .outerjoin(
            models.Entry,
            (models.Entry.thread_id == models.Thread.id)
            & (models.Entry.created_at >= window_start),
        )
        .group_by(models.Area.id)
        .all()
    )

    # last activity per area = max(entry.created_at) across its threads, all-time.
    last_rows = (
        db.query(models.Area.id, func.max(models.Entry.created_at))
        .select_from(models.Area)
        .outerjoin(models.Thread, models.Thread.area_id == models.Area.id)
        .outerjoin(models.Entry, models.Entry.thread_id == models.Thread.id)
        .group_by(models.Area.id)
        .all()
    )
    last_activity = {aid: ts for aid, ts in last_rows}

    def to_schema(area: models.Area) -> schemas.MomentumArea:
        ts = last_activity.get(area.id)
        return schemas.MomentumArea(
            area_id=area.id,
            area_name=area.name,
            icon=area.icon,
            status=area.status,
            entry_count=int(counts.get(area.id, 0) or 0),
            last_activity_at=ts,
            days_since_activity=_days_since(ts, now),
        )

    enriched = [to_schema(a) for a in areas]

    # Most active: max count, tie-break on most recent activity.
    most_active = max(
        enriched,
        key=lambda m: (
            m.entry_count,
            m.last_activity_at or datetime.min,
        ),
    )

    quietest = None
    if len(enriched) >= MIN_AREAS_FOR_RANKING:
        # Lowest count, tie-break on longest-stale (oldest last_activity first).
        quietest = min(
            enriched,
            key=lambda m: (
                m.entry_count,
                m.last_activity_at or datetime.min,
            ),
        )
        # If most_active and quietest resolve to the same area (can happen with
        # all-zero counts), drop quietest - there's no contrast to show.
        if quietest.area_id == most_active.area_id:
            quietest = None

    return most_active, quietest, len(enriched)


def _calendar(db: Session):
    """Return (next_meeting, recent_meetings).

    Reads from TWO sources:
      1. Committed meeting entries (`entries` table) - manually-logged + items
         the user has accepted from Signals into a thread.
      2. Pending+assigned Signals (`signal_items`) - real Outlook events the
         sync job has pulled but the user hasn't accepted yet.

    Surfacing both means a freshly-connected Microsoft account shows real
    upcoming meetings on the Insights page within ~30 minutes (or after a
    manual sync), without forcing the user to triage them first. Once they
    accept, the Entry takes over (deduped by external_id, see below).

    next_meeting:    earliest meeting with meeting_at in the future.
    recent_meetings: up to 5 meetings nearest to now (just-past + upcoming),
                     ordered chronologically, for the "latest calendar entries"
                     list.
    """
    now_naive = _utcnow().replace(tzinfo=None)

    # ── Source 1: committed Entry rows ─────────────────────────────────────
    entry_rows = (
        db.query(models.Entry, models.Thread, models.Area)
        .join(models.Thread, models.Entry.thread_id == models.Thread.id)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(
            models.Entry.type == "meeting",
            models.Entry.meeting_at.isnot(None),
        )
        .all()
    )
    entry_externals = {e.external_id for e, _, _ in entry_rows if e.external_id}

    entries: list[schemas.CalendarEntryOut] = [
        schemas.CalendarEntryOut(
            id=entry.id,
            thread_id=thread.id,
            thread_title=thread.title,
            area_id=area.id,
            area_name=area.name,
            content=entry.content,
            meeting_at=entry.meeting_at,
        )
        for entry, thread, area in entry_rows
    ]

    # ── Source 2: pending+assigned Signal rows (not yet committed) ─────────
    # Dedup by external_id - if the user has already accepted a signal, the
    # Entry version is canonical and the signal row is fuzzy data we should
    # ignore here.
    signal_q = (
        db.query(models.SignalItem)
        .filter(
            models.SignalItem.status.in_(["pending", "assigned"]),
            models.SignalItem.kind == "meeting",
            models.SignalItem.starts_at.isnot(None),
        )
    )
    if entry_externals:
        signal_q = signal_q.filter(~models.SignalItem.external_id.in_(entry_externals))
    signal_rows = signal_q.all()

    # Signals don't have a thread/area yet (the user hasn't filed them). We
    # surface them with synthetic placeholder IDs so the frontend can still
    # render the row + show the source — area_id=0 / thread_id=0 signal
    # "this is a pending signal, click to triage."
    PENDING_AREA_NAME = "Signals · pending"
    for signal in signal_rows:
        entries.append(schemas.CalendarEntryOut(
            id=-signal.id,  # negative = pending signal, won't clash with real entry ids
            thread_id=0,
            thread_title=signal.organizer or "Microsoft 365",
            area_id=0,
            area_name=PENDING_AREA_NAME,
            content=signal.title,
            meeting_at=signal.starts_at,
        ))

    if not entries:
        return None, []

    # next_meeting: earliest with meeting_at >= now.
    upcoming = sorted(
        (e for e in entries if e.meeting_at and _strip_tz(e.meeting_at) >= now_naive),
        key=lambda e: _strip_tz(e.meeting_at),
    )
    next_meeting = upcoming[0] if upcoming else None

    # Recent list: top 5 by absolute distance from now, then sorted chronologically.
    by_distance = sorted(
        entries,
        key=lambda e: abs((_strip_tz(e.meeting_at) - now_naive).total_seconds()),
    )[:5]
    recent = sorted(by_distance, key=lambda e: _strip_tz(e.meeting_at))

    return next_meeting, recent


def _strip_tz(dt):
    """Coerce a (possibly tz-aware) datetime to a naive UTC equivalent.

    Both committed entries (server_default=func.now(), naive UTC) and the
    Signal sync (datetime.utcnow(), naive UTC) write naive timestamps, but
    Pydantic may parse them back as tz-aware in some Python/SQLAlchemy
    combos. This makes the comparison robust either way."""
    if dt is None:
        return dt
    if dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


@router.get("/insights", response_model=schemas.InsightsOut)
def get_insights(
    lookback_days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    most_active, quietest, area_count = _momentum(db, lookback_days)
    next_meeting, recent_meetings = _calendar(db)
    return schemas.InsightsOut(
        most_active=most_active,
        quietest=quietest,
        next_meeting=next_meeting,
        recent_meetings=recent_meetings,
        area_count=area_count,
        lookback_days=lookback_days,
    )


# ─── Today: the end-of-day wind-down ──────────────────────────────────────────
# Everything here is computed from real rows in the caller's *local* day. The
# narrative is phrased from these exact facts and nothing else - see _narrative.


def _fmt_local_time(dt_utc, tz_offset_min):
    """UTC datetime -> friendly local clock label, e.g. '9:05am'. None-safe."""
    if dt_utc is None:
        return None
    local = dt_utc - timedelta(minutes=tz_offset_min)
    h, m = local.hour, local.minute
    h12 = ((h + 11) % 12) + 1
    return f"{h12}:{m:02d}{'am' if h < 12 else 'pm'}"


def _hours_phrase(hours):
    """Hours (float) -> 'about 8 hours' / 'about 7.5 hours', nearest half."""
    half = round(hours * 2) / 2
    if half == int(half):
        n = int(half)
        return f"about {n} hour" if n == 1 else f"about {n} hours"
    return f"about {half:.1f} hours"


def _plural(n, singular, plural):
    return singular if n == 1 else plural


@router.get("/insights/today", response_model=schemas.TodayInsights)
def get_today(
    tz_offset_min: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
):
    """The wind-down: an honest, grounded recap of *today* in local time.

    tz_offset_min is JS Date.getTimezoneOffset() (minutes; UTC+1 -> -60). We
    store naive UTC, so local = utc - offset and the day window converts back
    via utc = local + offset.
    """
    now_utc = datetime.utcnow()
    local_now = now_utc - timedelta(minutes=tz_offset_min)
    local_day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = local_day_start + timedelta(minutes=tz_offset_min)
    day_end = day_start + timedelta(days=1)
    date_str = local_now.strftime("%Y-%m-%d")

    def entry_join():
        return (
            db.query(models.Entry, models.Thread, models.Area)
            .join(models.Thread, models.Entry.thread_id == models.Thread.id)
            .join(models.Area, models.Thread.area_id == models.Area.id)
        )

    # ── Closed loops ──────────────────────────────────────────────────────────
    # Top-level todos completed today (subtasks excluded so we count what the
    # user thinks of as "a todo").
    todo_rows = (
        entry_join()
        .filter(
            models.Entry.type == "todo",
            models.Entry.completed.is_(True),
            models.Entry.parent_id.is_(None),
            models.Entry.completed_at >= day_start,
            models.Entry.completed_at < day_end,
        )
        .all()
    )
    decision_rows = (
        entry_join()
        .filter(
            models.Entry.type == "decision",
            models.Entry.created_at >= day_start,
            models.Entry.created_at < day_end,
        )
        .all()
    )

    # Status transitions today, from the audit log. Dedup by thread (keep latest).
    def _status_changes(predicate):
        rows = (
            db.query(models.AuditLog, models.Thread, models.Area)
            .join(models.Thread, models.AuditLog.thread_id == models.Thread.id)
            .join(models.Area, models.Thread.area_id == models.Area.id)
            .filter(
                models.AuditLog.field == "status",
                models.AuditLog.occurred_at >= day_start,
                models.AuditLog.occurred_at < day_end,
            )
            .order_by(models.AuditLog.occurred_at.asc())
            .all()
        )
        by_thread = {}
        for log, thread, area in rows:
            if predicate(log):
                by_thread[thread.id] = (log, thread, area)
        return list(by_thread.values())

    resolved_rows = _status_changes(lambda l: l.new_value == "resolved")
    cleared_rows = _status_changes(lambda l: l.old_value == "blocked" and l.new_value != "blocked")

    n_todos = len(todo_rows)
    n_decisions = len(decision_rows)
    n_resolved = len(resolved_rows)
    n_cleared = len(cleared_rows)

    # ── Meetings attended today (in the past, this calendar day) ──────────────
    meeting_rows = (
        entry_join()
        .filter(
            models.Entry.type == "meeting",
            models.Entry.meeting_at >= day_start,
            models.Entry.meeting_at <= now_utc,
        )
        .order_by(models.Entry.meeting_at.asc())
        .all()
    )

    # ── Progress: which threads got the most new entries today ────────────────
    prog_rows = (
        db.query(
            models.Thread.id, models.Thread.title, models.Area.name,
            func.count(models.Entry.id),
        )
        .select_from(models.Entry)
        .join(models.Thread, models.Entry.thread_id == models.Thread.id)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(models.Entry.created_at >= day_start, models.Entry.created_at < day_end)
        .group_by(models.Thread.id)
        .order_by(func.count(models.Entry.id).desc())
        .limit(3)
        .all()
    )

    # ── Threads created today, grouped by area ────────────────────────────────
    created_rows = (
        db.query(models.Area.name, func.count(models.Thread.id))
        .join(models.Thread, models.Thread.area_id == models.Area.id)
        .filter(models.Thread.created_at >= day_start, models.Thread.created_at < day_end)
        .group_by(models.Area.id)
        .all()
    )

    # ── Jira ──────────────────────────────────────────────────────────────────
    jira_connected = db.query(models.JiraIntegration).first() is not None
    jira_filed_today = 0
    jira_pending = 0
    if jira_connected:
        jira_pending = (
            db.query(func.count(models.SignalItem.id))
            .filter(models.SignalItem.source == "jira", models.SignalItem.status == "pending")
            .scalar()
        ) or 0
        jira_filed_today = (
            db.query(func.count(models.SignalItem.id))
            .join(models.Entry, models.SignalItem.assigned_entry_id == models.Entry.id)
            .filter(
                models.SignalItem.source == "jira",
                models.SignalItem.status == "assigned",
                models.Entry.created_at >= day_start,
                models.Entry.created_at < day_end,
            )
            .scalar()
        ) or 0

    # ── Working window (heartbeat-derived) ────────────────────────────────────
    start_at, last_end, _active_seconds = working_window(db, day_start, day_end)
    active_hours = ((now_utc - start_at).total_seconds() / 3600) if start_at else None
    finishes = recent_finishes(db, now_utc, tz_offset_min, days=7)
    early = [h for h in finishes if h <= 18.0]
    reasonable_finish = len(finishes) >= 3 and len(early) >= max(2, len(finishes) - 1)

    # ── Assemble chips + done list ────────────────────────────────────────────
    chips = []
    if n_todos:
        chips.append(schemas.TodayChip(type="todo", label=f"{_plural(n_todos, 'todo', 'todos')} done", count=n_todos))
    if n_decisions:
        chips.append(schemas.TodayChip(type="decision", label=f"{_plural(n_decisions, 'decision', 'decisions')} made", count=n_decisions))
    if n_cleared:
        chips.append(schemas.TodayChip(type="blockage", label=f"{_plural(n_cleared, 'blocker', 'blockers')} cleared", count=n_cleared))
    if n_resolved:
        chips.append(schemas.TodayChip(type="resolved", label=f"{_plural(n_resolved, 'thread', 'threads')} resolved", count=n_resolved))
    if jira_filed_today:
        chips.append(schemas.TodayChip(type="jira", label=f"Jira {_plural(jira_filed_today, 'item', 'items')} filed", count=jira_filed_today))

    headline_count = sum(c.count for c in chips)

    done_items = []
    for e, t, a in todo_rows:
        done_items.append(schemas.TodayDoneItem(id=e.id, type="todo", content=e.content, area_name=a.name, thread_id=t.id, at=e.completed_at))
    for e, t, a in decision_rows:
        done_items.append(schemas.TodayDoneItem(id=e.id, type="decision", content=e.content, area_name=a.name, thread_id=t.id, at=e.created_at))
    for log, t, a in cleared_rows:
        done_items.append(schemas.TodayDoneItem(id=t.id, type="blockage", content=t.title, area_name=a.name, thread_id=t.id, at=log.occurred_at))
    for log, t, a in resolved_rows:
        done_items.append(schemas.TodayDoneItem(id=t.id, type="resolved", content=t.title, area_name=a.name, thread_id=t.id, at=log.occurred_at))
    done_items.sort(key=lambda d: d.at or datetime.min, reverse=True)

    meetings = [
        schemas.TodayMeeting(id=e.id, content=e.content, area_name=a.name, thread_id=t.id, at=e.meeting_at)
        for e, t, a in meeting_rows
    ]
    threads_progressed = [
        schemas.TodayProgressThread(thread_id=tid, title=title, area_name=aname, count=cnt)
        for tid, title, aname, cnt in prog_rows
    ]
    threads_created = [
        schemas.TodayCreatedGroup(area_name=aname, count=cnt) for aname, cnt in created_rows
    ]

    # ── Narrative (grounded; AI phrases, template falls back) ─────────────────
    facts = {
        "started_label": _fmt_local_time(start_at, tz_offset_min),
        "hours_phrase": _hours_phrase(active_hours) if active_hours and active_hours >= 0.5 else None,
        "reasonable_finish": reasonable_finish,
        "n_todos": n_todos,
        "n_decisions": n_decisions,
        "n_cleared": n_cleared,
        "n_resolved": n_resolved,
        "meetings_count": len(meetings),
        "top_thread": (
            {"title": threads_progressed[0].title, "count": threads_progressed[0].count}
            if threads_progressed and threads_progressed[0].count >= 2 else None
        ),
        "threads_created": [{"area": g.area_name, "count": g.count} for g in threads_created],
        "jira_connected": jira_connected,
        "jira_filed_today": jira_filed_today,
        "jira_pending": jira_pending,
    }
    narrative, ai_generated = _narrative(db, facts)

    return schemas.TodayInsights(
        date=date_str,
        started_at=start_at,
        last_active_at=last_end,
        active_hours=round(active_hours, 2) if active_hours is not None else None,
        headline_count=headline_count,
        breakdown=chips,
        done_items=done_items,
        meetings_count=len(meetings),
        meetings=meetings,
        threads_progressed=threads_progressed,
        threads_created=threads_created,
        jira_connected=jira_connected,
        jira_filed_today=jira_filed_today,
        jira_pending=jira_pending,
        narrative=narrative,
        ai_generated=ai_generated,
    )


def _narrative(db, f):
    """Return (text, ai_generated).

    The deterministic template is the single source of truth for every fact.
    When an AI provider is configured we ask it only to *reword that draft* more
    warmly, holding every number and name fixed - it never sees the raw figures,
    so it cannot sum or relabel them (an earlier free-synthesis version summed
    per-area thread counts into a wrong total). A final numeric guard rejects any
    AI output that introduces a number absent from the draft, falling back to the
    template. Accuracy first, warmth second."""
    template = _template_narrative(f)
    has_facts = bool(
        f["n_todos"] or f["n_decisions"] or f["n_cleared"] or f["n_resolved"]
        or f["meetings_count"] or f["top_thread"] or f["jira_filed_today"]
        or f["threads_created"] or f["started_label"]
    )
    if not has_facts:
        # Nothing logged and no presence - keep the template's kind message.
        return template, False

    system = (
        "You gently reword a short end-of-day message for someone using Effro, a "
        "calm work app for people with ADHD. The goal is to help them feel it is "
        "okay to stop for the day.\n"
        "Follow these rules exactly:\n"
        "- Keep every number, name, and fact from the draft EXACTLY as written. "
        "Never add, remove, sum, combine, or change any number or detail.\n"
        "- Do not introduce any new count, fact, or noun that is not in the draft.\n"
        "- Never mention undone work or tomorrow.\n"
        "- 2 to 3 short, warm sentences, second person.\n"
        "- End by gently giving permission to stop for the day.\n"
        "- No em dashes, no bullet points, no preamble, no headings."
    )
    user_msg = (
        "Draft:\n" + template +
        "\n\nReword the draft to feel warm and natural, keeping every fact and "
        "number exactly as written."
    )
    try:
        from ai_provider import get_provider
        provider = get_provider(db)
        ok, _ = provider.test()
        if ok:
            text = provider.complete(
                system=system,
                messages=[{"role": "user", "content": user_msg}],
                max_tokens=200,
            )
            text = (text or "").strip()
            if text and not _introduces_numbers(text, template):
                return text, True
    except Exception:
        pass
    return template, False


def _introduces_numbers(candidate, draft):
    """True if `candidate` contains an integer not present in `draft`. The
    backstop against the AI inventing or summing figures."""
    draft_nums = set(re.findall(r"\d+", draft))
    return any(n not in draft_nums for n in re.findall(r"\d+", candidate))


def _template_narrative(f):
    """Deterministic fallback. Same facts, fixed phrasing. Always accurate."""
    parts = []
    if f["started_label"] and f["hours_phrase"]:
        parts.append(f"You started around {f['started_label']} and have been at it for {f['hours_phrase']}.")
    elif f["started_label"]:
        parts.append(f"You started around {f['started_label']} today.")

    done = []
    if f["n_todos"]:
        done.append(f"{f['n_todos']} {_plural(f['n_todos'], 'todo', 'todos')}")
    if f["n_resolved"]:
        done.append(f"{f['n_resolved']} {_plural(f['n_resolved'], 'thread', 'threads')}")
    if f["n_cleared"]:
        done.append(f"cleared {f['n_cleared']} {_plural(f['n_cleared'], 'blocker', 'blockers')}")
    if done:
        parts.append("You closed " + _join_clauses(done) + ".")
    if f["n_decisions"]:
        parts.append(f"You made {f['n_decisions']} {_plural(f['n_decisions'], 'decision', 'decisions')}.")
    if f["meetings_count"]:
        parts.append(f"You sat through {f['meetings_count']} {_plural(f['meetings_count'], 'meeting', 'meetings')} too.")
    if f["top_thread"]:
        parts.append(f"Good progress on {f['top_thread']['title']}.")
    created_total = sum(g["count"] for g in f["threads_created"])
    if created_total:
        noun = _plural(created_total, "new thread", "new threads")
        if len(f["threads_created"]) == 1:
            parts.append(f"You set up {created_total} {noun} in {f['threads_created'][0]['area']}.")
        else:
            parts.append(f"You set up {created_total} {noun}.")
    if f["jira_filed_today"]:
        parts.append(f"You filed {f['jira_filed_today']} Jira {_plural(f['jira_filed_today'], 'item', 'items')} into threads.")

    anything = bool(done or f["n_decisions"] or f["meetings_count"] or f["top_thread"] or created_total or f["jira_filed_today"])
    if anything:
        parts.append("That is a real day's work. Switch off and walk away with a clear conscience.")
    else:
        parts.append("A quieter day, and that is completely fine. Rest is part of the work too.")
    return " ".join(parts)


def _join_clauses(items):
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


# ─── Shared aggregate helpers (Reflect-week / Ahead / Balance) ────────────────

def _day_bounds(now_utc, tz_offset_min, offset_days):
    """UTC [start, end) for the local calendar day `offset_days` from today, plus
    the naive local-day datetime (for labels). offset_days: 0=today, -1=yesterday."""
    local_now = now_utc - timedelta(minutes=tz_offset_min)
    local_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=offset_days)
    start = local_day + timedelta(minutes=tz_offset_min)
    return start, start + timedelta(days=1), local_day


def _work_done(db, start, end):
    """Closed-loop computation shared by Today and Reflect-week. Returns chips,
    done_items, headline and the resolved/cleared rows (for celebrations). Same
    rules as the Today endpoint - the single definition of 'a thing done'."""
    def entry_join():
        return (
            db.query(models.Entry, models.Thread, models.Area)
            .join(models.Thread, models.Entry.thread_id == models.Thread.id)
            .join(models.Area, models.Thread.area_id == models.Area.id)
        )

    todo_rows = entry_join().filter(
        models.Entry.type == "todo", models.Entry.completed.is_(True),
        models.Entry.parent_id.is_(None),
        models.Entry.completed_at >= start, models.Entry.completed_at < end,
    ).all()
    decision_rows = entry_join().filter(
        models.Entry.type == "decision",
        models.Entry.created_at >= start, models.Entry.created_at < end,
    ).all()

    def _status_changes(predicate):
        rows = (
            db.query(models.AuditLog, models.Thread, models.Area)
            .join(models.Thread, models.AuditLog.thread_id == models.Thread.id)
            .join(models.Area, models.Thread.area_id == models.Area.id)
            .filter(
                models.AuditLog.field == "status",
                models.AuditLog.occurred_at >= start, models.AuditLog.occurred_at < end,
            )
            .order_by(models.AuditLog.occurred_at.asc())
            .all()
        )
        by_thread = {}
        for log, thread, area in rows:
            if predicate(log):
                by_thread[thread.id] = (log, thread, area)
        return list(by_thread.values())

    resolved_rows = _status_changes(lambda l: l.new_value == "resolved")
    cleared_rows = _status_changes(lambda l: l.old_value == "blocked" and l.new_value != "blocked")

    jira_filed = 0
    if db.query(models.JiraIntegration).first() is not None:
        jira_filed = (
            db.query(func.count(models.SignalItem.id))
            .join(models.Entry, models.SignalItem.assigned_entry_id == models.Entry.id)
            .filter(
                models.SignalItem.source == "jira", models.SignalItem.status == "assigned",
                models.Entry.created_at >= start, models.Entry.created_at < end,
            )
            .scalar()
        ) or 0

    n_todos, n_dec = len(todo_rows), len(decision_rows)
    n_res, n_clr = len(resolved_rows), len(cleared_rows)

    chips = []
    if n_todos:
        chips.append(schemas.TodayChip(type="todo", label=f"{_plural(n_todos, 'todo', 'todos')} done", count=n_todos))
    if n_dec:
        chips.append(schemas.TodayChip(type="decision", label=f"{_plural(n_dec, 'decision', 'decisions')} made", count=n_dec))
    if n_clr:
        chips.append(schemas.TodayChip(type="blockage", label=f"{_plural(n_clr, 'blocker', 'blockers')} cleared", count=n_clr))
    if n_res:
        chips.append(schemas.TodayChip(type="resolved", label=f"{_plural(n_res, 'thread', 'threads')} resolved", count=n_res))
    if jira_filed:
        chips.append(schemas.TodayChip(type="jira", label=f"Jira {_plural(jira_filed, 'item', 'items')} filed", count=jira_filed))

    done_items = []
    for e, t, a in todo_rows:
        done_items.append(schemas.TodayDoneItem(id=e.id, type="todo", content=e.content, area_name=a.name, thread_id=t.id, at=e.completed_at))
    for e, t, a in decision_rows:
        done_items.append(schemas.TodayDoneItem(id=e.id, type="decision", content=e.content, area_name=a.name, thread_id=t.id, at=e.created_at))
    for log, t, a in cleared_rows:
        done_items.append(schemas.TodayDoneItem(id=t.id, type="blockage", content=t.title, area_name=a.name, thread_id=t.id, at=log.occurred_at))
    for log, t, a in resolved_rows:
        done_items.append(schemas.TodayDoneItem(id=t.id, type="resolved", content=t.title, area_name=a.name, thread_id=t.id, at=log.occurred_at))
    done_items.sort(key=lambda d: d.at or datetime.min, reverse=True)

    return {
        "chips": chips, "done_items": done_items,
        "headline": sum(c.count for c in chips),
        "counts": {"todos": n_todos, "decisions": n_dec, "cleared": n_clr, "resolved": n_res, "jira": jira_filed},
        "resolved": resolved_rows, "cleared": cleared_rows,
    }


def _quietest_area(db, now):
    """(name, days) for the area longest without activity, only if >= 7 days."""
    best = None
    for a in db.query(models.Area).all():
        tids = [t.id for t in a.threads]
        last = db.query(func.max(models.Entry.created_at)).filter(models.Entry.thread_id.in_(tids)).scalar() if tids else None
        days = _days_since(last, now) if last else None
        if days is not None and days >= 7 and (best is None or days > best[1]):
            best = (a.name, days)
    return best


def _reengagements(db, start, now):
    """Areas active this week after a gap of >= 7 days. (name, gap_days)."""
    out = []
    for a in db.query(models.Area).all():
        tids = [t.id for t in a.threads]
        if not tids:
            continue
        first_in = db.query(func.min(models.Entry.created_at)).filter(
            models.Entry.thread_id.in_(tids), models.Entry.created_at >= start, models.Entry.created_at <= now
        ).scalar()
        if not first_in:
            continue
        prev = db.query(func.max(models.Entry.created_at)).filter(
            models.Entry.thread_id.in_(tids), models.Entry.created_at < start
        ).scalar()
        if prev:
            gap = (first_in - prev).days
            if gap >= 7:
                out.append((a.name, gap))
    return out


@router.get("/insights/week", response_model=schemas.WeekInsights)
def get_week(tz_offset_min: int = Query(default=0, ge=-840, le=840), db: Session = Depends(get_db)):
    """Reflect → This week: closed loops, earned celebrations, working-day bars,
    14-day rhythm, and the deterministic top 'what to notice' line."""
    now = datetime.utcnow()
    window_start = now - timedelta(days=7)
    wd = _work_done(db, window_start, now)

    # Celebrations - earned only.
    celebrations = []
    for log, t, a in wd["cleared"]:
        celebrations.append(schemas.Celebration(type="unblocked", text=f"You cleared the blocker on {t.title}."))
    for log, t, a in wd["resolved"]:
        age = (now - t.created_at).days if t.created_at else None
        txt = f"You resolved {t.title}" + (f" after {age} days." if age and age >= 1 else ".")
        celebrations.append(schemas.Celebration(type="resolved", text=txt))
    for name, gap in _reengagements(db, window_start, now):
        celebrations.append(schemas.Celebration(type="comeback", text=f"You came back to {name} after {gap} quiet days."))
    if wd["counts"]["decisions"]:
        d = wd["counts"]["decisions"]
        celebrations.append(schemas.Celebration(type="decisions", text=f"You made {d} {_plural(d, 'decision', 'decisions')} this week."))
    celebrations = celebrations[:5]

    # Working-day bars (last 7 local days).
    your_days = []
    for i in range(6, -1, -1):
        s, e, local_day = _day_bounds(now, tz_offset_min, -i)
        start_at, last_end, _secs = working_window(db, s, e)
        if start_at:
            ref_end = now if i == 0 else last_end
            hours = (ref_end - start_at).total_seconds() / 3600
            sl = start_at - timedelta(minutes=tz_offset_min)
            el = ref_end - timedelta(minutes=tz_offset_min)
            your_days.append(schemas.WorkDay(
                label="Today" if i == 0 else local_day.strftime("%a"),
                start_hour=round(sl.hour + sl.minute / 60.0, 2),
                end_hour=round(el.hour + el.minute / 60.0, 2),
                active_hours=round(hours, 2), over=hours > 9,
            ))
        else:
            your_days.append(schemas.WorkDay(label="Today" if i == 0 else local_day.strftime("%a")))

    # 14-day rhythm (entries created per local day).
    rhythm = []
    for i in range(13, -1, -1):
        s, e, local_day = _day_bounds(now, tz_offset_min, -i)
        cnt = db.query(func.count(models.Entry.id)).filter(
            models.Entry.created_at >= s, models.Entry.created_at < e
        ).scalar() or 0
        rhythm.append(schemas.RhythmDay(
            label=local_day.strftime("%a")[0], count=int(cnt),
            weekend=local_day.weekday() >= 5, is_today=(i == 0),
        ))

    # Top narrative line - deterministic, always accurate.
    top = (
        db.query(models.Area.name, func.count(models.Entry.id))
        .select_from(models.Entry)
        .join(models.Thread, models.Entry.thread_id == models.Thread.id)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(models.Entry.created_at >= window_start, models.Entry.created_at <= now)
        .group_by(models.Area.id).order_by(func.count(models.Entry.id).desc()).first()
    )
    parts = []
    if top and top[1] > 0:
        parts.append(f"Your week went to {top[0]}.")
    if wd["headline"]:
        d = wd["counts"]["decisions"]
        s = f"You closed {wd['headline']} {_plural(wd['headline'], 'thing', 'things')}"
        if d:
            s += f", including {d} {_plural(d, 'decision', 'decisions')}"
        parts.append(s + ".")
    q = _quietest_area(db, now)
    if q:
        parts.append(f"{q[0]} has been quiet for {q[1]} days.")
    narrative = " ".join(parts) if parts else "A calm week so far."

    return schemas.WeekInsights(
        narrative=narrative, headline_count=wd["headline"], breakdown=wd["chips"],
        closed_items=wd["done_items"][:8], celebrations=celebrations,
        your_days=your_days, rhythm=rhythm,
    )


def _count_load(db, start, end):
    """Meetings + open due-todos scheduled in [start, end)."""
    meetings = db.query(func.count(models.Entry.id)).filter(
        models.Entry.type == "meeting", models.Entry.meeting_at >= start, models.Entry.meeting_at < end
    ).scalar() or 0
    todos = db.query(func.count(models.Entry.id)).filter(
        models.Entry.type == "todo", models.Entry.completed.is_(False),
        models.Entry.due_date >= start.date(), models.Entry.due_date < end.date(),
    ).scalar() or 0
    return schemas.LoadCount(meetings=int(meetings), todos=int(todos))


@router.get("/insights/ahead", response_model=schemas.AheadInsights)
def get_ahead(tz_offset_min: int = Query(default=0, ge=-840, le=840), db: Session = Depends(get_db)):
    """Ahead: next meeting, a 10-day timeline of meetings + due todos, a load
    forecast, and an optional 'good window' pairing a quiet area with a light day."""
    now = datetime.utcnow()

    def entry_join():
        return (
            db.query(models.Entry, models.Thread, models.Area)
            .join(models.Thread, models.Entry.thread_id == models.Thread.id)
            .join(models.Area, models.Thread.area_id == models.Area.id)
        )

    nm = entry_join().filter(
        models.Entry.type == "meeting", models.Entry.meeting_at > now
    ).order_by(models.Entry.meeting_at.asc()).first()
    next_meeting = None
    if nm:
        e, t, a = nm
        next_meeting = schemas.TodayMeeting(id=e.id, content=e.content, area_name=a.name, thread_id=t.id, at=e.meeting_at)

    timeline = []
    light_day_label = None
    for i in range(0, 10):
        s, e, local_day = _day_bounds(now, tz_offset_min, i)
        items = []
        start_bound = now if i == 0 else s
        for entry, t, a in entry_join().filter(
            models.Entry.type == "meeting", models.Entry.meeting_at >= start_bound, models.Entry.meeting_at < e
        ).order_by(models.Entry.meeting_at.asc()).all():
            items.append(schemas.TimelineItem(kind="meeting", content=entry.content, area_name=a.name, time_local=_fmt_local_time(entry.meeting_at, tz_offset_min)))
        for entry, t, a in entry_join().filter(
            models.Entry.type == "todo", models.Entry.completed.is_(False), models.Entry.due_date == local_day.date()
        ).all():
            items.append(schemas.TimelineItem(kind="todo", content=entry.content, area_name=a.name))
        weekend = local_day.weekday() >= 5
        timeline.append(schemas.TimelineDay(
            iso_date=local_day.strftime("%Y-%m-%d"),
            label="now" if i == 0 else ("tmrw" if i == 1 else local_day.strftime("%a")[0]),
            day_num=local_day.strftime("%d"), weekend=weekend, is_today=(i == 0), items=items,
        ))
        if light_day_label is None and i >= 1 and not weekend and not items:
            light_day_label = local_day.strftime("%A")

    forecast_next = _count_load(db, now, now + timedelta(days=7))
    forecast_prev = _count_load(db, now - timedelta(days=7), now)

    good_window = None
    q = _quietest_area(db, now)
    if q:
        good_window = schemas.GoodWindow(area_name=q[0], quiet_days=q[1], day_label=light_day_label)

    return schemas.AheadInsights(
        next_meeting=next_meeting, timeline=timeline,
        forecast_next=forecast_next, forecast_prev=forecast_prev, good_window=good_window,
    )


@router.get("/insights/balance", response_model=schemas.BalanceInsights)
def get_balance(tz_offset_min: int = Query(default=0, ge=-840, le=840), db: Session = Depends(get_db)):
    """Balance: per-area 14-day activity (totals + sparkline series + quiet days),
    a drift list, and 'not on you' (currently-blocked threads)."""
    now = datetime.utcnow()
    # Precompute the 14 local-day windows once.
    windows = [_day_bounds(now, tz_offset_min, -i)[:2] for i in range(13, -1, -1)]

    areas_out, drift = [], []
    for a in db.query(models.Area).order_by(models.Area.id).all():
        tids = [t.id for t in a.threads]
        series = []
        for s, e in windows:
            c = db.query(func.count(models.Entry.id)).filter(
                models.Entry.thread_id.in_(tids), models.Entry.created_at >= s, models.Entry.created_at < e
            ).scalar() if tids else 0
            series.append(int(c or 0))
        last = db.query(func.max(models.Entry.created_at)).filter(models.Entry.thread_id.in_(tids)).scalar() if tids else None
        qd = _days_since(last, now) if last else None
        areas_out.append(schemas.AreaBalance(
            area_id=a.id, name=a.name, icon=a.icon, status=a.status,
            total=sum(series), series=series, quiet_days=qd,
        ))
        if qd is not None and qd >= 7:
            drift.append(schemas.DriftArea(area_id=a.id, name=a.name, quiet_days=qd))
    drift.sort(key=lambda d: -d.quiet_days)

    blocked = (
        db.query(models.Thread, models.Area)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(models.Thread.status == "blocked").all()
    )
    not_on_you = [schemas.NotOnYou(thread_id=t.id, title=t.title, area_name=a.name) for t, a in blocked]

    return schemas.BalanceInsights(areas=areas_out, drift=drift, not_on_you=not_on_you)
