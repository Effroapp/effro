"""
Google Drive/Docs sync engine.

Pulls the user's recently-modified Google Docs into signal_items (source=
'google', kind='doc') for triage, mirroring services_signals. Accepting a doc
in the Signals UI links it onto a thread (see routers/signals.accept_signal).

Never creates entries automatically - that's the user's job via the UI.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

import models
import google_client as gc

log = logging.getLogger("trace.services.google")


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1]
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _doc_to_signal_fields(d: dict) -> dict:
    owners = d.get("owners") or []
    owner = owners[0].get("displayName") if owners else None
    return {
        "title": (d.get("name") or "Untitled doc")[:500],
        "starts_at": _parse_dt(d.get("modifiedTime")),  # "edited" timestamp
        "ends_at": None,
        "location": None,
        "organizer": owner,          # doc owner, shown in the card's people slot
        "is_all_day": False,
    }


def run_google_sync(db: Session) -> dict:
    """Pull recent Google Docs, upsert as signals, AI-suggest areas. Skips
    cleanly when no Google account is connected."""
    integration = db.query(models.GoogleIntegration).first()
    if not integration:
        return {"skipped": True, "reason": "not_connected"}

    access_token = gc.get_valid_access_token(db)
    if not access_token:
        log.info("Google sync skipped: token refresh failed (reconnect needed).")
        return {"skipped": True, "reason": "not_connected"}

    try:
        docs = asyncio.run(gc.list_recent_docs(access_token, page_size=25))
    except Exception as e:
        log.warning("Google sync: Drive fetch failed: %s", e)
        return {"skipped": True, "reason": "drive_error", "error": str(e)}

    added = updated = 0
    for d in docs:
        file_id = d.get("id")
        if not file_id:
            continue
        existing = (
            db.query(models.SignalItem)
            .filter(
                models.SignalItem.source == "google",
                models.SignalItem.external_id == file_id,
            )
            .first()
        )
        fields = _doc_to_signal_fields(d)
        if existing:
            # Don't resurrect a doc the user already triaged or dismissed.
            if existing.status == "pending":
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.raw_json = json.dumps(d)
                updated += 1
        else:
            db.add(models.SignalItem(
                source="google",
                external_id=file_id,
                kind="doc",
                status="pending",
                raw_json=json.dumps(d),
                **fields,
            ))
            added += 1
    db.commit()

    # AI area suggestion for fresh pending items (shared, source-agnostic pass).
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
