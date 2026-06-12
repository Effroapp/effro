"""
Mail sync engine - flagged messages from a generic IMAP mailbox become
Signals (source='mail', kind='email'). Mirrors the iCloud Mail half of
services_icloud.

external_id is 'mail:{Message-ID}' (stable across re-syncs, unlike IMAP UIDs).
Unflagging a message upstream does not retract the Signal - dismissing it in
Effro is the user's call. Never creates entries automatically.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

import models
import mail_client as mc

log = logging.getLogger("effro.services.mail")


def run_mail_sync(db: Session) -> dict:
    cfg = mc.get_config(db)
    if not (cfg.get("host") and cfg.get("username") and cfg.get("password")):
        return {"skipped": True, "reason": "not_connected"}

    mail = mc.fetch_flagged_mail(db, limit=25)

    added = updated = 0
    seen_batch: set = set()
    for m in mail:
        uid = m.get("uid") or m.get("subject")
        if not uid:
            continue
        ext_id = f"mail:{uid}"[:256]
        # In-batch dedupe: the session doesn't autoflush, so a repeated
        # Message-ID in ONE fetch would pass the existence query twice and
        # blow the (source, external_id) unique index at commit.
        if ext_id in seen_batch:
            continue
        seen_batch.add(ext_id)
        fields = {
            "title": (m.get("subject") or "(no subject)")[:500],
            "starts_at": mc.parse_mail_date(m.get("date")),
            "ends_at": None,
            "location": None,
            "organizer": m.get("sender"),
            "is_all_day": False,
        }
        raw = json.dumps(m)
        existing = (
            db.query(models.SignalItem)
            .filter(models.SignalItem.source == "mail", models.SignalItem.external_id == ext_id)
            .first()
        )
        if existing:
            if existing.status == "pending":
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.raw_json = raw
                updated += 1
        else:
            db.add(models.SignalItem(source="mail", external_id=ext_id, kind="email",
                                     status="pending", raw_json=raw, **fields))
            added += 1
    db.commit()

    try:
        from services_signals import _suggest_areas_for_pending
        suggested = _suggest_areas_for_pending(db)
    except Exception as e:
        log.warning("Mail sync: AI suggestion pass failed: %s", e)
        suggested = 0

    mc.set_meta(db, last_synced=datetime.utcnow().isoformat())
    log.info("Mail sync: +%d new, %d updated, %d AI-suggested", added, updated, suggested)
    return {"added": added, "updated": updated, "ai_suggested": suggested, "skipped": False}
