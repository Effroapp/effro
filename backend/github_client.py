"""
GitHub client - pulls a developer's actionable items (review requests, assigned
issues/PRs, mentions) into Signals.

Auth is a Personal Access Token (BYO, like iCloud's app password) - simplest and
most idiomatic for GitHub, no OAuth app to register. Token stored encrypted in
app_settings; no refresh needed.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import integration_config

log = logging.getLogger("effro.github")

API_BASE = "https://api.github.com"
_GH_CONFIG_KEY = "github_config"

_HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Effro",
}


# ─── Config (shared store, token encrypted at rest) ──────────────────────────

def get_config(db: Session) -> dict:
    return integration_config.load(db, _GH_CONFIG_KEY, secret_fields=("token",))


def save_config(db: Session, *, token: str) -> None:
    integration_config.save(db, _GH_CONFIG_KEY, {"token": token}, secret_fields=("token",))


def clear_config(db: Session) -> None:
    integration_config.clear(db, _GH_CONFIG_KEY)


def set_meta(db: Session, **fields) -> None:
    """Stamp non-secret fields (login, last_synced) without touching the token."""
    integration_config.set_meta(db, _GH_CONFIG_KEY, **fields)


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
