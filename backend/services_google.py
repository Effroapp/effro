"""
Google sync engine - pulls Google Calendar events and starred Gmail into the
Signals triage feed (source='google'), mirroring services_signals for Microsoft.

  - Calendar events -> kind 'meeting'
  - Starred emails  -> kind 'email'

external_id is prefixed ("cal:" / "mail:") so a calendar id and a Gmail id can
never collide under the (source, external_id) unique key. Never creates entries
automatically - that's the user's job via the Signals UI.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

from sqlalchemy.orm import Session

import models
import google_client as gc

log = logging.getLogger("effro.services.google")


def _parse_event_dt(d: Optional[dict]):
    """(naive-UTC datetime, is_all_day) from a Calendar start/end object."""
    if not d:
        return None, False
    s = d.get("dateTime") or d.get("date")
    if not s:
        return None, False
    all_day = "dateTime" not in d
    try:
        if all_day:
            return datetime.fromisoformat(s), True
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt, False
    except Exception:
        return None, all_day


def _parse_email_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt and dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _event_fields(ev: dict) -> dict:
    starts_at, all_day = _parse_event_dt(ev.get("start"))
    ends_at, _ = _parse_event_dt(ev.get("end"))
    org = ev.get("organizer") or {}
    return {
        "title": (ev.get("summary") or "(no title)")[:500],
        "starts_at": starts_at,
        "ends_at": ends_at,
        "location": ev.get("location"),
        "organizer": org.get("displayName") or org.get("email"),
        "is_all_day": all_day,
    }


def _email_fields(m: dict) -> dict:
    return {
        "title": (m.get("subject") or "(no subject)")[:500],
        "starts_at": _parse_email_dt(m.get("date")),
        "ends_at": None,
        "location": None,
        "organizer": m.get("sender"),
        "is_all_day": False,
    }


async def _pull(token: str):
    events = await gc.fetch_calendar_events(token, days_ahead=7)
    emails = await gc.fetch_starred_emails(token, max_results=25)
    return events, emails


def run_google_sync(db: Session) -> dict:
    """Pull Calendar + starred Gmail into Signals. Skips cleanly when no Google
    account is connected."""
    integration = db.query(models.GoogleIntegration).first()
    if not integration:
        return {"skipped": True, "reason": "not_connected"}

    token = gc.get_valid_access_token(db)
    if not token:
        log.info("Google sync skipped: token refresh failed (reconnect needed).")
        return {"skipped": True, "reason": "not_connected"}

    try:
        events, emails = asyncio.run(_pull(token))
    except Exception as e:
        log.warning("Google sync: fetch failed: %s", e)
        return {"skipped": True, "reason": "api_error", "error": str(e)}

    added = updated = 0

    def _upsert(kind: str, ext_id: str, fields: dict, raw: str):
        nonlocal added, updated
        existing = (
            db.query(models.SignalItem)
            .filter(
                models.SignalItem.source == "google",
                models.SignalItem.external_id == ext_id,
            )
            .first()
        )
        if existing:
            if existing.status == "pending":
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.raw_json = raw
                updated += 1
        else:
            db.add(models.SignalItem(
                source="google", external_id=ext_id, kind=kind,
                status="pending", raw_json=raw, **fields,
            ))
            added += 1

    for ev in events:
        eid = ev.get("id")
        if eid:
            _upsert("meeting", f"cal:{eid}", _event_fields(ev), json.dumps(ev))
    for m in emails:
        mid = m.get("id")
        if mid:
            raw = json.dumps({**m, "webLink": f"https://mail.google.com/mail/u/0/#all/{mid}"})
            _upsert("email", f"mail:{mid}", _email_fields(m), raw)
    db.commit()

    try:
        from services_signals import _suggest_areas_for_pending
        suggested = _suggest_areas_for_pending(db)
    except Exception as e:
        log.warning("Google sync: AI suggestion pass failed: %s", e)
        suggested = 0

    integration.last_synced = datetime.utcnow()
    db.commit()

    log.info("Google sync: +%d new, %d updated, %d AI-suggested", added, updated, suggested)
    return {"added": added, "updated": updated, "ai_suggested": suggested, "skipped": False}
