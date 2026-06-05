"""
Google Drive/Docs sync engine.

Phase 1 (foundation) ships a no-op so the connect flow and "Sync now" button
work end to end. Phase 2 (docs as signals) fills run_google_sync in: pull
recently-modified Google Docs, upsert into signal_items (source='google',
kind='doc'), and run the AI area-suggestion pass, mirroring services_signals.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

import models

log = logging.getLogger("trace.services.google")


def run_google_sync(db: Session) -> dict:
    """Pull Google Docs into Signals. No-op until phase 2; skips cleanly when
    no Google account is connected."""
    integration = db.query(models.GoogleIntegration).first()
    if not integration:
        return {"skipped": True, "reason": "Google account not connected"}
    # Phase 2 will implement the Drive pull + signal upsert here.
    return {"skipped": True, "reason": "Google Docs sync arrives in the next update", "added": 0, "updated": 0}
