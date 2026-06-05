"""
iCloud sync engine - pulls iCloud Calendar events and flagged Apple Mail into
the Signals feed (source='icloud'), mirroring services_google.

  - Calendar events  -> kind 'meeting'
  - Flagged mail     -> kind 'email'

external_id is prefixed ("cal:" / "mail:"). Never creates entries automatically.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

import models
import icloud_client as ic

log = logging.getLogger("trace.services.icloud")


def run_icloud_sync(db: Session) -> dict:
    cfg = ic.get_config(db)
    if not (cfg.get("apple_id") and cfg.get("app_password")):
        return {"skipped": True, "reason": "not_connected"}

    try:
        events = ic.fetch_calendar_events(db, days_ahead=7)
    except Exception as e:
        log.warning("iCloud calendar fetch failed: %s", e)
        events = []
    try:
        mail = ic.fetch_flagged_mail(db, limit=25)
    except Exception as e:
        log.warning("iCloud mail fetch failed: %s", e)
        mail = []

    added = updated = 0

    def _upsert(kind, ext_id, fields, raw):
        nonlocal added, updated
        existing = (
            db.query(models.SignalItem)
            .filter(models.SignalItem.source == "icloud", models.SignalItem.external_id == ext_id)
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
                source="icloud", external_id=ext_id, kind=kind,
                status="pending", raw_json=raw, **fields,
            ))
            added += 1

    for ev in events:
        uid = ev.get("uid") or ev.get("summary")
        if not uid:
            continue
        _upsert("meeting", f"cal:{uid}", {
            "title": (ev.get("summary") or "(no title)")[:500],
            "starts_at": ev.get("start"),
            "ends_at": ev.get("end"),
            "location": ev.get("location"),
            "organizer": ev.get("organizer"),
            "is_all_day": bool(ev.get("all_day")),
        }, json.dumps({k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in ev.items()}))

    for m in mail:
        uid = m.get("uid") or m.get("subject")
        if not uid:
            continue
        _upsert("email", f"mail:{uid}", {
            "title": (m.get("subject") or "(no subject)")[:500],
            "starts_at": ic.parse_mail_date(m.get("date")),
            "ends_at": None,
            "location": None,
            "organizer": m.get("sender"),
            "is_all_day": False,
        }, json.dumps(m))
    db.commit()

    try:
        from services_signals import _suggest_areas_for_pending
        suggested = _suggest_areas_for_pending(db)
    except Exception as e:
        log.warning("iCloud sync: AI suggestion pass failed: %s", e)
        suggested = 0

    ic.set_last_synced(db, datetime.utcnow().isoformat())
    log.info("iCloud sync: +%d new, %d updated, %d AI-suggested", added, updated, suggested)
    return {"added": added, "updated": updated, "ai_suggested": suggested, "skipped": False}
