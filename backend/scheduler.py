"""
Lunchtime Overview refresher.

Runs daily at 12:00 Europe/Brussels. For every area that's NOT 'stable',
asks the configured AI provider to rewrite area.summary, then writes the
result (audit-logged as a system update).

Skips areas marked 'stable' to avoid wasting tokens on quiet domains.
Skips silently if the AI provider isn't configured or the call fails.
"""

from __future__ import annotations
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

import models
from database import SessionLocal
from audit import log_audit

log = logging.getLogger("effro.scheduler")

_scheduler: BackgroundScheduler | None = None


def _gather_area_context(db, area: models.Area) -> str:
    """Mirror the context build in routers/areas.py's suggest endpoint."""
    threads = (
        db.query(models.Thread)
        .filter(models.Thread.area_id == area.id)
        .order_by(models.Thread.updated_at.desc())
        .limit(10)
        .all()
    )
    blocks = []
    for t in threads:
        recent_entries = (
            db.query(models.Entry)
            .filter(models.Entry.thread_id == t.id)
            .order_by(models.Entry.created_at.desc())
            .limit(3)
            .all()
        )
        entry_lines = "\n".join(
            f"  - [{e.type}] {e.content[:180]}" for e in recent_entries
        ) or "  (no entries)"
        blocks.append(f"Thread: {t.title} [{t.status}]\n{entry_lines}")
    return "\n\n".join(blocks) if blocks else "(no threads yet)"


def _refresh_area(db, area: models.Area, provider) -> bool:
    """Regenerate area.summary via the AI provider. Returns True on success."""
    context = _gather_area_context(db, area)

    system = (
        "You write concise status summaries for an area of someone's work.\n"
        "Output exactly 2 sentences. No preamble, no formatting, no bullet points.\n"
        "Sentence 1: the current state - what's happening right now, what's in motion.\n"
        "Sentence 2: what's next or blocking - risks, pending decisions, what to watch.\n"
        "Tone: direct, factual, suitable for a status board. Avoid filler like 'currently' or 'we are'.\n"
        "Use commas or hyphens for punctuation, never em dashes."
    )
    user_msg = (
        f"Area: {area.name}\n"
        f"Current status: {area.status}\n"
        f"Existing summary: {area.summary or '(none)'}\n\n"
        f"Recent activity:\n{context}"
    )

    try:
        text = provider.complete(
            system=system,
            messages=[{"role": "user", "content": user_msg}],
            max_tokens=300,
        )
    except Exception as e:
        log.warning("Failed to refresh area %s: %s", area.name, e)
        return False

    text = (text or "").strip()
    if not text or text == (area.summary or ""):
        return False

    prev = area.summary or ""
    area.summary = text
    area.updated_at = datetime.now(timezone.utc)
    log_audit(
        db, entity_type="area", entity_id=area.id, area_id=area.id,
        action="updated", field="summary",
        old_value=prev[:200], new_value=text[:200],
    )
    db.commit()
    log.info("Refreshed Overview for area %s", area.name)
    return True


def run_jira_signal_sync():
    """Cron entry point - 30-min Jira Cloud pull into signal_items.

    Runs three JQL queries (assigned + mentioned + sprint), upserts results,
    and runs an AI suggestion pass. Skips silently if not connected.
    """
    from database import SessionLocal
    from services_jira import run_jira_sync
    db = SessionLocal()
    try:
        result = run_jira_sync(db)
        if not result.get("skipped"):
            log.info(
                "Jira signal sync: +%d new, %d updated",
                result.get("added", 0), result.get("updated", 0),
            )
    except Exception as e:
        log.warning("Jira signal sync failed: %s", e)
    finally:
        db.close()


def run_microsoft_signal_sync():
    """Cron entry point - 30-min Microsoft 365 calendar pull into signal_items.

    Skips silently if no MS account is connected or the token refresh fails;
    delegates the real work to services_signals.run_microsoft_sync (which
    also handles the on-demand /sync-now button via the microsoft router).
    """
    from database import SessionLocal
    from services_signals import run_microsoft_sync
    db = SessionLocal()
    try:
        result = run_microsoft_sync(db)
        if not result.get("skipped"):
            log.info(
                "MS signal sync: +%d new, %d updated, %d dismissed, %d expired",
                result.get("added", 0), result.get("updated", 0),
                result.get("dismissed", 0), result.get("expired", 0),
            )
    except Exception as e:
        log.warning("MS signal sync failed: %s", e)
    finally:
        db.close()


def topup_nudges():
    """Daily: ask the AI to add a couple of fresh dashboard nudges, growing
    the pool over time. No-op when AI is unconfigured or the pool is full."""
    from database import SessionLocal
    from routers.nudges import generate_nudges
    db = SessionLocal()
    try:
        result = generate_nudges(db, count=2)
        if result.get("added"):
            log.info("Nudge top-up: added %d", result["added"])
    except Exception as e:
        log.warning("Nudge top-up failed: %s", e)
    finally:
        db.close()


def run_nightly_backup():
    """Cron entry point - nightly encrypted DB backup to the configured
    remote backend. Skips cleanly if no cloud is connected or the user has
    disabled the backup toggle in Settings → Storage."""
    from database import SessionLocal
    from storage_backup import run_backup
    from storage_backend import get_storage_config_for_api

    db = SessionLocal()
    try:
        config = get_storage_config_for_api(db)
        if not config.get("is_connected"):
            log.info("Skipping backup: no remote backend connected.")
            return
        if not config.get("backup_enabled", True):
            log.info("Skipping backup: disabled in settings.")
            return
        result = run_backup(db)
        log.info("Nightly backup: %s", result.get("status"))
    except Exception as e:
        log.warning("Nightly backup failed: %s", e)
    finally:
        db.close()


def refresh_all_overviews():
    """Cron entry point - iterate non-stable areas and refresh via the
    configured AI provider. Skips silently if the provider isn't ready
    (e.g. user hasn't configured one in Settings → AI Engine)."""
    from ai_provider import get_provider

    db = SessionLocal()
    refreshed = 0
    try:
        provider = get_provider(db)
        # Quick sanity-check before iterating areas - saves N failed calls
        # if the provider is unconfigured or unreachable.
        ok, msg = provider.test()
        if not ok:
            log.info("Skipping Overview refresh: %s", msg)
            return

        areas = (
            db.query(models.Area)
            .filter(models.Area.status != "stable")
            .order_by(models.Area.id)
            .all()
        )
        log.info("Lunchtime refresh: %d non-stable areas to consider", len(areas))
        for area in areas:
            if _refresh_area(db, area, provider):
                refreshed += 1
    finally:
        db.close()
    log.info("Lunchtime refresh complete: %d areas updated", refreshed)


def start():
    """Start the lunchtime cron in the background. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="Europe/Brussels")
    _scheduler.add_job(
        refresh_all_overviews,
        CronTrigger(hour=12, minute=0, timezone="Europe/Brussels"),
        id="lunchtime-overview-refresh",
        replace_existing=True,
        misfire_grace_time=3600,  # 1 hour late is still OK
    )
    _scheduler.add_job(
        run_nightly_backup,
        CronTrigger(hour=2, minute=0, timezone="Europe/Brussels"),
        id="nightly-db-backup",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        topup_nudges,
        CronTrigger(hour=12, minute=5, timezone="Europe/Brussels"),
        id="daily-nudge-topup",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # Jira Cloud → signal_items sync.
    _scheduler.add_job(
        run_jira_signal_sync,
        CronTrigger(minute="*/30", timezone="Europe/Brussels"),
        id="jira-signal-sync",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    # Microsoft 365 calendar → signal_items sync. Every 30 min, all day -
    # someone might add a meeting to your calendar at 23:00 and you want it
    # in Effro by morning. Skips silently if MS isn't connected.
    _scheduler.add_job(
        run_microsoft_signal_sync,
        CronTrigger(minute="*/30", timezone="Europe/Brussels"),
        id="microsoft-signal-sync",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    _scheduler.start()
    log.info("Scheduler started: 12:00 Overview + 02:00 backup + */30min MS sync, Europe/Brussels.")


def shutdown():
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
