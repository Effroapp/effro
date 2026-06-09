"""
Offline licence verification + edition / seat / state logic.

Mirrors the auth flag: `EFFRO_LICENCE_REQUIRED` off (desktop/dev) -> a synthetic
unlicensed-local context (Pro, unlimited seats, never expires, nothing gated);
on (hosted/enterprise) -> a signature-valid key is required and its edition,
seats and expiry are enforced. Verification is fully offline against a baked-in
Ed25519 public key - no phone-home, and (by design) no mid-term revocation.

See docs/LICENSING_AND_EDITIONS_SPEC.md. Key minting is vendor-only via
scripts/licence_gen.py; the private key never lives here.
"""
import base64
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import models

_PREFIX = "effro-lic-v1"
_DEFAULT_GRACE_DAYS = 30
_CONFIG_KEY = "licence_key"

# Baked-in Ed25519 public key(s), base64 of the raw 32 bytes. The matching
# private key is vendor-only (scripts/licence_gen.py). Multiple entries allow
# rotation (a token verifies if ANY key accepts it).
#
# WARNING: the entry below is a DEV PLACEHOLDER. Before issuing real licences,
# run `python scripts/licence_gen.py keygen` on a secure machine, keep the
# private key in the vendor secret store, and replace this list with the
# production public key.
PUBLIC_KEYS = [
    "lOZndd2wy3nxSW2ywJjNRQRi6ZYanmhB9IUF/BHQmP8=",  # dev placeholder - REPLACE
]


def licence_required() -> bool:
    """True when a valid licence is enforced (read at call time, like auth)."""
    return os.environ.get("EFFRO_LICENCE_REQUIRED", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


@dataclass
class LicenceContext:
    present: bool                 # a signature-valid key is loaded
    edition: str                 # "pro" | "enterprise"
    seats: Optional[int]         # None = unlimited
    customer_id: Optional[str]
    customer_name: Optional[str]
    expires_at: Optional[date]
    grace_days: int
    key_id: Optional[str] = None
    signature_valid: bool = True  # False when a key was supplied but failed verify, or required+missing
    source: str = "none"          # unlicensed_local | app_settings | env | file | none | invalid


@dataclass
class Capabilities:
    edition: str
    ai_endpoint_locked: bool
    personal_connectors_allowed: bool
    forced_sso: bool
    audit_always_on: bool
    domain_allowlist_enforced: bool
    auto_update_enabled: bool
    member_self_export_default: bool


# ── Token parse + verify ──────────────────────────────────────────────────────

def _b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def parse_and_verify(token) -> Optional[dict]:
    """Return the claims dict iff the token is well-formed AND its signature
    verifies against a baked public key; else None."""
    if not token or not isinstance(token, str):
        return None
    parts = token.strip().split(".")
    if len(parts) != 3 or parts[0] != _PREFIX:
        return None
    try:
        payload = _b64u_dec(parts[1])
        sig = _b64u_dec(parts[2])
    except Exception:
        return None
    verified = False
    for kb64 in PUBLIC_KEYS:
        try:
            Ed25519PublicKey.from_public_bytes(base64.b64decode(kb64)).verify(sig, payload)
            verified = True
            break
        except (InvalidSignature, Exception):
            continue
    if not verified:
        return None
    try:
        claims = json.loads(payload)
        return claims if isinstance(claims, dict) else None
    except Exception:
        return None


# ── Loading + context ─────────────────────────────────────────────────────────

def _load_token(db):
    """Highest precedence first: admin-uploaded (app_settings) > env > file."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _CONFIG_KEY).first()
    if row and row.value:
        return row.value, "app_settings"
    env = os.environ.get("EFFRO_LICENCE_KEY")
    if env and env.strip():
        return env.strip(), "env"
    path = os.environ.get(
        "EFFRO_LICENCE_FILE", os.path.join(os.environ.get("DATA_DIR", "."), "licence.key")
    )
    try:
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                t = f.read().strip()
                if t:
                    return t, "file"
    except Exception:
        pass
    return None, "none"


def _parse_date(s) -> Optional[date]:
    try:
        return date.fromisoformat(s)
    except Exception:
        return None


def _unlicensed_local() -> LicenceContext:
    return LicenceContext(
        present=False, edition="pro", seats=None, customer_id=None,
        customer_name=None, expires_at=None, grace_days=_DEFAULT_GRACE_DAYS,
        signature_valid=True, source="unlicensed_local",
    )


def _invalid(source: str) -> LicenceContext:
    return LicenceContext(
        present=False, edition="pro", seats=None, customer_id=None,
        customer_name=None, expires_at=None, grace_days=_DEFAULT_GRACE_DAYS,
        signature_valid=False, source=source,
    )


def current(db) -> LicenceContext:
    """Resolve the active licence context. Synthetic unlicensed-local when not
    required; otherwise load + verify from the configured source."""
    if not licence_required():
        return _unlicensed_local()
    token, source = _load_token(db)
    if not token:
        return _invalid("none")            # required but missing -> read-only
    claims = parse_and_verify(token)
    if not claims:
        return _invalid("invalid")         # supplied but bad signature/format
    seats = claims.get("seats")
    seats = int(seats) if isinstance(seats, int) and seats >= 0 else None
    grace = claims.get("grace_days")
    grace = int(grace) if isinstance(grace, int) and grace >= 0 else _DEFAULT_GRACE_DAYS
    return LicenceContext(
        present=True,
        edition="enterprise" if claims.get("edition") == "enterprise" else "pro",
        seats=seats,
        customer_id=claims.get("customer_id"),
        customer_name=claims.get("customer_name"),
        expires_at=_parse_date(claims.get("expires_at")),
        grace_days=grace,
        key_id=claims.get("key_id"),
        signature_valid=True,
        source=source,
    )


# ── State machine ─────────────────────────────────────────────────────────────

def state(ctx: LicenceContext, now: Optional[date] = None) -> str:
    """'valid' | 'grace' | 'read_only'."""
    if now is None:
        now = datetime.utcnow().date()
    if ctx.source == "unlicensed_local":
        return "valid"
    if not ctx.signature_valid:
        return "read_only"          # missing-when-required or bad signature
    if not ctx.expires_at:
        return "read_only"          # a valid key must carry an expiry
    if now <= ctx.expires_at:
        return "valid"
    if now <= ctx.expires_at + timedelta(days=ctx.grace_days):
        return "grace"
    return "read_only"


# ── Seats ─────────────────────────────────────────────────────────────────────

def seats_used(db) -> int:
    return db.query(models.User).filter(models.User.is_active == True).count()  # noqa: E712


def seat_state(ctx: LicenceContext, db) -> str:
    if ctx.seats is None:
        return "ok"
    return "over_seat" if seats_used(db) > ctx.seats else "ok"


def seat_available(ctx: LicenceContext, db) -> bool:
    """True if one more active user fits within the seat limit."""
    if ctx.seats is None:
        return True
    return seats_used(db) < ctx.seats


# ── Editions ──────────────────────────────────────────────────────────────────

def edition_caps(ctx: LicenceContext) -> Capabilities:
    ent = ctx.edition == "enterprise"
    return Capabilities(
        edition=ctx.edition,
        ai_endpoint_locked=ent,
        personal_connectors_allowed=not ent,
        forced_sso=ent,
        audit_always_on=ent,
        domain_allowlist_enforced=ent,
        auto_update_enabled=not ent,
        member_self_export_default=not ent,
    )
