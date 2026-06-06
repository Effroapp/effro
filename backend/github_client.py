"""
GitHub client - pulls a developer's actionable items (review requests, assigned
issues/PRs, mentions) into Signals.

Auth is a Personal Access Token (BYO, like iCloud's app password) - simplest and
most idiomatic for GitHub, no OAuth app to register. Token stored encrypted in
app_settings; no refresh needed.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import models

log = logging.getLogger("trace.github")

API_BASE = "https://api.github.com"
_GH_CONFIG_KEY = "github_config"

_HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Effro",
}


# ─── Config ──────────────────────────────────────────────────────────────────

def get_config(db: Session) -> dict:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _GH_CONFIG_KEY).first()
    if not row or not row.value:
        return {}
    try:
        cfg = json.loads(row.value)
        if cfg.get("token"):
            from storage_backend import decrypt_secret
            cfg["token"] = decrypt_secret(cfg["token"])
        return cfg
    except Exception as e:
        log.warning("GitHub config parse failed: %s", e)
        return {}


def save_config(db: Session, *, token: str) -> None:
    from storage_backend import encrypt_secret
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _GH_CONFIG_KEY).first()
    data = {}
    if row and row.value:
        try:
            data = json.loads(row.value)
        except Exception:
            data = {}
    data["token"] = encrypt_secret(token.strip(), db)
    payload = json.dumps(data)
    if row:
        row.value = payload
    else:
        db.add(models.AppSettings(key=_GH_CONFIG_KEY, value=payload))
    db.commit()


def clear_config(db: Session) -> None:
    db.query(models.AppSettings).filter(models.AppSettings.key == _GH_CONFIG_KEY).delete()
    db.commit()


def set_meta(db: Session, **fields) -> None:
    """Stamp non-secret fields (login, last_synced) without touching the token."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _GH_CONFIG_KEY).first()
    if not row or not row.value:
        return
    try:
        data = json.loads(row.value)
    except Exception:
        return
    data.update(fields)
    row.value = json.dumps(data)
    db.commit()


def _token(db: Session) -> Optional[str]:
    return get_config(db).get("token")


def _headers(token: str) -> dict:
    return {**_HEADERS_BASE, "Authorization": f"Bearer {token}"}


# ─── REST ────────────────────────────────────────────────────────────────────

def fetch_user(token: str) -> dict:
    with httpx.Client(timeout=20.0) as client:
        r = client.get(f"{API_BASE}/user", headers=_headers(token))
        r.raise_for_status()
        return r.json()


def search_issues(token: str, query: str, *, per_page: int = 25) -> list[dict]:
    with httpx.Client(timeout=20.0) as client:
        r = client.get(
            f"{API_BASE}/search/issues",
            headers=_headers(token),
            params={"q": query, "per_page": str(per_page), "sort": "updated", "order": "desc"},
        )
        r.raise_for_status()
        return r.json().get("items", [])


def test_connection(db: Session) -> tuple[bool, str]:
    token = _token(db)
    if not token:
        return False, "A GitHub personal access token is required."
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(f"{API_BASE}/user", headers=_headers(token))
        if r.status_code == 401:
            return False, "GitHub rejected the token. Check it has not expired and has the 'repo' scope."
        if r.status_code >= 400:
            return False, f"GitHub error: HTTP {r.status_code}"
        login = r.json().get("login")
        return True, f"Connected to GitHub as {login}."
    except Exception as e:
        return False, f"Could not reach GitHub: {e}"
