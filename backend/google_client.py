"""
Google integration client.

Mirrors microsoft_graph.py but for Google's plain OAuth 2.0 (no MSAL/SDK - we
talk to the token + Drive + Docs REST endpoints directly with httpx, so there
is no new dependency to bundle).

Holds:
  - Config loaders for the Google Cloud OAuth app (client_id / client_secret)
    stored in app_settings - the user pastes these in once after following the
    in-app setup guide, no env vars required.
  - OAuth helpers for the authorization-code flow + refresh.
  - Drive/Docs REST calls (list docs, export text, create doc).
  - Persisted CSRF state, encrypted token vault - same pattern as Microsoft.

Scopes cover all four Drive/Docs features up front so the user only consents
once: read Drive (signals/attach/ingest) + create files (export).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import models

log = logging.getLogger("trace.google")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1"

# One consent covers everything the Google account is used for:
#   - openid/email/profile : identify the connected account
#   - calendar.readonly    : pull upcoming events into Signals
#   - gmail.readonly       : pull starred mail into Signals (restricted scope -
#                            fine under the user's own BYO app in testing mode)
#   - drive.file           : create + manage the app's own encrypted backup
#                            files (the Google Drive storage backend)
SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.file",
]

_GOOGLE_CONFIG_KEY = "google_config"
_CSRF_STATE_KEY = "google_oauth_states"

_http_client: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client


async def close_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


# ─── Config ──────────────────────────────────────────────────────────────────

def get_config(db: Session) -> dict:
    """Return the stored Google OAuth app config, or {} if never set."""
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _GOOGLE_CONFIG_KEY)
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
        log.warning("Google config parse failed: %s", e)
        return {}


def save_config(db: Session, *, client_id: str, client_secret: str) -> None:
    """Persist the Google OAuth app config. client_secret is Fernet-encrypted."""
    from storage_backend import encrypt_secret

    payload = {
        "client_id": client_id.strip(),
        "client_secret": encrypt_secret(client_secret.strip(), db),
    }
    row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == _GOOGLE_CONFIG_KEY)
        .first()
    )
    if row:
        row.value = json.dumps(payload)
    else:
        db.add(models.AppSettings(key=_GOOGLE_CONFIG_KEY, value=json.dumps(payload)))
    db.commit()


def get_redirect_uri() -> str:
    """Loopback redirect the backend listens on (matches the setup guide)."""
    import os
    build = os.environ.get("TRACE_BUILD", "web").lower()
    if build == "desktop":
        return "trace://auth/callback"
    port = os.environ.get("BACKEND_PORT", "8000")
    return f"http://localhost:{port}/api/google/auth/callback"


# ─── OAuth ───────────────────────────────────────────────────────────────────

def get_auth_url(db: Session, state: str) -> str:
    """Build the Google consent URL. access_type=offline + prompt=consent so we
    reliably get a refresh token (Google only returns one on explicit consent)."""
    cfg = get_config(db)
    if not cfg.get("client_id") or not cfg.get("client_secret"):
        raise ValueError(
            "Google integration is not configured. "
            "Paste your Google Cloud OAuth Client ID and Secret in Settings → Integrations."
        )
    from urllib.parse import urlencode
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": get_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code_for_tokens(db: Session, auth_code: str) -> dict:
    """Trade an authorization code for an access + refresh token (synchronous)."""
    cfg = get_config(db)
    if not cfg.get("client_id"):
        raise ValueError("Google integration is not configured.")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "code": auth_code,
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "redirect_uri": get_redirect_uri(),
            "grant_type": "authorization_code",
        },
        timeout=20.0,
    )
    data = resp.json() if resp.content else {}
    if resp.status_code != 200 or "error" in data:
        raise ValueError(
            f"Token exchange failed: {data.get('error_description', data.get('error', resp.text[:200]))}"
        )
    return data


def refresh_access_token(db: Session, refresh_token: str) -> dict:
    cfg = get_config(db)
    if not cfg.get("client_id"):
        raise ValueError("Google integration is not configured.")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "grant_type": "refresh_token",
        },
        timeout=20.0,
    )
    data = resp.json() if resp.content else {}
    if resp.status_code != 200 or "error" in data:
        raise ValueError(
            f"Token refresh failed: {data.get('error_description', data.get('error', resp.text[:200]))}"
        )
    return data


# ─── CSRF state (persisted, survives restarts) ───────────────────────────────

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


def _load_states(db: Session) -> dict:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _CSRF_STATE_KEY).first()
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


def _save_states(db: Session, states: dict) -> None:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _CSRF_STATE_KEY).first()
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


# ─── Token vault ─────────────────────────────────────────────────────────────

def store_tokens(
    db: Session,
    *,
    integration: models.GoogleIntegration,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
) -> None:
    """Encrypt + persist tokens. Google omits the refresh token on refreshes,
    so we only overwrite refresh_token_enc when a new one is actually given."""
    from storage_backend import encrypt_secret

    integration.access_token_enc = encrypt_secret(access_token, db)
    if refresh_token:
        integration.refresh_token_enc = encrypt_secret(refresh_token, db)
    integration.token_expiry = datetime.utcnow() + timedelta(seconds=int(expires_in))


def get_valid_access_token(db: Session) -> Optional[str]:
    """Return a non-expired access token, refreshing if needed. None if not
    connected or the refresh fails (callers skip silently)."""
    from storage_backend import decrypt_secret

    integration = db.query(models.GoogleIntegration).first()
    if not integration:
        return None

    needs_refresh = (
        integration.token_expiry is None
        or integration.token_expiry <= datetime.utcnow() + timedelta(seconds=60)
    )
    if not needs_refresh:
        return decrypt_secret(integration.access_token_enc)

    if not integration.refresh_token_enc:
        log.warning("Google token expired and no refresh token; reconnect required.")
        return None
    try:
        result = refresh_access_token(db, decrypt_secret(integration.refresh_token_enc))
    except Exception as e:
        log.warning("Google token refresh failed: %s", e)
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


# ─── REST calls ──────────────────────────────────────────────────────────────

async def fetch_user_profile(access_token: str) -> dict:
    """OpenID userinfo: sub, email, name, picture."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        resp.raise_for_status()
        return resp.json()


async def fetch_calendar_events(access_token: str, *, days_ahead: int = 7) -> list[dict]:
    """Upcoming events on the primary calendar, from now to +days_ahead.
    Returns raw Calendar API event objects (singleEvents expands recurrences)."""
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{CALENDAR_BASE}/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "timeMax": (now + timedelta(days=days_ahead)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "50",
                "fields": "items(id,summary,start,end,location,organizer,htmlLink,status)",
            },
        )
        resp.raise_for_status()
        return [e for e in resp.json().get("items", []) if e.get("status") != "cancelled"]


async def fetch_starred_emails(access_token: str, *, max_results: int = 25) -> list[dict]:
    """Starred Gmail messages, enriched with Subject/From/Date headers + snippet.
    Returns a list of {id, subject, sender, date, snippet}."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        listing = await client.get(
            f"{GMAIL_BASE}/users/me/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": "is:starred", "maxResults": str(max_results)},
        )
        listing.raise_for_status()
        ids = [m["id"] for m in (listing.json().get("messages") or []) if m.get("id")]

        out = []
        for mid in ids:
            try:
                r = await client.get(
                    f"{GMAIL_BASE}/users/me/messages/{mid}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={
                        "format": "metadata",
                        "metadataHeaders": ["Subject", "From", "Date"],
                    },
                )
                r.raise_for_status()
                msg = r.json()
                headers = {h["name"].lower(): h["value"] for h in (msg.get("payload", {}).get("headers") or [])}
                out.append({
                    "id": mid,
                    "subject": headers.get("subject") or "(no subject)",
                    "sender": headers.get("from"),
                    "date": headers.get("date"),
                    "snippet": msg.get("snippet") or "",
                })
            except Exception as e:
                log.warning("Gmail message %s fetch failed: %s", mid, e)
        return out
