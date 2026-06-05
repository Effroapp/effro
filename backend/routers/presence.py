"""
Presence / heartbeat - infers the user's working day from app activity.

The frontend pings POST /api/heartbeat every few minutes while the app is
focused. Each ping extends the current WorkSession, or opens a new one when
the gap exceeds SESSION_GAP_MINUTES. From those sessions we can answer, for any
day, "when did you start, when did you stop, how long were you active" - which
is what the Insights wind-down needs to be honest about ("you started around
9:00 and it has been about eight hours").

Storing merged sessions (rather than a row per ping) keeps the table tiny and,
crucially, lets us discount an isolated late-night check-in: it becomes its own
2-second session and is dropped from the day's span by the MIN_SESSION_SECONDS
guard, so a quick 11pm glance never reports a 14-hour day.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

import models
from database import get_db

router = APIRouter(tags=["presence"])

# A gap longer than this starts a fresh session. ~matches "stepped away".
SESSION_GAP_MINUTES = 30
# Sessions shorter than this are treated as incidental (a glance, a single
# ping) and excluded when computing the day's start/stop span.
MIN_SESSION_SECONDS = 120


@router.post("/heartbeat")
def heartbeat(db: Session = Depends(get_db)):
    """Record presence. Idempotent-ish: extends the live session or starts one."""
    now = datetime.utcnow()
    last = (
        db.query(models.WorkSession)
        .order_by(models.WorkSession.ended_at.desc())
        .first()
    )
    if last and (now - last.ended_at) <= timedelta(minutes=SESSION_GAP_MINUTES):
        last.ended_at = now
        last.ping_count = (last.ping_count or 1) + 1
    else:
        db.add(models.WorkSession(started_at=now, ended_at=now, ping_count=1))
    db.commit()
    return {"ok": True}


def working_window(db: Session, start_utc: datetime, end_utc: datetime):
    """Return (first_start, last_end, active_seconds) for sessions overlapping
    [start_utc, end_utc), or (None, None, 0) when there's no presence.

    The span (first_start -> last_end) ignores incidental sessions shorter than
    MIN_SESSION_SECONDS so an isolated ping doesn't distort the day. active_seconds
    is the summed duration of all (clipped) sessions - real time at the keyboard.
    """
    sessions = (
        db.query(models.WorkSession)
        .filter(
            models.WorkSession.ended_at >= start_utc,
            models.WorkSession.started_at < end_utc,
        )
        .order_by(models.WorkSession.started_at)
        .all()
    )
    clipped = []
    for s in sessions:
        st = max(s.started_at, start_utc)
        en = min(s.ended_at, end_utc)
        if en > st:
            clipped.append((st, en))
    if not clipped:
        return None, None, 0

    meaningful = [(st, en) for (st, en) in clipped if (en - st).total_seconds() >= MIN_SESSION_SECONDS]
    span_src = meaningful or clipped
    first_start = min(st for st, _ in span_src)
    last_end = max(en for _, en in span_src)
    active_seconds = sum((en - st).total_seconds() for st, en in clipped)
    return first_start, last_end, active_seconds


def recent_finishes(db: Session, before_utc: datetime, tz_offset_min: int, days: int = 7):
    """Return the last-active *local hour* for each of the previous `days` days
    that had presence (most recent first). Used to judge "wrapping up at a
    reasonable hour lately" without claiming anything on days you didn't work.
    """
    out = []
    for i in range(1, days + 1):
        day_local_start = (before_utc - timedelta(minutes=tz_offset_min)).replace(
            hour=0, minute=0, second=0, microsecond=0
        ) - timedelta(days=i)
        ds_utc = day_local_start + timedelta(minutes=tz_offset_min)
        de_utc = ds_utc + timedelta(days=1)
        _, last_end, _ = working_window(db, ds_utc, de_utc)
        if last_end is not None:
            local_end = last_end - timedelta(minutes=tz_offset_min)
            out.append(local_end.hour + local_end.minute / 60.0)
    return out
