"""
Hand-rolled OIDC (Authorization Code flow) on httpx - no authlib, matching the
other integrations and the no-heavy-deps policy.

Config lives in app_settings under a single 'oidc_config' JSON key; the client
secret is Fernet-encrypted at rest (storage_backend.encrypt_secret). Identity is
read from the IdP's userinfo endpoint (over TLS, with the access token) rather
than verifying the ID-token signature locally - this keeps us off a JWT-crypto
dependency, and is sound because the code exchange is server-side over TLS (no
token ever passes through the browser). A short-lived state value defends the
callback against CSRF.
"""
import json
import time
from typing import Optional
from urllib.parse import urlencode

import httpx

import models
from storage_backend import encrypt_secret, decrypt_secret

_CONFIG_KEY = "oidc_config"
_STATE_PREFIX = "oidc_state:"
_STATE_TTL_SECONDS = 600  # 10 minutes
_DISCOVERY_TTL_SECONDS = 3600

_discovery_cache = {}  # discovery_url -> (expires_epoch, doc)


# ── app_settings helpers ──────────────────────────────────────────────────────

def _get(db, key):
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    return row.value if row else None


def _set(db, key, value):
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.AppSettings(key=key, value=value))
    db.commit()


def _del(db, key):
    db.query(models.AppSettings).filter(models.AppSettings.key == key).delete()
    db.commit()


# ── Config ────────────────────────────────────────────────────────────────────

def _raw_config(db) -> Optional[dict]:
    raw = _get(db, _CONFIG_KEY)
    return json.loads(raw) if raw else None


def get_config(db) -> dict:
    """Safe, public-ish view of the config (never returns the secret itself)."""
    cfg = _raw_config(db) or {}
    return {
        "enabled": bool(cfg.get("enabled")),
        "provider_name": cfg.get("provider_name"),
        "client_id": cfg.get("client_id", ""),
        "discovery_url": cfg.get("discovery_url", ""),
        "has_secret": bool(cfg.get("client_secret_enc")),
    }


def save_config(db, *, enabled, provider_name, client_id, discovery_url, client_secret=None) -> dict:
    cfg = _raw_config(db) or {}
    cfg["enabled"] = bool(enabled)
    cfg["provider_name"] = (provider_name or "").strip() or None
    cfg["client_id"] = (client_id or "").strip()
    cfg["discovery_url"] = (discovery_url or "").strip()
    # Only overwrite the secret when a new one is supplied (so a config edit that
    # leaves the password field blank keeps the existing secret).
    if client_secret:
        cfg["client_secret_enc"] = encrypt_secret(client_secret, db)
    _set(db, _CONFIG_KEY, json.dumps(cfg))
    return get_config(db)


def is_enabled(db) -> bool:
    c = get_config(db)
    return bool(c["enabled"] and c["client_id"] and c["discovery_url"] and c["has_secret"])


# ── State (CSRF) ──────────────────────────────────────────────────────────────

def add_state(db, state: str):
    _set(db, _STATE_PREFIX + state, str(int(time.time()) + _STATE_TTL_SECONDS))


def pop_state(db, state: str) -> bool:
    if not state:
        return False
    key = _STATE_PREFIX + state
    val = _get(db, key)
    if val is None:
        return False
    _del(db, key)
    try:
        return int(val) > int(time.time())
    except (TypeError, ValueError):
        return False


# ── Discovery + flow ──────────────────────────────────────────────────────────

def _discovery(discovery_url: str) -> dict:
    now = time.time()
    hit = _discovery_cache.get(discovery_url)
    if hit and hit[0] > now:
        return hit[1]
    with httpx.Client(timeout=10) as c:
        r = c.get(discovery_url)
        r.raise_for_status()
        doc = r.json()
    _discovery_cache[discovery_url] = (now + _DISCOVERY_TTL_SECONDS, doc)
    return doc


def build_auth_url(db, redirect_uri: str) -> str:
    cfg = _raw_config(db)
    if not cfg or not is_enabled(db):
        raise ValueError("OIDC is not configured")
    doc = _discovery(cfg["discovery_url"])
    state = __import__("secrets").token_urlsafe(32)
    add_state(db, state)
    params = {
        "client_id": cfg["client_id"],
        "response_type": "code",
        "scope": "openid email profile",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{doc['authorization_endpoint']}?{urlencode(params)}"


def complete_login(db, code: str, redirect_uri: str) -> dict:
    """Exchange the code and return identity claims {sub, iss, email, name}."""
    cfg = _raw_config(db)
    if not cfg:
        raise ValueError("OIDC is not configured")
    doc = _discovery(cfg["discovery_url"])
    secret = decrypt_secret(cfg.get("client_secret_enc") or "")
    with httpx.Client(timeout=15) as c:
        tok = c.post(
            doc["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": cfg["client_id"],
                "client_secret": secret,
            },
            headers={"Accept": "application/json"},
        )
        tok.raise_for_status()
        access_token = (tok.json() or {}).get("access_token")
        if not access_token:
            raise ValueError("No access token returned by the identity provider")
        ui = c.get(
            doc["userinfo_endpoint"],
            headers={"Authorization": f"Bearer {access_token}"},
        )
        ui.raise_for_status()
        claims = ui.json() or {}
    sub = claims.get("sub")
    if not sub:
        raise ValueError("No subject (sub) in userinfo response")
    return {
        "sub": str(sub),
        "iss": doc.get("issuer") or cfg["discovery_url"],
        "email": claims.get("email"),
        "name": claims.get("name") or claims.get("preferred_username"),
    }
