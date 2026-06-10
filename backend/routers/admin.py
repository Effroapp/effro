"""
Admin user management. Every endpoint requires an admin (require_admin) and is
gated by the auth middleware. The Users tab in Settings is the real surface;
this only matters when auth is on (a single-user desktop has no other users).
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import demo_seed
import email_client
import licence_manager
import oidc_client
from database import get_db
from dependencies import require_admin
from auth_utils import generate_session_token, hash_password
from models import User, UserSession, PasswordResetToken

router = APIRouter(prefix="/admin", tags=["admin"])

_ROLES = ("admin", "member")
INVITE_TOKEN_DAYS = 7


class CreateUserIn(BaseModel):
    email: str
    display_name: Optional[str] = None
    role: str = "member"
    # Either set a temporary password directly, or set send_invite=true to email
    # the new user a set-password link (requires SMTP configured).
    password: Optional[str] = None
    send_invite: bool = False


class UpdateUserIn(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class SmtpConfigIn(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 587
    username: str = ""
    from_address: str = ""
    use_tls: bool = True
    # Write-only; blank keeps the stored password.
    password: Optional[str] = None


class SmtpTestIn(BaseModel):
    to: Optional[str] = None


class OidcConfigIn(BaseModel):
    enabled: bool = False
    provider_name: Optional[str] = None
    client_id: str = ""
    discovery_url: str = ""
    # Write-only; blank means keep the stored secret.
    client_secret: Optional[str] = None


def _public(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": u.created_at,
        "last_login_at": u.last_login_at,
    }


def _other_active_admins(db: Session, exclude_id: int) -> int:
    return (
        db.query(User)
        .filter(User.role == "admin", User.is_active == True,  # noqa: E712
                User.id != exclude_id)
        .count()
    )


@router.get("/users")
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [_public(u) for u in db.query(User).order_by(User.created_at).all()]


def _send_invite(db: Session, user: User, request: Request) -> None:
    """Create a single-use set-password token and email the new user a link. On
    send failure, roll the whole invite back so no orphan account is left."""
    token = generate_session_token()
    db.add(PasswordResetToken(
        id=token,
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(days=INVITE_TOKEN_DAYS),
        used=False,
    ))
    db.commit()
    link = f"{str(request.base_url).rstrip('/')}/set-password?token={token}"
    body = (
        "Hi,\n\n"
        "You have been added to Effro. Set your password to get started:\n\n"
        f"{link}\n\n"
        f"This link expires in {INVITE_TOKEN_DAYS} days. If you were not expecting "
        "this, you can ignore this email.\n"
    )
    try:
        email_client.send_email(db, user.email, "You have been added to Effro", body)
    except Exception as e:
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id
        ).delete(synchronize_session=False)
        db.delete(user)
        db.commit()
        raise HTTPException(
            status_code=502,
            detail=f"Could not send the invite email: {e}. Check the email (SMTP) settings.",
        )


@router.post("/users")
def create_user(
    body: CreateUserIn,
    request: Request,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    email = (body.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    if not body.send_invite and not body.password:
        raise HTTPException(status_code=400, detail="Set a temporary password, or enable the email invite.")
    if body.send_invite and not email_client.is_enabled(db):
        raise HTTPException(status_code=400, detail="Configure email (SMTP) in Settings before sending invites.")
    role = body.role if body.role in _ROLES else "member"
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=409, detail="A user with that email already exists.")
    _ctx = licence_manager.current(db)
    if not licence_manager.seat_available(_ctx, db):
        raise HTTPException(
            status_code=403,
            detail=f"Seat limit reached ({licence_manager.seats_used(db)} of {_ctx.seats}). "
                   "Add seats or deactivate a user first.",
        )

    user = User(
        email=email,
        display_name=(body.display_name or "").strip() or None,
        # Invite users start with no password; they set it via the emailed link.
        password_hash=hash_password(body.password) if body.password else None,
        role=role,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A user with that email already exists.")
    db.refresh(user)

    if body.send_invite:
        _send_invite(db, user, request)  # raises (and rolls back) on send failure

    result = _public(user)
    result["invited"] = bool(body.send_invite)
    return result


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    body: UpdateUserIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    demoting = body.role is not None and body.role != "admin" and user.role == "admin"
    deactivating = body.is_active is False and user.is_active
    # Don't strand the instance with no admin: block if this change would drop
    # the active-admin count to zero.
    if (demoting or deactivating) and user.role == "admin" and user.is_active \
            and _other_active_admins(db, exclude_id=user.id) == 0:
        raise HTTPException(status_code=400, detail="Cannot remove the last admin.")

    if body.role is not None:
        if body.role not in _ROLES:
            raise HTTPException(status_code=400, detail="Invalid role.")
        user.role = body.role
    if body.is_active is not None:
        if body.is_active and not user.is_active:
            # Reactivating consumes a seat.
            _ctx = licence_manager.current(db)
            if not licence_manager.seat_available(_ctx, db):
                raise HTTPException(
                    status_code=403,
                    detail=f"Seat limit reached ({licence_manager.seats_used(db)} of {_ctx.seats}). "
                           "Add seats or deactivate a user first.",
                )
        user.is_active = body.is_active
        if body.is_active is False:
            # Immediate revocation: kill the user's live sessions now, don't wait
            # for the request-time is_active gate / natural expiry.
            db.query(UserSession).filter(
                UserSession.user_id == user.id,
                UserSession.is_active == True,  # noqa: E712
            ).update({UserSession.is_active: False}, synchronize_session=False)
    db.commit()
    db.refresh(user)
    return _public(user)


@router.delete("/users/{user_id}/sessions")
def revoke_user_sessions(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Revoke all of a user's active sessions immediately (e.g. on offboarding)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    rows = db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.is_active == True,  # noqa: E712
    ).all()
    for s in rows:
        s.is_active = False
    db.commit()
    return {"revoked": len(rows)}


# ── Demo data (admin; showcase only) ──────────────────────────────────────────

@router.post("/demo/seed")
def load_demo_data(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Load (or reload) the showcase demo dataset.

    Guarded so it can NEVER destroy real work: it only runs on an instance that
    is empty (no areas) or one that has already been seeded with demo data.
    On a populated real instance it refuses with 409. It wipes content tables
    only - users, sessions, settings and the licence are left untouched - and
    re-centres all dates on today, so reloading mid-demo gives fresh data.
    """
    if demo_seed.area_count(db) > 0 and not demo_seed.is_demo(db):
        raise HTTPException(
            status_code=409,
            detail="This instance already has data. Loading demo data is only available on an "
                   "empty or demo instance, so it cannot overwrite real work.",
        )
    counts = demo_seed.reset_and_seed(db)
    return {"ok": True, **counts}


# ── OIDC SSO configuration (admin) ────────────────────────────────────────────

@router.get("/oidc-config")
def get_oidc_config(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Current OIDC config (never returns the secret, only has_secret)."""
    return oidc_client.get_config(db)


@router.put("/oidc-config")
def put_oidc_config(
    body: OidcConfigIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return oidc_client.save_config(
        db,
        enabled=body.enabled,
        provider_name=body.provider_name,
        client_id=body.client_id,
        discovery_url=body.discovery_url,
        client_secret=body.client_secret,
    )


# ── Email (SMTP) configuration (admin) ────────────────────────────────────────

@router.get("/smtp-config")
def get_smtp_config(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Current SMTP config (never returns the password, only has_password)."""
    return email_client.get_config(db)


@router.put("/smtp-config")
def put_smtp_config(
    body: SmtpConfigIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return email_client.save_config(
        db,
        enabled=body.enabled,
        host=body.host,
        port=body.port,
        username=body.username,
        from_address=body.from_address,
        use_tls=body.use_tls,
        password=body.password,
    )


@router.post("/smtp-config/test")
def test_smtp(
    body: SmtpTestIn,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Send a test email so the admin can confirm SMTP works before inviting."""
    to = (body.to or current_admin.email or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="No destination address.")
    try:
        email_client.send_email(
            db, to, "Effro email test",
            "This is a test email from Effro. Your email (SMTP) settings are working.\n",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Test email failed: {e}")
    return {"ok": True, "sent_to": to}
