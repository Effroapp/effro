"""
Dropbox client - OAuth 2.0 (with offline refresh) + token vault.

Dropbox is a Cloud Storage backend only (encrypted DB backups); it is not a
Signals source. The user registers their own Dropbox app (BYO model), pastes
the App key + App secret, and signs in. We exchange the code for a short-lived
access token plus a refresh token (token_access_type=offline) and refresh
just-in-time. No SDK - plain httpx against the REST endpoints.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import models

log = logging.getLogger("trace.dropbox")

AUTH_URL = "https://www.dropbox.com/oauth2/authorize"
TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
ACCOUNT_URL = "https://api.dropboxapi.com/2/users/get_current_account"

_DROPBOX_CONFIG_KEY = "dropbox_config"
_CSRF_STATE_KEY = "dropbox_oauth_states"


# ─── Config ──────────────────────────────────────────────────────────────────

def get_config(db: Session) -> dict:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _DROPBOX_CONFIG_KEY).first()
    if not row or not row.value:
        return {}
    try:
        cfg = json.loads(row.value)
        if cfg.get("app_secret"):
            from storage_backend import decrypt_secret
            cfg["app_secret"] = decrypt_secret(cfg["app_secret"])
        return cfg
    except Exception as e:
        log.warning("Dropbox config parse failed: %s", e)
        return {}


def save_config(db: Session, *, app_key: str, app_secret: str) -> None:
    from storage_backend import encrypt_secret
    payload = {"app_key": app_key.strip(), "app_secret": encrypt_secret(app_secret.strip(), db)}
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _DROPBOX_CONFIG_KEY).first()
    if row:
        row.value = json.dumps(payload)
    else:
        db.add(models.AppSettings(key=_DROPBOX_CONFIG_KEY, value=json.dumps(payload)))
    db.commit()


def get_redirect_uri() -> str:
    import os
    build = os.environ.get("TRACE_BUILD", "web").lower()
    if build == "desktop":
        return "trace://auth/callback"
    port = os.environ.get("BACKEND_PORT", "8000")
    return f"http://localhost:{port}/api/dropbox/auth/callback"


# ─── OAuth ───────────────────────────────────────────────────────────────────

def get_auth_url(db: Session, state: str) -> str:
    cfg = get_config(db)
    if not cfg.get("app_key") or not cfg.get("app_secret"):
        raise ValueError(
            "Dropbox is not configured. Paste your Dropbox app's App key and App secret in Settings -> Storage."
        )
    from urllib.parse import urlencode
    params = {
        "client_id": cfg["app_key"],
        "redirect_uri": get_redirect_uri(),
        "response_type": "code",
        "token_access_type": "offline",  # ask for a refresh token
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code_for_tokens(db: Session, auth_code: str) -> dict:
    cfg = get_config(db)
    if not cfg.get("app_key"):
        raise ValueError("Dropbox is not configured.")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "code": auth_code,
            "grant_type": "authorization_code",
            "client_id": cfg["app_key"],
            "client_secret": cfg["app_secret"],
            "redirect_uri": get_redirect_uri(),
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
    if not cfg.get("app_key"):
        raise ValueError("Dropbox is not configured.")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": cfg["app_key"],
            "client_secret": cfg["app_secret"],
        },
        timeout=20.0,
    )
    data = resp.json() if resp.content else {}
    if resp.status_code != 200 or "error" in data:
        raise ValueError(
            f"Token refresh failed: {data.get('error_description', data.get('error', resp.text[:200]))}"
        )
    return data


# ─── CSRF state ──────────────────────────────────────────────────────────────

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

def store_tokens(db: Session, *, integration, access_token: str, refresh_token: Optional[str], expires_in: int) -> None:
    from storage_backend import encrypt_secret
    integration.access_token_enc = encrypt_secret(access_token, db)
    if refresh_token:
        integration.refresh_token_enc = encrypt_secret(refresh_token, db)
    integration.token_expiry = datetime.utcnow() + timedelta(seconds=int(expires_in))


def get_valid_access_token(db: Session) -> Optional[str]:
    from storage_backend import decrypt_secret
    integration = db.query(models.DropboxIntegration).first()
    if not integration:
        return None
    needs_refresh = (
        integration.token_expiry is None
        or integration.token_expiry <= datetime.utcnow() + timedelta(seconds=60)
    )
    if not needs_refresh:
        return decrypt_secret(integration.access_token_enc)
    if not integration.refresh_token_enc:
        log.warning("Dropbox token expired and no refresh token; reconnect required.")
        return None
    try:
        result = refresh_access_token(db, decrypt_secret(integration.refresh_token_enc))
    except Exception as e:
        log.warning("Dropbox token refresh failed: %s", e)
        return None
    store_tokens(
        db, integration=integration,
        access_token=result["access_token"],
        refresh_token=result.get("refresh_token"),
        expires_in=result.get("expires_in", 14400),
    )
    db.commit()
    return result["access_token"]


def fetch_account(access_token: str) -> dict:
    """Current account: name + email (for the 'connected as' label)."""
    resp = httpx.post(
        ACCOUNT_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20.0,
    )
    resp.raise_for_status()
    return resp.json()
