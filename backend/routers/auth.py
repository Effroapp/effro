"""
Authentication endpoints: first-run setup, login, logout, and the current-user
probe.

These handle their own authentication and are ALWAYS public (never behind
get_current_user) - they are the way a session is created in the first place.
Whether the rest of the API actually enforces a session is controlled by
EFFRO_AUTH_ENABLED (see dependencies.py); these endpoints work regardless, so a
hosted deployment can create and authenticate accounts.

Sessions are server-side rows (user_sessions); the session id is a random
token stored in an HttpOnly cookie.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from dependencies import auth_enabled, get_current_user
from models import User, UserSession
from auth_utils import (
    DUMMY_PASSWORD_HASH,
    SESSION_COOKIE,
    SESSION_EXPIRY_DAYS,
    generate_session_token,
    hash_password,
    session_expiry,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Request bodies ───────────────────────────────────────────────────────────
# Plain `str` for email (not EmailStr) keeps us off the email-validator dep; we
# normalise + do a light check by hand.

class SetupIn(BaseModel):
    email: str
    display_name: Optional[str] = None
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def _issue_session(db: Session, user: User, request: Request, response: Response) -> str:
    """Create a session row for the user and set the session cookie."""
    # Opportunistic cleanup: drop this user's expired or revoked session rows so
    # the table stays bounded without a separate cron (review hygiene finding).
    db.query(UserSession).filter(
        UserSession.user_id == user.id,
        or_(UserSession.expires_at < datetime.utcnow(),
            UserSession.is_active == False),  # noqa: E712
    ).delete(synchronize_session=False)
    token = generate_session_token()
    db.add(UserSession(
        id=token,
        user_id=user.id,
        expires_at=session_expiry(),
        ip_address=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    ))
    user.last_login_at = datetime.utcnow()
    db.commit()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="strict",
        max_age=SESSION_EXPIRY_DAYS * 86400,
        path="/",
        # `secure` is intentionally left off so the cookie works over
        # http://127.0.0.1 (the desktop shell) and the dev server; hosted
        # deployments terminate TLS at the proxy and can opt in later.
    )
    return token


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/setup")
def setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Create the first admin account. Only works while no users exist."""
    if db.query(User).count() > 0:
        raise HTTPException(status_code=409, detail="This instance is already set up.")
    email = _normalise_email(body.email)
    if not email or not body.password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
    user = User(
        email=email,
        display_name=(body.display_name or "").strip() or None,
        password_hash=hash_password(body.password),
        role="admin",
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Lost a concurrent first-run race (the email UNIQUE constraint fired),
        # or the instance was initialised between the count() check and here.
        # Either way it is already set up - return 409, not a raw 500.
        db.rollback()
        raise HTTPException(status_code=409, detail="This instance is already set up.")
    db.refresh(user)
    _issue_session(db, user, request, response)
    return {"user_id": user.id, "display_name": user.display_name, "role": user.role}


@router.get("/setup/status")
def setup_status(db: Session = Depends(get_db)):
    """Public. True once at least one user exists; the frontend uses this to
    choose between the setup page and the login page."""
    return {"initialised": db.query(User).count() > 0}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = _normalise_email(body.email)
    user = db.query(User).filter(func.lower(User.email) == email).first()
    # Always run exactly one argon2 verify - against a dummy hash when the
    # account is missing / passwordless / inactive - so response time can't be
    # used to enumerate which emails are registered (timing oracle).
    hashed = user.password_hash if (user and user.password_hash) else DUMMY_PASSWORD_HASH
    password_ok = verify_password(body.password, hashed)
    # One generic message: don't leak which part failed.
    if not user or not user.password_hash or not user.is_active or not password_ok:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    _issue_session(db, user, request, response)
    return {"user_id": user.id, "display_name": user.display_name, "role": user.role}


@router.post("/logout")
def logout(
    response: Response,
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
):
    if session_token:
        sess = db.query(UserSession).filter(UserSession.id == session_token).first()
        if sess:
            sess.is_active = False
            db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    """Return the signed-in user. When EFFRO_AUTH_ENABLED is off this is the
    synthetic local admin (see dependencies.get_current_user)."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
        # Lets the frontend tell desktop (gate open, synthetic admin) from a real
        # hosted session, e.g. to show the admin Users tab only when auth is on.
        "auth_enabled": auth_enabled(),
    }


# ── Session management ───────────────────────────────────────────────────────
# Gated (not in the public allowlist): a user manages only their own sessions.

@router.get("/sessions")
def list_sessions(
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the current user's active sessions. Only an 8-char id prefix is
    exposed (never the full token), enough to identify a row for revocation."""
    rows = (
        db.query(UserSession)
        .filter(UserSession.user_id == current_user.id,
                UserSession.is_active == True)  # noqa: E712
        .order_by(UserSession.last_seen_at.desc())
        .all()
    )
    return [
        {
            "id": s.id[:8],
            "created_at": s.created_at,
            "last_seen_at": s.last_seen_at,
            "ip_address": s.ip_address,
            "user_agent": s.user_agent,
            "is_current": bool(session_token and s.id == session_token),
        }
        for s in rows
    ]


@router.delete("/sessions/{session_id}")
def revoke_session(
    session_id: str,
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke one of the current user's sessions by the 8-char prefix from GET
    /sessions. Only that user's rows match; the current session can't be revoked
    here (use logout)."""
    rows = (
        db.query(UserSession)
        .filter(
            UserSession.user_id == current_user.id,
            UserSession.is_active == True,  # noqa: E712
            UserSession.id.like(f"{session_id}%"),
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")
    if session_token and any(s.id == session_token for s in rows):
        raise HTTPException(status_code=400, detail="Cannot revoke the current session; use logout.")
    for s in rows:
        s.is_active = False
    db.commit()
    return {"revoked": len(rows)}


@router.delete("/sessions")
def revoke_other_sessions(
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke all of the current user's sessions except the current one."""
    q = db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.is_active == True,  # noqa: E712
    )
    if session_token:
        q = q.filter(UserSession.id != session_token)
    revoked = 0
    for s in q.all():
        s.is_active = False
        revoked += 1
    db.commit()
    return {"revoked": revoked}


@router.post("/change-password")
def change_password(
    body: ChangePasswordIn,
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the current user's password, then revoke every other session."""
    # Re-load the persistent row: the flag-off synthetic local admin has no DB
    # row / password, so this correctly 401s on the desktop build.
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user or not user.password_hash or not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if not body.new_password:
        raise HTTPException(status_code=400, detail="A new password is required.")
    user.password_hash = hash_password(body.new_password)
    # Force re-login everywhere else (keep the current session alive).
    others = db.query(UserSession).filter(
        UserSession.user_id == user.id,
        UserSession.is_active == True,  # noqa: E712
    )
    if session_token:
        others = others.filter(UserSession.id != session_token)
    for s in others.all():
        s.is_active = False
    db.commit()
    return {"ok": True}
