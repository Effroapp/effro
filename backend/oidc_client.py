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
import base64
import ipaddress
import json
import socket
import time
from typing import Optional
from urllib.parse import urlencode, urlparse

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
    scope = "openid email profile"
    if _is_microsoft(cfg["discovery_url"]):
        scope += " User.Read"  # so the access token can read the Graph profile photo
    params = {
        "client_id": cfg["client_id"],
        "response_type": "code",
        "scope": scope,
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
        "picture": claims.get("picture"),
        "access_token": access_token,
        "is_microsoft": _is_microsoft(cfg["discovery_url"]),
    }


# ── Profile photo (best-effort) ───────────────────────────────────────────────

def _is_microsoft(discovery_url) -> bool:
    # Hostname match (not substring) so a look-alike like
    # login.microsoftonline.com.evil.test can't flip the Microsoft branch.
    try:
        host = (urlparse(discovery_url or "").hostname or "").lower()
    except ValueError:
        return False
    return (host == "login.microsoftonline.com" or host.endswith(".microsoftonline.com")
            or host == "sts.windows.net" or host.endswith(".sts.windows.net"))


def _is_public_https(url) -> bool:
    """True only for an https URL whose host resolves entirely to PUBLIC IPs.
    Blocks SSRF to internal / loopback / link-local / metadata hosts via a
    malicious `picture` claim. (A residual DNS-rebinding gap remains since httpx
    re-resolves; the public-IP gate closes the practical exploit for what is an
    admin-configured, trusted IdP.)"""
    try:
        p = urlparse(url)
        if p.scheme != "https" or not p.hostname:
            return False
        infos = socket.getaddrinfo(p.hostname, 443, proto=socket.IPPROTO_TCP)
        if not infos:
            return False
        for *_unused, sockaddr in infos:
            ip = ipaddress.ip_address(sockaddr[0])
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
                return False
        return True
    except (OSError, ValueError):
        return False


_MAX_AVATAR_BYTES = 1_000_000  # ~1 MB cap on the source image
# Raster only - never store an SVG (avoids any scripted-SVG surprise downstream).
_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}


def fetch_avatar(access_token, picture_url, is_microsoft):
    """Best-effort profile photo as a data: URI. Tries the OIDC `picture` claim
    (Google et al.), then Microsoft Graph's /me/photo. Returns None on ANY
    problem - the caller treats the avatar as optional and never lets it block
    sign-in. follow_redirects is off and only https picture URLs are fetched, to
    limit the SSRF surface from an attacker-influenced claim value."""
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as c:
            if picture_url and _is_public_https(str(picture_url)):
                r = c.get(picture_url)
            elif is_microsoft and access_token:
                r = c.get(
                    "https://graph.microsoft.com/v1.0/me/photo/$value",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            else:
                return None
            if r.status_code != 200:
                return None
            data = r.content
            ctype = (r.headers.get("content-type") or "image/jpeg").split(";")[0].strip()
        if not data or len(data) > _MAX_AVATAR_BYTES or ctype not in _ALLOWED_IMAGE_TYPES:
            return None
        return f"data:{ctype};base64," + base64.b64encode(data).decode("ascii")
    except Exception:
        return None
