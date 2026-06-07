"""
Admin user management. Every endpoint requires an admin (require_admin) and is
gated by the auth middleware. The Users tab in Settings is the real surface;
this only matters when auth is on (a single-user desktop has no other users).
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import oidc_client
from database import get_db
from dependencies import require_admin
from auth_utils import hash_password
from models import User, UserSession

router = APIRouter(prefix="/admin", tags=["admin"])

_ROLES = ("admin", "member")


class CreateUserIn(BaseModel):
    email: str
    display_name: Optional[str] = None
    role: str = "member"
    password: str


class UpdateUserIn(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


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


@router.post("/users")
def create_user(
    body: CreateUserIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    email = (body.email or "").strip().lower()
    if not email or not body.password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
    role = body.role if body.role in _ROLES else "member"
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=409, detail="A user with that email already exists.")
    user = User(
        email=email,
        display_name=(body.display_name or "").strip() or None,
        password_hash=hash_password(body.password),
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
    return _public(user)


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
