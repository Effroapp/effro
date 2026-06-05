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
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"

# One consent covers every Drive/Docs feature:
#   - openid/email/profile : identify the connected account
#   - drive.readonly       : list + read + export the user's existing Docs
#                            (signals, attach-from-Drive, ingest)
#   - drive.file           : create new Docs the app owns (export-to-Docs)
SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]

# The Drive mime type for a native Google Doc.
GDOC_MIME = "application/vnd.google-apps.document"

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
    resp = await _client().get(
        USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    resp.raise_for_status()
    return resp.json()


async def list_recent_docs(access_token: str, *, page_size: int = 25) -> list[dict]:
    """Recently-modified Google Docs the user owns or can edit. Returns raw
    Drive file objects (id, name, modifiedTime, webViewLink, owners, ...)."""
    resp = await _client().get(
        DRIVE_FILES_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "q": f"mimeType='{GDOC_MIME}' and trashed=false",
            "orderBy": "modifiedTime desc",
            "pageSize": str(page_size),
            "fields": "files(id,name,modifiedTime,webViewLink,iconLink,owners(displayName,emailAddress),sharedWithMeTime)",
            "corpora": "user",
        },
    )
    resp.raise_for_status()
    return resp.json().get("files", [])


async def search_docs(access_token: str, query: str, *, page_size: int = 20) -> list[dict]:
    """Search the user's Google Docs by name (for the attach-from-Drive picker)."""
    safe = (query or "").replace("'", "\\'")
    q = f"mimeType='{GDOC_MIME}' and trashed=false"
    if safe:
        q += f" and name contains '{safe}'"
    resp = await _client().get(
        DRIVE_FILES_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "q": q,
            "orderBy": "modifiedTime desc",
            "pageSize": str(page_size),
            "fields": "files(id,name,modifiedTime,webViewLink,iconLink)",
            "corpora": "user",
        },
    )
    resp.raise_for_status()
    return resp.json().get("files", [])


async def export_doc_text(access_token: str, file_id: str) -> str:
    """Export a Google Doc as plain text (for the ingest flow)."""
    resp = await _client().get(
        f"{DRIVE_FILES_URL}/{file_id}/export",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"mimeType": "text/plain"},
    )
    resp.raise_for_status()
    return resp.text


async def create_doc(access_token: str, *, title: str, text: str) -> dict:
    """Create a new Google Doc from plain text via Drive multipart upload with
    conversion. Returns the created file (id, name, webViewLink)."""
    metadata = {"name": title, "mimeType": GDOC_MIME}
    boundary = "effro-boundary-7e1c"
    body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(metadata)}\r\n"
        f"--{boundary}\r\n"
        "Content-Type: text/plain; charset=UTF-8\r\n\r\n"
        f"{text}\r\n"
        f"--{boundary}--"
    )
    resp = await _client().post(
        DRIVE_UPLOAD_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
        content=body.encode("utf-8"),
    )
    resp.raise_for_status()
    return resp.json()
