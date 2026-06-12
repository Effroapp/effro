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
import re
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

# The filing assistant's contract: one area or abstain, strict JSON. Wrong
# files are worse than no file - the user trusts the suggestion and the item
# then hides in the wrong place - so the prompt leans hard on abstaining.
_FILING_SYSTEM = (
    "You are the filing assistant for Effro, a capture tool. The user captures "
    "notes, messages, emails, links, and files into one inbox from several "
    "sources. Read one captured item and decide which of the user's areas it "
    "belongs in, or abstain.\n\n"
    "Rules:\n"
    "- Choose exactly one area, or abstain. No ranking, no second guess.\n"
    "- Judge by what the item is about, not where it came from. A link, a "
    "forwarded email, and a note can all belong to the same area.\n"
    "- Use only the areas listed. Never invent an area or an id.\n"
    "- If no area is a clear fit, or the item is too thin to place, abstain. "
    "Abstaining is correct when unsure. A wrong file is worse than no file.\n"
    "- Use commas or hyphens for punctuation, never em dashes.\n\n"
    "Output strict JSON, nothing else, no code fence:\n"
    '{"decision":"suggest"|"abstain","area_id":<id or null>,"reason":"<max 12 words>"}'
)


def _area_line(a) -> str:
    """'- 3 | Payments platform: <one-line description>'. The descriptions are
    the lever that moves accuracy - the model matches the item against what
    each area says it is, so a bare name leaves it guessing."""
    desc = " ".join((a.summary or "").split())[:140]
    return f"- {a.id} | {a.name}: {desc}" if desc else f"- {a.id} | {a.name}"


def _item_content(item) -> str:
    """The captured item's readable content: an email body or message text
    from raw_json, else attachment names, else nothing (the prompt then works
    from the subject alone)."""
    try:
        d = json.loads(item.raw_json) if item.raw_json else {}
    except (ValueError, AttributeError):
        d = {}
    content = (d.get("body") or d.get("text") or "").strip()
    if not content:
        atts = d.get("attachments") or []
        if atts:
            content = "Attachments: " + ", ".join(str(a) for a in atts[:10])
    return content[:1500]


def _parse_filing(text: str, valid_ids: set) -> Optional[int]:
    """The returned area id, or None for abstain/anything malformed. An
    unknown id is treated as an abstain - never trust an invented id."""
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except ValueError:
        return None
    if obj.get("decision") != "suggest":
        return None
    area_id = obj.get("area_id")
    return area_id if isinstance(area_id, int) and area_id in valid_ids else None


def _suggest_areas_for_pending(db: Session) -> int:
    """Ask the AI provider to file each pending signal that doesn't yet have a
    suggestion. Returns the count of newly-suggested rows.

    Skips silently if AI is unconfigured or there are no areas. An abstention
    is recorded as None (frontend surfaces "choose area").

    Privacy seam: the captured content (message text, email body) goes to the
    user's BYOK provider here. A future privacy tier can swap get_provider for
    an on-box model without touching anything else in this pass."""
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

    area_lines = "\n".join(_area_line(a) for a in areas)
    valid_ids = {a.id for a in areas}
    suggested = 0
    touched = 0
    for item in pending:
        content = _item_content(item)
        user_msg = (
            f"Areas:\n{area_lines}\n\n"
            "Captured item:\n"
            f"- source: {item.source}\n"
            f"- type: {item.kind}\n"
            f"- from: {item.organizer or '(unknown)'}\n"
            f"- subject: {item.title}\n"
            f"- content:\n{content or '(none)'}"
        )
        try:
            text = provider.complete(
                system=_FILING_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
                max_tokens=80,
            )
        except Exception as e:
            log.warning("AI suggestion for signal %s failed: %s", item.id, e)
            continue
        # Stamp every row the AI actually looked at - including abstentions -
        # so suggestion coverage is measurable (see SignalResolution).
        item.ai_suggested_at = datetime.utcnow()
        touched += 1
        area_id = _parse_filing(text, valid_ids)
        if area_id is not None:
            item.suggested_area_id = area_id
            # The original call, never overwritten afterwards (the row leaves
            # the pending-without-suggestion filter, so the pass cannot revisit).
            item.ai_suggested_area_id = area_id
            suggested += 1
    if touched:
        db.commit()
    return suggested
