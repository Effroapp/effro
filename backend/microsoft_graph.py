"""
Microsoft Graph integration.

Holds:
  - Config loaders for the Azure app registration (client_id / client_secret /
    tenant_id) stored in app_settings - the user pastes these in once after
    following docs/AZURE_SETUP.md, no env vars required.
  - MSAL helpers for the OAuth code flow + refresh.
  - Async Graph API calls (profile, avatar, calendarView).
  - A shared httpx client so we don't open + close one per call.

Differences from the uploaded draft (see MS365_INTEGRATION_SPEC_1.md §11/§12):
  - Config sourced from app_settings, not pydantic BaseSettings env vars.
  - `fetch_todays_events` computes the day boundary in Europe/Brussels rather
    than UTC, so a 23:00 local meeting doesn't fall outside the window.
  - A single module-level httpx.AsyncClient is reused across calls.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
import msal
from sqlalchemy.orm import Session

import models

log = logging.getLogger("trace.microsoft")

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Minimum scopes per spec §7. Read-only - no mail, files, or Teams.
#
# We do NOT list openid, profile, or offline_access here even though we need
# refresh tokens. MSAL Python treats these three as "reserved" and adds them
# automatically; including them explicitly raises "You cannot use any scope
# value that is reserved" at get_authorization_request_url time. The Azure
# app registration should still grant offline_access via API Permissions -
# MSAL passes it on the wire either way.
SCOPES = [
    "User.Read",
    "Calendars.Read",
]

# Local timezone for "today" boundary calculations - matches the scheduler.
LOCAL_TZ = ZoneInfo("Europe/Brussels")

# Settings key holding the Azure app registration credentials.
_MICROSOFT_CONFIG_KEY = "microsoft_config"

# Settings key holding CSRF state tokens for OAuth flows in flight. Persisted
# (rather than in-memory) so an in-flight redirect survives a backend restart.
_CSRF_STATE_KEY = "microsoft_oauth_states"

# Shared httpx client. Lazily instantiated so test/import doesn't open one.
_http_client: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client


async def close_client() -> None:
    """Close the shared client - called on FastAPI shutdown."""
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


# ─── Config ──────────────────────────────────────────────────────────────────

def get_config(db: Session) -> dict:
    """Return the stored Azure app config, or empty dict if never set."""
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _MICROSOFT_CONFIG_KEY)
        .first()
    )
    if not row or not row.value:
        return {}
    try:
        cfg = json.loads(row.value)
        # client_secret is Fernet-encrypted at rest.
        if cfg.get("client_secret"):
            from storage_backend import decrypt_secret
            cfg["client_secret"] = decrypt_secret(cfg["client_secret"])
        return cfg
    except Exception as e:
        log.warning("Microsoft config parse failed: %s", e)
        return {}


def save_config(db: Session, *, client_id: str, client_secret: str, tenant_id: str) -> None:
    """Persist the Azure app config. client_secret is Fernet-encrypted."""
    from storage_backend import encrypt_secret

    payload = {
        "client_id": client_id.strip(),
        "client_secret": encrypt_secret(client_secret.strip(), db),
        "tenant_id": (tenant_id or "common").strip(),
    }
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _MICROSOFT_CONFIG_KEY)
        .first()
    )
    if row:
        row.value = json.dumps(payload)
    else:
        db.add(models.AppSettings(key=_MICROSOFT_CONFIG_KEY, value=json.dumps(payload)))
    db.commit()


def get_redirect_uri() -> str:
    """Pick the redirect URI based on TRACE_BUILD.

    web (default) - Docker/browser: backend handles /api/microsoft/auth/callback.
    desktop       - Tauri shell: custom scheme caught by the deep-link plugin.

    The desktop redirect uses the custom `trace://` scheme registered in
    tauri.conf.json (see spec §6.2). Until v0.6.x ships that wiring, the
    desktop frontend should show the "browser-only for v0.6.0" affordance
    in the MS settings card; the URI here is in place so v0.6.x just flips
    the env flag with no backend change.
    """
    import os
    build = os.environ.get("TRACE_BUILD", "web").lower()
    if build == "desktop":
        return "trace://auth/callback"
    # Web/Docker: backend port + path. The frontend opens this URL via
    # window.location.href so cookies and CORS aren't in play.
    port = os.environ.get("BACKEND_PORT", "8000")
    return f"http://localhost:{port}/api/microsoft/auth/callback"


# ─── MSAL ────────────────────────────────────────────────────────────────────

def _build_msal_app(cfg: dict) -> msal.ConfidentialClientApplication:
    return msal.ConfidentialClientApplication(
        client_id=cfg["client_id"],
        client_credential=cfg["client_secret"],
        authority=f"https://login.microsoftonline.com/{cfg.get('tenant_id', 'common')}",
    )


def get_auth_url(db: Session, state: str) -> str:
    """Build the Microsoft OAuth authorise URL.

    The caller is responsible for storing `state` (via _add_state) before
    sending the redirect, so the callback can validate it.
    """
    cfg = get_config(db)
    if not cfg.get("client_id") or not cfg.get("client_secret"):
        raise ValueError(
            "Microsoft integration is not configured. "
            "Paste your Azure app's Client ID and Secret in Settings → Integrations."
        )
    app = _build_msal_app(cfg)
    return app.get_authorization_request_url(
        scopes=SCOPES,
        state=state,
        redirect_uri=get_redirect_uri(),
    )


def exchange_code_for_tokens(db: Session, auth_code: str) -> dict:
    cfg = get_config(db)
    if not cfg.get("client_id"):
        raise ValueError("Microsoft integration is not configured.")
    app = _build_msal_app(cfg)
    result = app.acquire_token_by_authorization_code(
        code=auth_code,
        scopes=SCOPES,
        redirect_uri=get_redirect_uri(),
    )
    if "error" in result:
        raise ValueError(
            f"Token exchange failed: {result.get('error_description', result['error'])}"
        )
    return result


def refresh_access_token(db: Session, refresh_token: str) -> dict:
    cfg = get_config(db)
    if not cfg.get("client_id"):
        raise ValueError("Microsoft integration is not configured.")
    app = _build_msal_app(cfg)
    result = app.acquire_token_by_refresh_token(
        refresh_token=refresh_token,
        scopes=SCOPES,
    )
    if "error" in result:
        raise ValueError(
            f"Token refresh failed: {result.get('error_description', result['error'])}"
        )
    return result


# ─── CSRF state (persisted, see spec §12) ────────────────────────────────────

def add_state(db: Session, state: str) -> None:
    """Remember a CSRF state token across requests (and restarts)."""
    states = _load_states(db)
    states[state] = datetime.utcnow().isoformat()
    # Garbage-collect anything older than 15 minutes - the auth roundtrip
    # never takes that long, so anything older is abandoned.
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    states = {s: ts for s, ts in states.items() if _ts_after(ts, cutoff)}
    _save_states(db, states)


def pop_state(db: Session, state: str) -> bool:
    """Return True iff `state` was previously stored. Single-use - removed."""
    states = _load_states(db)
    if state in states:
        del states[state]
        _save_states(db, states)
        return True
    return False


def _load_states(db: Session) -> dict:
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _CSRF_STATE_KEY)
        .first()
    )
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


def _save_states(db: Session, states: dict) -> None:
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _CSRF_STATE_KEY)
        .first()
    )
    payload = json.dumps(states)
    if row:
        row.value = payload
    else:
        db.add(models.AppSettings(key=_CSRF_STATE_KEY, value=payload))
    db.commit()


def _ts_after(iso: str, cutoff: datetime) -> bool:
    try:
        return datetime.fromisoformat(iso) > cutoff
    except Exception:
        return False


# ─── Graph API calls ─────────────────────────────────────────────────────────

async def fetch_user_profile(access_token: str) -> dict:
    """Minimal profile - displayName + mail. Rich fields deferred (spec §0)."""
    resp = await _client().get(
        f"{GRAPH_BASE}/me",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"$select": "id,displayName,mail,userPrincipalName"},
    )
    resp.raise_for_status()
    return resp.json()


async def fetch_user_avatar(access_token: str) -> Optional[str]:
    """Optional - returns a data URI or None. Not surfaced in v1 (spec §0)."""
    try:
        resp = await _client().get(
            f"{GRAPH_BASE}/me/photo/$value",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code == 200:
            b64 = base64.b64encode(resp.content).decode("utf-8")
            content_type = resp.headers.get("content-type", "image/jpeg")
            return f"data:{content_type};base64,{b64}"
    except Exception as e:
        log.warning("Avatar fetch failed: %s", e)
    return None


async def fetch_calendar_window(
    access_token: str,
    *,
    start_utc: datetime,
    end_utc: datetime,
    top: int = 50,
) -> list[dict]:
    """Fetch calendar events between two UTC datetimes (inclusive of start).

    Filters out cancelled events and free-time blocks. Returns the raw Graph
    objects so the caller can decide what to do with the shape.
    """
    if start_utc.tzinfo is None:
        start_utc = start_utc.replace(tzinfo=timezone.utc)
    if end_utc.tzinfo is None:
        end_utc = end_utc.replace(tzinfo=timezone.utc)
    start_str = start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_str = end_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    resp = await _client().get(
        f"{GRAPH_BASE}/me/calendarView",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Prefer": 'outlook.timezone="UTC"',
        },
        params={
            "startDateTime": start_str,
            "endDateTime": end_str,
            "$orderby": "start/dateTime",
            "$select": (
                "id,subject,start,end,location,isAllDay,"
                "organizer,bodyPreview,isCancelled,showAs"
            ),
            "$top": str(top),
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return [
        e for e in data.get("value", [])
        if not e.get("isCancelled") and e.get("showAs") != "free"
    ]


async def fetch_todays_events(access_token: str) -> list[dict]:
    """Today (local-tz boundary) - used by the Live Calendar Panel.

    Spec §12 fix: the draft computed the window in UTC, which dropped late
    local meetings. We compute the day boundary in Europe/Brussels then
    convert to UTC for Graph.
    """
    now_local = datetime.now(LOCAL_TZ)
    start_local = now_local
    end_local = now_local.replace(hour=23, minute=59, second=59, microsecond=0)
    return await fetch_calendar_window(
        access_token,
        start_utc=start_local.astimezone(timezone.utc),
        end_utc=end_local.astimezone(timezone.utc),
        top=20,
    )


async def fetch_upcoming_events(access_token: str, days_ahead: int = 7) -> list[dict]:
    """Now → +days_ahead, used by the sync job."""
    now = datetime.now(timezone.utc)
    return await fetch_calendar_window(
        access_token,
        start_utc=now,
        end_utc=now + timedelta(days=days_ahead),
        top=100,
    )


# ─── Token vault (encrypted on write, decrypted just-in-time) ────────────────

def store_tokens(
    db: Session,
    *,
    integration: models.MicrosoftIntegration,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
) -> None:
    """Encrypt and persist a fresh token pair on the given integration row."""
    from storage_backend import encrypt_secret

    integration.access_token_enc = encrypt_secret(access_token, db)
    if refresh_token:
        integration.refresh_token_enc = encrypt_secret(refresh_token, db)
    integration.token_expiry = datetime.utcnow() + timedelta(seconds=int(expires_in))


def get_valid_access_token(db: Session) -> Optional[str]:
    """Return a non-expired access token, refreshing if needed.

    Returns None when no account is connected or the refresh fails (caller
    decides whether that's a 401 or just "skip silently" - the sync job
    chooses the latter).
    """
    from storage_backend import decrypt_secret

    integration = db.query(models.MicrosoftIntegration).first()
    if not integration:
        return None

    needs_refresh = (
        integration.token_expiry is None
        or integration.token_expiry <= datetime.utcnow() + timedelta(seconds=60)
    )
    if not needs_refresh:
        return decrypt_secret(integration.access_token_enc)

    # Refresh
    if not integration.refresh_token_enc:
        log.warning("MS token expired and no refresh token; reconnect required.")
        return None
    try:
        result = refresh_access_token(db, decrypt_secret(integration.refresh_token_enc))
    except Exception as e:
        log.warning("MS token refresh failed: %s", e)
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
