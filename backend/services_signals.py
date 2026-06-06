"""
Signals sync engine.

Called by the 30-min APScheduler job and by POST /microsoft/sync-now.

Responsibilities:
  1. Pull `calendarView` for now → +7 days via the user's MS token.
  2. Upsert into `signal_items` by (source='microsoft', external_id=graph_id).
  3. Request an AI suggestion (area + thread) for fresh pending items.
  4. Mark upstream-cancelled items as 'dismissed'.
  5. Auto-expire pending items whose start has passed or which are too stale.

Never creates `entries` automatically - that's the user's job via the Signals UI.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

import models
import microsoft_graph as graph

log = logging.getLogger("effro.signals")

# Items untouched longer than this auto-expire (per spec §4.1).
PENDING_STALENESS_DAYS = 14


def run_microsoft_sync(db: Session) -> dict:
    """Pull the next 7 days, upsert signal_items, auto-expire."""
    access_token = graph.get_valid_access_token(db)
    if not access_token:
        log.info("Signals sync skipped: no MS account connected (or token refresh failed).")
        return {"synced": 0, "skipped": True, "reason": "not_connected"}

    try:
        events = asyncio.run(graph.fetch_upcoming_events(access_token, days_ahead=7))
    except Exception as e:
        log.warning("Signals sync: calendar fetch failed: %s", e)
        return {"synced": 0, "skipped": True, "reason": "graph_error", "error": str(e)}

    upstream_ids = {e["id"] for e in events if e.get("id")}

    added = 0
    updated = 0
    for ev in events:
        if not ev.get("id"):
            continue
        existing = (
            db.query(models.SignalItem)
            .filter(
                models.SignalItem.source == "microsoft",
                models.SignalItem.external_id == ev["id"],
            )
            .first()
        )
        fields = _event_to_signal_fields(ev)
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            existing.raw_json = json.dumps(ev)
            updated += 1
        else:
            item = models.SignalItem(
                source="microsoft",
                external_id=ev["id"],
                kind="meeting",
                status="pending",
                raw_json=json.dumps(ev),
                **fields,
            )
            db.add(item)
            added += 1
    db.commit()

    # Upstream cancellations: anything in our table marked microsoft + pending
    # but missing from this window's response, where starts_at falls inside the
    # window, gets dismissed (could mean cancelled or deleted).
    window_end = datetime.utcnow() + timedelta(days=7)
    stale_pending = (
        db.query(models.SignalItem)
        .filter(
            models.SignalItem.source == "microsoft",
            models.SignalItem.status == "pending",
            models.SignalItem.starts_at.isnot(None),
            models.SignalItem.starts_at <= window_end,
        )
        .all()
    )
    dismissed = 0
    for item in stale_pending:
        if item.external_id not in upstream_ids:
            item.status = "dismissed"
            dismissed += 1
    db.commit()

    # Auto-expire: pending items whose start has passed; or pending items
    # untouched beyond the staleness window.
    expired = 0
    cutoff = datetime.utcnow() - timedelta(days=PENDING_STALENESS_DAYS)
    expirable = (
        db.query(models.SignalItem)
        .filter(
            models.SignalItem.status == "pending",
        )
        .all()
    )
    for item in expirable:
        if item.starts_at and item.starts_at < datetime.utcnow():
            item.status = "dismissed"
            expired += 1
        elif item.created_at and item.created_at < cutoff and item.updated_at and item.updated_at < cutoff:
            item.status = "dismissed"
            expired += 1
    db.commit()

    # AI suggestion for newly-arrived pending items (those without a suggestion)
    try:
        suggested = _suggest_areas_for_pending(db)
    except Exception as e:
        log.warning("AI suggestion pass failed: %s", e)
        suggested = 0

    # Stamp the integration row's last_synced for the UI.
    integration = db.query(models.MicrosoftIntegration).first()
    if integration:
        integration.last_synced = datetime.utcnow()
        db.commit()

    log.info(
        "Signals sync: +%d new, %d updated, %d dismissed, %d expired, %d AI-suggested",
        added, updated, dismissed, expired, suggested,
    )
    return {
        "added": added,
        "updated": updated,
        "dismissed": dismissed,
        "expired": expired,
        "ai_suggested": suggested,
        "skipped": False,
    }


def _event_to_signal_fields(ev: dict) -> dict:
    """Pull the fields we care about off a Graph calendar event."""
    start = (ev.get("start") or {}).get("dateTime")
    end = (ev.get("end") or {}).get("dateTime")
    return {
        "title": (ev.get("subject") or "Untitled event")[:500],
        "starts_at": _parse_graph_dt(start),
        "ends_at": _parse_graph_dt(end),
        "location": ((ev.get("location") or {}).get("displayName") or None),
        "organizer": ((ev.get("organizer") or {}).get("emailAddress") or {}).get("name") or None,
        "is_all_day": bool(ev.get("isAllDay")),
    }


def _parse_graph_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Graph returns ISO-8601 without 'Z' when Prefer=UTC is set.
        if s.endswith("Z"):
            s = s[:-1]
        return datetime.fromisoformat(s)
    except Exception:
        return None


# ─── AI suggestion ───────────────────────────────────────────────────────────

def _suggest_areas_for_pending(db: Session) -> int:
    """Ask the AI provider to suggest an area for each pending signal that
    doesn't yet have a suggestion. Returns the count of newly-suggested rows.

    Skips silently if AI is unconfigured or there are no areas. The "no strong
    match" case is recorded as None (frontend surfaces "choose area")."""
    pending = (
        db.query(models.SignalItem)
        .filter(
            models.SignalItem.status == "pending",
            models.SignalItem.suggested_area_id.is_(None),
        )
        .all()
    )
    if not pending:
        return 0

    areas = db.query(models.Area).all()
    if not areas:
        return 0

    try:
        from ai_provider import get_provider
        provider = get_provider(db)
        ok, _ = provider.test()
        if not ok:
            return 0
    except Exception:
        return 0

    area_list = "\n".join(f"- {a.name} (id={a.id})" for a in areas)
    system = (
        "You categorise calendar meetings into the user's areas of work.\n"
        "Given a meeting title and the list of areas, reply with ONLY the area id "
        "that best fits, or the single word 'none' when no area is clearly the right home.\n"
        "Be conservative: 'none' is correct when the meeting could plausibly belong to several.\n"
        "Use commas or hyphens for punctuation, never em dashes."
    )
    suggested = 0
    for item in pending:
        user_msg = (
            f"Meeting title: {item.title}\n"
            f"Organizer: {item.organizer or '(unknown)'}\n"
            f"Location: {item.location or '(unknown)'}\n\n"
            f"Areas:\n{area_list}\n\n"
            "Reply with one area id, or 'none'."
        )
        try:
            text = provider.complete(
                system=system,
                messages=[{"role": "user", "content": user_msg}],
                max_tokens=20,
            )
        except Exception as e:
            log.warning("AI suggestion for signal %s failed: %s", item.id, e)
            continue
        text = (text or "").strip().lower().rstrip(".")
        if text == "none" or not text.isdigit():
            continue
        area_id = int(text)
        if any(a.id == area_id for a in areas):
            item.suggested_area_id = area_id
            suggested += 1
    if suggested:
        db.commit()
    return suggested
