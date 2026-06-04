"""
Jira sync engine.

Called by the 30-min APScheduler job and POST /jira/sync-now.

Three JQL queries per run:
  1. assigned  — assignee = currentUser() AND statusCategory != Done
  2. mentioned — watcher = currentUser() AND assignee != currentUser() AND statusCategory != Done
  3. sprint    — sprint in openSprints() AND statusCategory != Done

Issues are upserted into signal_items by (source='jira', external_id=issueKey).
Changed issues update in place. Resolved issues (statusCategory = Done) are
auto-dismissed by checking against the "Done" status category on re-sync.

AI suggestion: same pattern as Microsoft — given issue summary + area list,
ask the AI to suggest the best-fit area. Capped, skipped if unconfigured.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

import models
import jira_client as jira

log = logging.getLogger("effro.jira.sync")


def run_jira_sync(db: Session) -> dict:
    """Pull the three JQL queries, upsert signal_items, AI-suggest areas."""
    access_token = jira.get_valid_access_token(db)
    if not access_token:
        log.info("Jira sync skipped: not connected or token refresh failed.")
        return {"synced": 0, "skipped": True, "reason": "not_connected"}

    integration = db.query(models.JiraIntegration).first()
    if not integration:
        return {"synced": 0, "skipped": True, "reason": "not_connected"}

    cloud_id = integration.cloud_id

    # Run all three queries concurrently
    try:
        assigned, mentioned, sprint = asyncio.run(
            _fetch_all(access_token, cloud_id)
        )
    except Exception as e:
        log.warning("Jira sync fetch failed: %s", e)
        return {"synced": 0, "skipped": True, "reason": "api_error", "error": str(e)}

    # Build a deduplicated set — a single issue might appear in multiple queries
    seen_keys: set[str] = set()
    all_issues: list[dict] = []
    for issue in assigned + mentioned + sprint:
        key = jira.issue_external_id(issue)
        if key and key not in seen_keys:
            seen_keys.add(key)
            all_issues.append(issue)

    added = updated = 0
    for issue in all_issues:
        ext_id = jira.issue_external_id(issue)
        if not ext_id:
            continue

        fields = jira.issue_to_signal_fields(issue)
        existing = (
            db.query(models.SignalItem)
            .filter(
                models.SignalItem.source == "jira",
                models.SignalItem.external_id == ext_id,
            )
            .first()
        )

        # Check if the issue is now Done — if so, auto-dismiss it
        status_cat = (
            (issue.get("fields", {}).get("status") or {})
            .get("statusCategory", {})
            .get("key", "")
        )
        if status_cat == "done":
            if existing and existing.status == "pending":
                existing.status = "dismissed"
            continue

        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            existing.raw_json = json.dumps(issue)
            updated += 1
        else:
            item = models.SignalItem(
                source="jira",
                external_id=ext_id,
                status="pending",
                raw_json=json.dumps(issue),
                **fields,
            )
            db.add(item)
            added += 1

    db.commit()

    # AI suggestion pass
    suggested = 0
    try:
        suggested = _suggest_areas(db)
    except Exception as e:
        log.warning("Jira AI suggestion pass failed: %s", e)

    integration.last_synced = datetime.utcnow()
    db.commit()

    log.info(
        "Jira sync: %d fetched, +%d new, %d updated, %d AI-suggested",
        len(all_issues), added, updated, suggested,
    )
    return {
        "fetched": len(all_issues),   # issues the JQL queries returned this run
        "added": added,
        "updated": updated,
        "ai_suggested": suggested,
        "skipped": False,
    }


async def _fetch_all(access_token: str, cloud_id: str):
    """Run the three JQL queries concurrently and return their results."""
    return await asyncio.gather(
        jira.fetch_assigned_issues(access_token, cloud_id),
        jira.fetch_mentioned_issues(access_token, cloud_id),
        jira.fetch_sprint_issues(access_token, cloud_id),
        return_exceptions=False,
    )


def _suggest_areas(db: Session) -> int:
    """Ask the AI to suggest an area for each fresh pending Jira signal."""
    pending = (
        db.query(models.SignalItem)
        .filter(
            models.SignalItem.source == "jira",
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
        "You categorise Jira issues into the user's areas of work in Effro.\n"
        "Given an issue title, its kind (task/bug/story/epic), and a list of areas, "
        "reply with ONLY the area id that best fits, or the single word 'none' "
        "when no area is a clear match. Use commas or hyphens, never em dashes."
    )
    suggested = 0
    for item in pending:
        # Pull kind from raw_json if available for better AI context
        kind_label = item.kind or "task"
        user_msg = (
            f"Issue: {item.title}\n"
            f"Type: {kind_label}\n"
            f"Project: {item.location or '(unknown)'}\n\n"
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
            log.warning("AI suggestion for Jira signal %s failed: %s", item.id, e)
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
