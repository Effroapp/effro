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
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def _issue_session(db: Session, user: User, request: Request, response: Response) -> str:
    """Create a session row for the user and set the session cookie."""
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
    }
