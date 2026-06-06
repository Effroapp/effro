"""
Signals router - the triage surface.

Items arrive automatically via the Microsoft sync (30-min APScheduler job +
manual /microsoft/sync-now) and land in signal_items. The user accepts /
reassigns / dismisses each one; on accept, the item is committed as a
meeting Entry on the chosen thread, with `external_id` carried over so a
later re-sync can update the entry if the upstream event moves.

Endpoints:
  GET    /signals                      - pending+assigned list, source-agnostic
  POST   /signals/{id}/accept          - create a meeting Entry, mark assigned
  POST   /signals/{id}/reassign        - change the AI's suggested area/thread
                                         without accepting yet
  POST   /signals/{id}/dismiss         - mark dismissed (won't auto-revive)
  GET    /signals/nudge-setting        - get the dashboard nudge mode
  PUT    /signals/nudge-setting        - set the dashboard nudge mode
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

log = logging.getLogger("trace.routers.signals")
router = APIRouter(prefix="/signals", tags=["signals"])

# app_settings key for the dashboard nudge mode (off / gentle / with-peek).
_NUDGE_SETTING_KEY = "signal_nudge_mode"
_VALID_NUDGE_MODES = {"off", "gentle", "with-peek"}


# ─── List ────────────────────────────────────────────────────────────────────

@router.get("", response_model=schemas.SignalListOut)
def list_signals(db: Session = Depends(get_db)):
    """Return pending + assigned signals, with the AI's suggested labels
    resolved to names (so the frontend doesn't need a second round-trip)."""
    rows = (
        db.query(models.SignalItem)
        .filter(models.SignalItem.status.in_(["pending", "assigned"]))
        .order_by(
            # Pending first (status='pending' < 'assigned' lex-wise, but be
            # explicit since 'a' < 'p').
            models.SignalItem.status.desc(),
            # Earliest meeting first, then most recent arrival.
            models.SignalItem.starts_at.asc().nulls_last(),
            models.SignalItem.created_at.desc(),
        )
        .all()
    )

    # Resolve area + thread names in batch to avoid N+1.
    area_ids = {r.suggested_area_id for r in rows if r.suggested_area_id}
    thread_ids = {r.suggested_thread_id for r in rows if r.suggested_thread_id}
    areas = {a.id: a.name for a in db.query(models.Area).filter(models.Area.id.in_(area_ids)).all()} if area_ids else {}
    threads = {t.id: t.title for t in db.query(models.Thread).filter(models.Thread.id.in_(thread_ids)).all()} if thread_ids else {}

    # Jira site host (for "Open in Jira" deep links) - looked up once.
    _jira = db.query(models.JiraIntegration).first() if any(r.source == "jira" for r in rows) else None
    jira_host = _jira.cloud_name if _jira else None

    def _external_url(r):
        if r.source == "jira" and jira_host and r.external_id:
            return f"https://{jira_host}/browse/{r.external_id}"
        if r.source in ("microsoft", "google", "github") and r.raw_json:
            try:
                d = json.loads(r.raw_json)
                # MS events: webLink. Google calendar: htmlLink. Gmail/GitHub: ...
                return d.get("webLink") or d.get("htmlLink") or d.get("html_url") or None
            except (ValueError, AttributeError):
                return None
        return None

    items = [
        schemas.SignalItemOut(
            id=r.id,
            source=r.source,
            external_id=r.external_id,
            kind=r.kind,
            title=r.title,
            starts_at=r.starts_at,
            ends_at=r.ends_at,
            location=r.location,
            organizer=r.organizer,
            is_all_day=r.is_all_day,
            status=r.status,
            suggested_area_id=r.suggested_area_id,
            suggested_area_name=areas.get(r.suggested_area_id) if r.suggested_area_id else None,
            suggested_thread_id=r.suggested_thread_id,
            suggested_thread_title=threads.get(r.suggested_thread_id) if r.suggested_thread_id else None,
            assigned_entry_id=r.assigned_entry_id,
            external_url=_external_url(r),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]

    pending = sum(1 for r in rows if r.status == "pending")

    # Surface AI-configured state so the frontend can show "AI couldn't suggest
    # an area" vs "AI is unconfigured" with the right copy.
    ai_configured = _is_ai_configured(db)

    # Freshness: the most recent successful pull across connected sources, so
    # the page can show "synced a few minutes ago".
    sync_times = [
        t for t in (
            db.query(models.MicrosoftIntegration.last_synced).scalar(),
            db.query(models.JiraIntegration.last_synced).scalar(),
        ) if t is not None
    ]
    last_synced = max(sync_times) if sync_times else None

    return schemas.SignalListOut(
        items=items,
        pending_count=pending,
        ai_configured=ai_configured,
        last_synced=last_synced,
    )


def _is_ai_configured(db: Session) -> bool:
    """Probe the AI provider config without making a network call."""
    try:
        from ai_provider import get_provider
        provider = get_provider(db)
        # provider.test() makes a network call - we just want to know whether
        # config exists. Look for the underlying record.
        row = (
            db.query(models.AppSettings)
            .filter(models.AppSettings.key == "ai_config")
            .first()
        )
        if not row or not row.value:
            return False
        cfg = json.loads(row.value)
        return bool(cfg.get("provider"))
    except Exception:
        return False


# ─── Accept / Reassign / Dismiss ────────────────────────────────────────────

@router.post("/{signal_id}/accept", response_model=schemas.SignalItemOut)
def accept_signal(
    signal_id: int,
    payload: schemas.SignalAcceptIn,
    db: Session = Depends(get_db),
):
    """Commit a pending signal as a meeting Entry on the chosen thread.

    The thread is either an existing one (thread_id given) or a brand-new
    thread under the chosen area (new_thread_title given). The signal flips
    to 'assigned' and points at the new Entry.id; future syncs that update
    the upstream event will mutate that Entry in place via external_id.
    """
    signal = db.query(models.SignalItem).filter(models.SignalItem.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    if signal.status != "pending":
        raise HTTPException(status_code=400, detail=f"Signal is {signal.status}, only pending signals can be accepted")

    area = db.query(models.Area).filter(models.Area.id == payload.area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")

    if payload.thread_id:
        thread = (
            db.query(models.Thread)
            .filter(
                models.Thread.id == payload.thread_id,
                models.Thread.area_id == area.id,
            )
            .first()
        )
        if not thread:
            raise HTTPException(status_code=404, detail="Thread not found under the chosen area")
    else:
        title = (payload.new_thread_title or signal.title).strip() or signal.title
        thread = models.Thread(area_id=area.id, title=title, status="open", description="")
        db.add(thread)
        db.flush()

    # How the signal lands is the user's choice (create_as): a meeting, a todo,
    # or a logged note. When unspecified we pick a sensible default per kind -
    # calendar items become meetings, everything else (Jira, email) a todo.
    # external_id carries the upstream id so a future re-sync can find the entry.
    mode = (getattr(payload, "create_as", None) or "").strip().lower()
    if mode not in ("meeting", "todo", "note"):
        mode = "meeting" if signal.kind == "meeting" else "todo"

    if mode == "meeting":
        entry = models.Entry(
            thread_id=thread.id,
            content=signal.title,
            type="meeting",
            meeting_at=signal.starts_at,
            external_id=signal.external_id,
        )
    elif mode == "todo":
        # A real deadline only makes sense for time-bound (calendar) items.
        due = signal.starts_at.date() if (signal.starts_at and signal.kind == "meeting") else None
        entry = models.Entry(
            thread_id=thread.id,
            content=signal.title,
            type="todo",
            completed=False,
            due_date=due,
            external_id=signal.external_id,
        )
    else:  # note - a logged timeline entry, with a deep link when we have one
        link = None
        if signal.raw_json:
            try:
                d = json.loads(signal.raw_json)
                link = d.get("htmlLink") or d.get("webLink") or d.get("webViewLink")
            except (ValueError, AttributeError):
                link = None
        content = f"[{signal.title}]({link})" if link else signal.title
        if signal.organizer:
            content += f" (from {signal.organizer})"
        entry = models.Entry(
            thread_id=thread.id,
            content=content,
            type="entry",
            external_id=signal.external_id,
        )
    db.add(entry)
    db.flush()

    signal.status = "assigned"
    signal.assigned_entry_id = entry.id
    signal.suggested_area_id = area.id
    signal.suggested_thread_id = thread.id
    db.commit()
    db.refresh(signal)

    return _to_out(signal, db)


@router.post("/{signal_id}/reassign", response_model=schemas.SignalItemOut)
def reassign_signal(
    signal_id: int,
    payload: schemas.SignalReassignIn,
    db: Session = Depends(get_db),
):
    """Change the AI's suggested area/thread without committing yet.

    Useful when the user wants to override the suggestion before accepting -
    e.g. the AI guessed wrong, or the user wants to add a thread first.
    """
    signal = db.query(models.SignalItem).filter(models.SignalItem.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    if signal.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending signals can be reassigned")

    if payload.area_id is not None:
        area = db.query(models.Area).filter(models.Area.id == payload.area_id).first()
        if not area:
            raise HTTPException(status_code=404, detail="Area not found")
        signal.suggested_area_id = area.id

    if payload.thread_id is not None:
        thread = db.query(models.Thread).filter(models.Thread.id == payload.thread_id).first()
        if not thread:
            raise HTTPException(status_code=404, detail="Thread not found")
        signal.suggested_thread_id = thread.id
    else:
        # If only the area changed, clear the thread suggestion (the AI's old
        # thread was almost certainly in a different area).
        if payload.area_id is not None:
            signal.suggested_thread_id = None

    db.commit()
    db.refresh(signal)
    return _to_out(signal, db)


@router.post("/{signal_id}/dismiss", response_model=schemas.SignalItemOut)
def dismiss_signal(signal_id: int, db: Session = Depends(get_db)):
    """Mark a signal as dismissed. The 30-min re-sync won't auto-revive it
    (we keep the row so re-arrivals don't ping the user twice)."""
    signal = db.query(models.SignalItem).filter(models.SignalItem.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    if signal.status == "dismissed":
        return _to_out(signal, db)
    signal.status = "dismissed"
    db.commit()
    db.refresh(signal)
    return _to_out(signal, db)


def _to_out(signal: models.SignalItem, db: Session) -> schemas.SignalItemOut:
    """Serialise a single signal with area/thread names resolved."""
    area_name = None
    thread_title = None
    if signal.suggested_area_id:
        area = db.query(models.Area).filter(models.Area.id == signal.suggested_area_id).first()
        area_name = area.name if area else None
    if signal.suggested_thread_id:
        thread = db.query(models.Thread).filter(models.Thread.id == signal.suggested_thread_id).first()
        thread_title = thread.title if thread else None
    return schemas.SignalItemOut(
        id=signal.id,
        source=signal.source,
        external_id=signal.external_id,
        kind=signal.kind,
        title=signal.title,
        starts_at=signal.starts_at,
        ends_at=signal.ends_at,
        location=signal.location,
        organizer=signal.organizer,
        is_all_day=signal.is_all_day,
        status=signal.status,
        suggested_area_id=signal.suggested_area_id,
        suggested_area_name=area_name,
        suggested_thread_id=signal.suggested_thread_id,
        suggested_thread_title=thread_title,
        assigned_entry_id=signal.assigned_entry_id,
        created_at=signal.created_at,
        updated_at=signal.updated_at,
    )


# ─── Dashboard nudge mode setting ───────────────────────────────────────────

@router.get("/nudge-setting", response_model=schemas.SignalNudgeSettingOut)
def get_nudge_setting(db: Session = Depends(get_db)):
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _NUDGE_SETTING_KEY)
        .first()
    )
    mode = (row.value if row else None) or "gentle"
    if mode not in _VALID_NUDGE_MODES:
        mode = "gentle"
    return schemas.SignalNudgeSettingOut(mode=mode)


@router.put("/nudge-setting", response_model=schemas.SignalNudgeSettingOut)
def put_nudge_setting(
    payload: schemas.SignalNudgeSettingIn,
    db: Session = Depends(get_db),
):
    mode = payload.mode.strip()
    if mode not in _VALID_NUDGE_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {sorted(_VALID_NUDGE_MODES)}")
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _NUDGE_SETTING_KEY)
        .first()
    )
    if row:
        row.value = mode
    else:
        db.add(models.AppSettings(key=_NUDGE_SETTING_KEY, value=mode))
    db.commit()
    return schemas.SignalNudgeSettingOut(mode=mode)
