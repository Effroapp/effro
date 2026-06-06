"""
GitHub sync engine - pulls the user's actionable items into Signals
(source='github'): PRs awaiting their review, issues/PRs assigned to them, and
things they're mentioned in. Mirrors services_google / services_jira.

kind is 'pr' or 'issue' (both non-meeting, so accept defaults to a to-do).
external_id prefixed 'gh:'. Never creates entries automatically.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

import models
import github_client as gh

log = logging.getLogger("effro.services.github")


def _parse_dt(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _repo_from_url(item: dict) -> str | None:
    # repository_url like https://api.github.com/repos/owner/name
    url = item.get("repository_url") or ""
    if "/repos/" in url:
        return url.split("/repos/", 1)[1]
    # fall back to parsing html_url
    html = item.get("html_url") or ""
    parts = html.split("github.com/", 1)
    if len(parts) == 2:
        seg = parts[1].split("/")
        if len(seg) >= 2:
            return f"{seg[0]}/{seg[1]}"
    return None


def run_github_sync(db: Session) -> dict:
    cfg = gh.get_config(db)
    token = cfg.get("token")
    if not token:
        return {"skipped": True, "reason": "not_connected"}

    try:
        login = cfg.get("login") or gh.fetch_user(token).get("login")
    except Exception as e:
        log.warning("GitHub sync: user lookup failed: %s", e)
        return {"skipped": True, "reason": "auth_error", "error": str(e)}
    if not login:
        return {"skipped": True, "reason": "auth_error"}

    queries = [
        f"is:open is:pr review-requested:{login}",
        f"is:open assignee:{login}",
        f"is:open mentions:{login}",
    ]
    items_by_id: dict = {}
    for q in queries:
        try:
            for it in gh.search_issues(token, q):
                if it.get("id") is not None:
                    items_by_id[it["id"]] = it
        except Exception as e:
            log.warning("GitHub search failed for %r: %s", q, e)

    added = updated = 0
    for gid, it in items_by_id.items():
        ext_id = f"gh:{gid}"
        kind = "pr" if it.get("pull_request") else "issue"
        fields = {
            "title": (it.get("title") or "(untitled)")[:500],
            "starts_at": _parse_dt(it.get("updated_at")),
            "ends_at": None,
            "location": _repo_from_url(it),                 # owner/name
            "organizer": (it.get("user") or {}).get("login"),  # author
            "is_all_day": False,
        }
        raw = json.dumps({"html_url": it.get("html_url"), "number": it.get("number")})
        existing = (
            db.query(models.SignalItem)
            .filter(models.SignalItem.source == "github", models.SignalItem.external_id == ext_id)
            .first()
        )
        if existing:
            if existing.status == "pending":
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.raw_json = raw
                updated += 1
        else:
            db.add(models.SignalItem(source="github", external_id=ext_id, kind=kind,
                                     status="pending", raw_json=raw, **fields))
            added += 1
    db.commit()

    try:
        from services_signals import _suggest_areas_for_pending
        suggested = _suggest_areas_for_pending(db)
    except Exception as e:
        log.warning("GitHub sync: AI suggestion pass failed: %s", e)
        suggested = 0

    gh.set_meta(db, login=login, last_synced=datetime.utcnow().isoformat())
    log.info("GitHub sync: +%d new, %d updated, %d AI-suggested", added, updated, suggested)
    return {"added": added, "updated": updated, "ai_suggested": suggested, "skipped": False}
