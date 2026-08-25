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
import os
import re
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from sqlalchemy import case
from sqlalchemy.orm import Session

import models
import schemas
from references import add_attachment
from database import get_db
from routers.attachments import UPLOAD_DIR, _ensure_upload_dir, _upload_to_remote

log = logging.getLogger("effro.routers.signals")
router = APIRouter(prefix="/signals", tags=["signals"])

# app_settings key for the dashboard nudge mode (off / gentle / with-peek).
_NUDGE_SETTING_KEY = "signal_nudge_mode"
_VALID_NUDGE_MODES = {"off", "gentle", "with-peek"}

_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


def _raw(signal: models.SignalItem) -> dict:
    try:
        return json.loads(signal.raw_json) if signal.raw_json else {}
    except (ValueError, AttributeError):
        return {}


def _deep_link(signal: models.SignalItem, jira_host: Optional[str] = None) -> Optional[str]:
    """The item's own URL in its source app, when one exists."""
    if signal.source == "jira" and jira_host and signal.external_id:
        return f"https://{jira_host}/browse/{signal.external_id}"
    d = _raw(signal)
    return d.get("webLink") or d.get("htmlLink") or d.get("html_url") or d.get("webViewLink") or None


def _link_url(signal: models.SignalItem, jira_host: Optional[str] = None) -> Optional[str]:
    """The URL an accept-as-Link attachment would point at: the deep link if
    the source has one, else the first URL inside the captured text (the
    'message your bot a link' case)."""
    url = _deep_link(signal, jira_host)
    if url:
        return url
    m = _URL_RE.search(_raw(signal).get("text") or signal.title or "")
    return m.group(0) if m else None


def _media(signal: models.SignalItem) -> Optional[dict]:
    """The downloadable attachment descriptor a Telegram capture carries."""
    media = _raw(signal).get("media")
    return media if isinstance(media, dict) and media.get("file_id") else None


def _jira_host(db: Session, signal: models.SignalItem) -> Optional[str]:
    if signal.source != "jira":
        return None
    j = db.query(models.JiraIntegration).first()
    return j.cloud_name if j else None


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
            # Meetings: soonest first (what's coming up). Everything else
            # (messages, emails, issues): newest first, like an inbox. The two
            # kinds sit in separate source groups in the UI, so meetings
            # sorting ahead of non-meetings overall is invisible there.
            case((models.SignalItem.kind == "meeting", models.SignalItem.starts_at)).asc().nulls_last(),
            case((models.SignalItem.kind != "meeting", models.SignalItem.starts_at)).desc().nulls_last(),
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
            external_url=_deep_link(r, jira_host),
            # Accept-as affordances: Link needs a URL (deep link or one found
            # in the captured text), File a downloadable Telegram attachment.
            link_url=_link_url(r, jira_host),
            has_media=_media(r) is not None,
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
        integrations_configured=_any_source_configured(db),
    )


@router.post("/sync-now")
def sync_all_sources(db: Session = Depends(get_db)):
    """Pull every connected source once - the Signals page's Sync button.
    Registry-driven (see connectors.py), so a new connector joins this fan-out
    by its registry entry alone. Per-source failures are reported, never
    raised: one broken connector must not block the rest."""
    import connectors
    results = {}
    for c in connectors.CONNECTORS:
        if not c.get("sync"):
            continue
        key = c["key"]
        if not connectors.connector_enabled(db, key):
            continue
        try:
            results[key] = connectors.sync_runner(key)(db)
        except Exception as e:
            log.warning("Sync-now: %s failed: %s", key, e)
            results[key] = {"skipped": True, "reason": "error", "error": str(e)}
    return {"sources": results}


@router.get("/suggestion-stats")
def suggestion_stats(db: Session = Depends(get_db)):
    """Aggregates over the corrections log, the evaluation surface for the
    area suggester. Accuracy counts only items where the AI made a call
    (accepted vs reassigned); coverage is how often it made one at all.
    Dismissals are reported but excluded from accuracy - declining an item
    says nothing about whether its suggested area was right."""
    rows = db.query(models.SignalResolution).all()
    by_outcome = {"accepted": 0, "reassigned": 0, "filed_unsuggested": 0, "dismissed": 0}
    per_source: dict = {}
    for r in rows:
        by_outcome[r.outcome] = by_outcome.get(r.outcome, 0) + 1
        s = per_source.setdefault(r.source, {"accepted": 0, "reassigned": 0, "filed_unsuggested": 0, "dismissed": 0})
        s[r.outcome] = s.get(r.outcome, 0) + 1
    judged = by_outcome["accepted"] + by_outcome["reassigned"]
    filed = judged + by_outcome["filed_unsuggested"]
    return {
        "total_resolutions": len(rows),
        "outcomes": by_outcome,
        "top1_accuracy": (by_outcome["accepted"] / judged) if judged else None,
        "suggestion_coverage": (judged / filed) if filed else None,
        "per_source": per_source,
    }


def _any_source_configured(db: Session) -> bool:
    """True if at least one Signals source is set up. Microsoft / Jira / Google
    keep a row per connection; GitHub, iCloud, Telegram and Mail store
    credentials in app_settings (read via their client helpers). Used only to
    choose the empty state copy, so any failure degrades to 'not configured'."""
    try:
        if db.query(models.MicrosoftIntegration).first():
            return True
        if db.query(models.JiraIntegration).first():
            return True
        if db.query(models.GoogleIntegration).first():
            return True
        import github_client
        if (github_client.get_config(db) or {}).get("token"):
            return True
        import icloud_client
        ic = icloud_client.get_config(db) or {}
        if ic.get("apple_id") and ic.get("app_password"):
            return True
        import telegram_client
        if (telegram_client.get_config(db) or {}).get("token"):
            return True
        import mail_client
        m = mail_client.get_config(db) or {}
        if m.get("host") and m.get("username") and m.get("password"):
            return True
    except Exception:
        pass
    return False


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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Commit a pending signal onto the chosen thread.

    The thread is either an existing one (thread_id given) or a brand-new
    thread under the chosen area (new_thread_title given). create_as picks
    what it lands as: an Entry (meeting / todo / decision / note), a link
    attachment (the item's URL, or one found in the captured text), or a file
    attachment (the Telegram media downloaded onto the thread). The signal
    flips to 'assigned'; entry modes also record assigned_entry_id so future
    syncs can update the entry in place via external_id.
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

    # How the signal lands is the user's choice (create_as): an entry (meeting,
    # todo, decision, note), a link attachment, or a downloaded file attachment.
    # When unspecified we pick a sensible default per kind - calendar items
    # become meetings, everything else (Jira, email, messages) a todo.
    # external_id carries the upstream id so a future re-sync can find entries.
    mode = (getattr(payload, "create_as", None) or "").strip().lower()
    if mode not in ("meeting", "todo", "decision", "note", "link", "file"):
        mode = "meeting" if signal.kind == "meeting" else "todo"

    entry = None
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
    elif mode == "decision":
        entry = models.Entry(
            thread_id=thread.id,
            content=signal.title,
            type="decision",
            external_id=signal.external_id,
        )
    elif mode == "link":
        url = _link_url(signal, _jira_host(db, signal))
        if not url:
            raise HTTPException(status_code=400, detail="This signal has no link to attach.")
        add_attachment(db, thread.id, type="link",
                       name=(signal.title or url)[:255], url=url[:1000])
    elif mode == "file":
        media = _media(signal)
        if signal.source != "telegram" or not media:
            raise HTTPException(status_code=400, detail="This signal has no file to attach.")
        import telegram_client
        try:
            content, remote_name = telegram_client.download_file(db, media["file_id"])
        except (RuntimeError, ConnectionError) as e:
            raise HTTPException(status_code=502, detail=str(e))
        original = media.get("file_name") or remote_name or f"{media.get('kind', 'file')}"
        ext = os.path.splitext(original)[1]
        stored_name = f"{uuid.uuid4().hex}{ext}"
        _ensure_upload_dir()
        dest = os.path.join(UPLOAD_DIR, stored_name)
        with open(dest, "wb") as fh:
            fh.write(content)
        att = add_attachment(db, thread.id, type="file",
                             name=original[:255], stored_name=stored_name,
                             original_name=original[:255], size=len(content))
        # Best-effort cloud sync, same as a manual upload.
        background_tasks.add_task(_upload_to_remote, attachment_id=att.id,
                                  local_path=dest, stored_name=stored_name)
    else:  # note - a logged timeline entry, with a deep link when we have one
        link = _deep_link(signal, _jira_host(db, signal))
        content = f"[{signal.title}]({link})" if link else signal.title
        if signal.organizer:
            content += f" (from {signal.organizer})"
        entry = models.Entry(
            thread_id=thread.id,
            content=content,
            type="entry",
            external_id=signal.external_id,
        )

    if entry is not None:
        db.add(entry)
        db.flush()

    signal.status = "assigned"
    signal.assigned_entry_id = entry.id if entry is not None else None
    signal.suggested_area_id = area.id
    signal.suggested_thread_id = thread.id
    _log_resolution(db, signal, final_area_id=area.id)
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
    _log_resolution(db, signal, final_area_id=None)
    db.commit()
    db.refresh(signal)
    return _to_out(signal, db)


def _log_resolution(db: Session, signal: models.SignalItem, *, final_area_id) -> None:
    """Append the triage decision to the corrections log (see SignalResolution).
    Outcome is judged against the AI's ORIGINAL call (ai_suggested_area_id),
    not suggested_area_id, which accept/reassign overwrite. Called inside the
    accept/dismiss transaction so the log and the decision commit together."""
    orig = signal.ai_suggested_area_id
    if final_area_id is None:
        outcome = "dismissed"
    elif orig is None:
        outcome = "filed_unsuggested"
    elif orig == final_area_id:
        outcome = "accepted"
    else:
        outcome = "reassigned"
    db.add(models.SignalResolution(
        signal_id=signal.id, source=signal.source, kind=signal.kind,
        ai_suggested_area_id=orig, final_area_id=final_area_id, outcome=outcome,
    ))


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
