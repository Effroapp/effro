"""
Jira Cloud integration.

Handles OAuth 2.0 (3LO) for Atlassian Cloud, persistent CSRF state,
encrypted token storage (reusing the existing Fernet key), and async
Jira REST API v3 calls via the shared httpx client.

Three signal sources are supported:
  - assigned  : JQL assignee = currentUser() AND statusCategory != Done
  - mentioned : JQL (watcher = currentUser() OR comment ~ currentUser())
                AND assignee != currentUser() AND statusCategory != Done
  - sprint    : JQL sprint in openSprints() AND statusCategory != Done

After OAuth the access token is exchanged for the list of accessible
Atlassian Cloud sites (cloudId resolution), stored alongside the tokens.
All subsequent API calls go to:
  https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/{path}

Design mirrors microsoft_graph.py so the pattern stays familiar.
"""
from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

import models

log = logging.getLogger("effro.jira")

# ─── Constants ────────────────────────────────────────────────────────────────

ATLASSIAN_AUTH_URL   = "https://auth.atlassian.com/authorize"
ATLASSIAN_TOKEN_URL  = "https://auth.atlassian.com/oauth/token"
ATLASSIAN_RESOURCES  = "https://api.atlassian.com/oauth/token/accessible-resources"
JIRA_API_BASE        = "https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3"

# Minimum scopes — read-only, Jira Cloud only.
SCOPES = "read:jira-user read:jira-work offline_access"

# Max issues fetched per JQL query per sync run.
MAX_RESULTS = 50

# app_settings keys
_JIRA_CONFIG_KEY      = "jira_config"
_JIRA_CSRF_STATE_KEY  = "jira_oauth_states"

# Shared httpx client
_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=15.0)
    return _http


async def close_client() -> None:
    global _http
    if _http is not None:
        await _http.aclose()
        _http = None


# ─── Config ──────────────────────────────────────────────────────────────────

def get_config(db: Session) -> dict:
    """Return stored Atlassian OAuth app credentials, or {} if unset."""
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _JIRA_CONFIG_KEY)
        .first()
    )
    if not row or not row.value:
        return {}
    try:
        cfg = json.loads(row.value)
        if cfg.get("client_secret"):
            from storage_backend import decrypt_secret
            cfg["client_secret"] = decrypt_secret(cfg["client_secret"])
        return cfg
    except Exception as e:
        log.warning("Jira config parse failed: %s", e)
        return {}


def save_config(db: Session, *, client_id: str, client_secret: str) -> None:
    """Persist the Atlassian OAuth app credentials (secret Fernet-encrypted)."""
    from storage_backend import encrypt_secret
    payload = {
        "client_id": client_id.strip(),
        "client_secret": encrypt_secret(client_secret.strip(), db),
    }
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _JIRA_CONFIG_KEY)
        .first()
    )
    if row:
        row.value = json.dumps(payload)
    else:
        db.add(models.AppSettings(key=_JIRA_CONFIG_KEY, value=json.dumps(payload)))
    db.commit()


def get_redirect_uri() -> str:
    import os
    port = os.environ.get("BACKEND_PORT", "8000")
    return f"http://localhost:{port}/api/jira/auth/callback"


# ─── CSRF state (persisted, restarts don't break in-flight OAuth) ─────────────

def add_state(db: Session, state: str) -> None:
    states = _load_states(db)
    states[state] = datetime.utcnow().isoformat()
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    states = {s: ts for s, ts in states.items() if _ts_after(ts, cutoff)}
    _save_states(db, states)


def pop_state(db: Session, state: str) -> bool:
    states = _load_states(db)
    if state in states:
        del states[state]
        _save_states(db, states)
        return True
    return False


def _load_states(db):
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _JIRA_CSRF_STATE_KEY)
        .first()
    )
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


def _save_states(db, states):
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _JIRA_CSRF_STATE_KEY)
        .first()
    )
    payload = json.dumps(states)
    if row:
        row.value = payload
    else:
        db.add(models.AppSettings(key=_JIRA_CSRF_STATE_KEY, value=payload))
    db.commit()


def _ts_after(iso, cutoff):
    try:
        return datetime.fromisoformat(iso) > cutoff
    except Exception:
        return False


# ─── OAuth helpers ────────────────────────────────────────────────────────────

def get_auth_url(db: Session, state: str) -> str:
    cfg = get_config(db)
    if not cfg.get("client_id") or not cfg.get("client_secret"):
        raise ValueError(
            "Jira integration is not configured. "
            "Paste your Atlassian OAuth app's Client ID and Secret in "
            "Settings → Integrations → Jira."
        )
    params = {
        "audience": "api.atlassian.com",
        "client_id": cfg["client_id"],
        "scope": SCOPES,
        "redirect_uri": get_redirect_uri(),
        "state": state,
        "response_type": "code",
        "prompt": "consent",
    }
    return f"{ATLASSIAN_AUTH_URL}?{urlencode(params)}"


async def exchange_code(db: Session, code: str) -> dict:
    """Exchange an authorisation code for access + refresh tokens."""
    cfg = get_config(db)
    resp = await _client().post(
        ATLASSIAN_TOKEN_URL,
        json={
            "grant_type": "authorization_code",
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "code": code,
            "redirect_uri": get_redirect_uri(),
        },
    )
    resp.raise_for_status()
    return resp.json()


async def refresh_tokens(db: Session, refresh_token: str) -> dict:
    cfg = get_config(db)
    resp = await _client().post(
        ATLASSIAN_TOKEN_URL,
        json={
            "grant_type": "refresh_token",
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "refresh_token": refresh_token,
        },
    )
    resp.raise_for_status()
    return resp.json()


async def fetch_accessible_resources(access_token: str) -> list[dict]:
    """Return the list of Atlassian Cloud sites the user has access to."""
    resp = await _client().get(
        ATLASSIAN_RESOURCES,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    resp.raise_for_status()
    return resp.json()


# ─── Token vault ──────────────────────────────────────────────────────────────

def store_tokens(
    db: Session,
    *,
    integration: models.JiraIntegration,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
) -> None:
    from storage_backend import encrypt_secret
    integration.access_token_enc = encrypt_secret(access_token, db)
    if refresh_token:
        integration.refresh_token_enc = encrypt_secret(refresh_token, db)
    integration.token_expiry = datetime.utcnow() + timedelta(seconds=int(expires_in))


def get_valid_access_token(db: Session) -> Optional[str]:
    """Return a non-expired access token, refreshing if needed. None if not connected."""
    from storage_backend import decrypt_secret

    integration = db.query(models.JiraIntegration).first()
    if not integration:
        return None

    needs_refresh = (
        integration.token_expiry is None
        or integration.token_expiry <= datetime.utcnow() + timedelta(seconds=60)
    )
    if not needs_refresh:
        return decrypt_secret(integration.access_token_enc)

    if not integration.refresh_token_enc:
        log.warning("Jira token expired and no refresh token; reconnect required.")
        return None

    import asyncio
    try:
        result = asyncio.run(
            refresh_tokens(db, decrypt_secret(integration.refresh_token_enc))
        )
    except Exception as e:
        log.warning("Jira token refresh failed: %s", e)
        return None

    store_tokens(
        db,
        integration=integration,
        access_token=result["access_token"],
        refresh_token=result.get("refresh_token"),
        expires_in=result.get("expires_in", 3600),
    )
    db.commit()
    return result["access_token"]


# ─── Jira REST API calls ──────────────────────────────────────────────────────

def _jira_url(cloud_id: str, path: str) -> str:
    return JIRA_API_BASE.format(cloud_id=cloud_id) + path


async def fetch_current_user(access_token: str, cloud_id: str) -> dict:
    resp = await _client().get(
        _jira_url(cloud_id, "/myself"),
        headers={"Authorization": f"Bearer {access_token}"},
    )
    resp.raise_for_status()
    return resp.json()


async def search_issues(
    access_token: str,
    cloud_id: str,
    jql: str,
    fields: list[str] | None = None,
    max_results: int = MAX_RESULTS,
) -> list[dict]:
    """Run a JQL search and return the issues list."""
    default_fields = [
        "summary", "status", "priority", "issuetype",
        "assignee", "reporter", "project", "sprint",
        "duedate", "updated", "created", "labels",
    ]
    resp = await _client().post(
        _jira_url(cloud_id, "/search"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={
            "jql": jql,
            "maxResults": max_results,
            "fields": fields or default_fields,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("issues", [])


async def fetch_assigned_issues(access_token: str, cloud_id: str) -> list[dict]:
    """Issues currently assigned to the authenticated user that aren't Done."""
    return await search_issues(
        access_token,
        cloud_id,
        jql="assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
    )


async def fetch_mentioned_issues(access_token: str, cloud_id: str) -> list[dict]:
    """Issues the user is watching or has commented on, excluding their own assigned work."""
    return await search_issues(
        access_token,
        cloud_id,
        jql=(
            "watcher = currentUser() AND assignee != currentUser() "
            "AND statusCategory != Done ORDER BY updated DESC"
        ),
    )


async def fetch_sprint_issues(access_token: str, cloud_id: str) -> list[dict]:
    """All open-sprint issues not yet Done, ordered by priority."""
    return await search_issues(
        access_token,
        cloud_id,
        jql="sprint in openSprints() AND statusCategory != Done ORDER BY priority ASC",
    )


# ─── Issue → signal field mapping ─────────────────────────────────────────────

def issue_to_signal_fields(issue: dict) -> dict:
    """Extract the standard signal_items fields from a Jira issue object."""
    fields = issue.get("fields", {})

    # Map Jira issue types to our kind vocabulary
    issue_type = (fields.get("issuetype") or {}).get("name", "Task").lower()
    kind_map = {"bug": "bug", "story": "story", "epic": "epic", "sub-task": "task"}
    kind = kind_map.get(issue_type, "task")

    # Due date (Jira returns YYYY-MM-DD or null)
    due_raw = fields.get("duedate")
    starts_at = None
    if due_raw:
        try:
            starts_at = datetime.strptime(due_raw, "%Y-%m-%d")
        except ValueError:
            pass

    reporter_name = None
    reporter = fields.get("reporter")
    if reporter:
        reporter_name = reporter.get("displayName") or reporter.get("name")

    project_name = (fields.get("project") or {}).get("name")

    return {
        "title": (fields.get("summary") or issue.get("key", "Untitled"))[:500],
        "starts_at": starts_at,
        "ends_at": None,
        "location": project_name,      # project name in the "location" slot
        "organizer": reporter_name,     # reporter in the "organizer" slot
        "is_all_day": bool(starts_at),
        "kind": kind,
    }


def issue_external_id(issue: dict) -> str:
    """Stable unique id for a Jira issue — the issue key (e.g. PROJ-123)."""
    return issue.get("key", issue.get("id", ""))
