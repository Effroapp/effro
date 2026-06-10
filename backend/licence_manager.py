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
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import models

_PREFIX = "effro-lic-v1"
_DEFAULT_GRACE_DAYS = 30
_MAX_GRACE_DAYS = 3650          # 10y ceiling: keeps date math in state() from overflowing
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
    # Claims are signature-verified but otherwise untrusted: normalise defensively
    # so a malformed value can't silently unlock or crash the gate. (bool is an
    # int subclass, so exclude it explicitly.)
    seats = claims.get("seats")
    seats = int(seats) if isinstance(seats, int) and not isinstance(seats, bool) and seats >= 0 else None
    grace = claims.get("grace_days")
    grace = (min(int(grace), _MAX_GRACE_DAYS)
             if isinstance(grace, int) and not isinstance(grace, bool) and grace >= 0
             else _DEFAULT_GRACE_DAYS)
    edition = "enterprise" if str(claims.get("edition", "")).strip().lower() == "enterprise" else "pro"
    return LicenceContext(
        present=True,
        edition=edition,
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
    """True if one more active user fits within the seat limit.

    Note: this is a check-then-insert (TOCTOU) - two concurrent creations /
    SSO provisions can both pass and overshoot the cap by one. That is an
    accepted limitation of the soft seat model: `over_seat` is non-hostile (it
    only pauses further growth, never locks anyone out) and the next creation is
    refused once the count exceeds seats, so a one-off race self-corrects. Hard
    serialisation (a SELECT ... FOR UPDATE on a seat-counter row) belongs with
    the Postgres migration; on today's single-writer SQLite it is moot."""
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


# ── Effective capabilities (edition default + admin config + env) ──────────────
# The matrix is "derived from edition + admin config in one place" (spec §6).
# edition_caps() above gives the edition DEFAULTS; the helpers below resolve the
# few capabilities that an admin can set or that an env var pins at deploy.

_AI_PIN_KEY = "ai_endpoint_pinned"          # "1" once an enterprise admin has set AI config
_MEMBER_EXPORT_KEY = "member_self_export"   # admin override "1"/"0"; absent -> edition default


def _get_setting(db, key) -> Optional[str]:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    return row.value if row else None


def _set_setting(db, key, value) -> None:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.AppSettings(key=key, value=value))


def ai_endpoint_env() -> Optional[str]:
    """A deploy-pinned AI endpoint (highest precedence; unchangeable in-app)."""
    v = os.environ.get("EFFRO_AI_ENDPOINT")
    return v.strip() if v and v.strip() else None


def ai_pinned(db) -> bool:
    return _get_setting(db, _AI_PIN_KEY) == "1"


def mark_ai_pinned(db) -> None:
    """Record that the AI config has been set once (Enterprise locks it after)."""
    _set_setting(db, _AI_PIN_KEY, "1")
    db.commit()


def ai_config_locked(ctx: LicenceContext, db) -> bool:
    """True when the AI provider/endpoint must NOT be changed in-app by anyone
    (env-pinned, or Enterprise after the admin's one-time set)."""
    if ai_endpoint_env():
        return True
    if not edition_caps(ctx).ai_endpoint_locked:
        return False                        # Pro / desktop: freely configurable
    return ai_pinned(db)                    # Enterprise: locked once set


def member_self_export_allowed(ctx: LicenceContext, db) -> bool:
    """Whether non-admin members may self-export (admins always may; caller checks
    role). Admin override wins; otherwise the edition default (on Pro / off Ent)."""
    override = _get_setting(db, _MEMBER_EXPORT_KEY)
    if override in ("0", "1"):
        return override == "1"
    return edition_caps(ctx).member_self_export_default


def set_member_self_export(db, allowed: bool) -> None:
    _set_setting(db, _MEMBER_EXPORT_KEY, "1" if allowed else "0")
    db.commit()


# ── Admin status + renewal ────────────────────────────────────────────────────

def admin_status(ctx: LicenceContext, db, now: Optional[date] = None) -> dict:
    """Full licence view for GET /admin/licence (never includes the raw key)."""
    if now is None:
        now = datetime.utcnow().date()
    days_remaining = (ctx.expires_at - now).days if ctx.expires_at else None
    return {
        "required": licence_required(),
        "edition": ctx.edition,
        "customer_id": ctx.customer_id,
        "customer_name": ctx.customer_name,
        "seats": ctx.seats,
        "seats_used": seats_used(db),
        "expires_at": ctx.expires_at.isoformat() if ctx.expires_at else None,
        "days_remaining": days_remaining,
        "grace_days": ctx.grace_days,
        "state": state(ctx, now),
        "seat_state": seat_state(ctx, db),
        "valid_signature": ctx.signature_valid,
        "source": ctx.source,
        "key_id": ctx.key_id,
    }


def store_key(db, token: str) -> None:
    """Persist an admin-uploaded key to app_settings (highest-precedence source).
    Caller must have verified it first (parse_and_verify)."""
    _set_setting(db, _CONFIG_KEY, token.strip())
    db.commit()


# ── Setup token (closes the claimable-instance + setup-race holes) ────────────
# Provisioning seeds a one-time token when a licence is required and no users
# exist; /auth/setup must present it. Consumed atomically with the first-admin
# insert, so concurrent setups can't both succeed. Desktop / licence-off: no
# token, zero-friction first run, exactly as before.

_SETUP_TOKEN_KEY = "setup_token"


def ensure_setup_token(db) -> Optional[str]:
    """On boot: when a licence is required and the instance has no users yet,
    make sure a setup token exists and return it so the operator can read it
    from the logs. Returns None when not applicable (already set up, or flag
    off). Idempotent: an existing un-consumed token is returned, not rotated."""
    if not licence_required():
        return None
    if db.query(models.User).count() > 0:
        return None
    existing = _get_setting(db, _SETUP_TOKEN_KEY)
    if existing:
        return existing
    token = secrets.token_urlsafe(32)
    _set_setting(db, _SETUP_TOKEN_KEY, token)
    db.commit()
    return token


def setup_token_required(db) -> bool:
    """True when /auth/setup must present the one-time token: a licence is
    required AND the instance is not yet initialised. Fail-CLOSED: a licensed,
    user-less instance always requires the token, even if boot-time seeding
    failed (a restart re-seeds it) - so a seeding failure cannot reopen the
    'anyone can claim a fresh instance' hole. An already-initialised instance
    returns False here but is independently blocked by the user-count 409."""
    return licence_required() and db.query(models.User).count() == 0


def verify_setup_token(db, supplied: Optional[str]) -> bool:
    if not licence_required():
        return True                     # desktop / Pro: no token, zero-friction
    stored = _get_setting(db, _SETUP_TOKEN_KEY)
    if not stored:
        return False                    # required but unseeded -> refuse (fail-closed)
    return secrets.compare_digest(stored, (supplied or "").strip())


def consume_setup_token(db) -> int:
    """Delete the token WITHOUT committing; returns the rows removed (0 or 1).
    The caller requires exactly 1 before committing the first-admin insert: two
    concurrent setups with DIFFERENT emails both pass the email-UNIQUE check, so
    the atomic single-row delete is what actually makes setup single-use (the
    loser deletes 0 rows, rolls back, and 409s)."""
    return db.query(models.AppSettings).filter(
        models.AppSettings.key == _SETUP_TOKEN_KEY
    ).delete(synchronize_session=False)


def public_status(ctx: LicenceContext, db, now: Optional[date] = None) -> dict:
    """Compact, non-secret licence view for /auth/me and the licence panel, so the
    frontend can mirror the edition + state (read-only banner, hidden controls)."""
    caps = edition_caps(ctx)
    if now is None:
        now = datetime.utcnow().date()
    grace_days_left = None
    if ctx.expires_at and state(ctx, now) == "grace":
        grace_days_left = (ctx.expires_at + timedelta(days=ctx.grace_days) - now).days
    return {
        "edition": ctx.edition,
        "licence_required": licence_required(),
        "state": state(ctx, now),
        "seat_state": seat_state(ctx, db),
        "expires_at": ctx.expires_at.isoformat() if ctx.expires_at else None,
        "grace_days_left": grace_days_left,
        "capabilities": {
            "ai_endpoint_locked": ai_config_locked(ctx, db),
            "personal_connectors_allowed": caps.personal_connectors_allowed,
            "forced_sso": caps.forced_sso,
            "audit_always_on": caps.audit_always_on,
            "domain_allowlist_enforced": caps.domain_allowlist_enforced,
            "auto_update_enabled": caps.auto_update_enabled,
            "member_self_export_allowed": member_self_export_allowed(ctx, db),
        },
    }
