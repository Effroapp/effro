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
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import oidc_client
from database import get_db
from dependencies import auth_enabled, get_current_user
from models import User, UserSession, PasswordResetToken
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


class SetPasswordIn(BaseModel):
    token: str
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
        "avatar": current_user.avatar,
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


# ── OIDC SSO (hand-rolled; always public, in the gate allowlist) ──────────────

def _oidc_redirect_uri(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/api/auth/oidc/callback"


@router.get("/oidc/config")
def oidc_config(db: Session = Depends(get_db)):
    """Public. Lets the login page decide whether to show the SSO button."""
    cfg = oidc_client.get_config(db)
    return {"enabled": oidc_client.is_enabled(db), "provider_name": cfg["provider_name"]}


@router.get("/oidc/login")
def oidc_login(request: Request, db: Session = Depends(get_db)):
    """Public. Mint state + redirect the browser to the IdP."""
    try:
        url = oidc_client.build_auth_url(db, _oidc_redirect_uri(request))
    except Exception:
        return RedirectResponse(url="/login?error=sso_unavailable")
    return RedirectResponse(url=url)


@router.get("/oidc/callback")
def oidc_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Public. IdP redirects here; validate state, exchange the code, sign in."""
    if error or not code:
        return RedirectResponse(url="/login?error=sso_failed")
    if not oidc_client.pop_state(db, state or ""):
        return RedirectResponse(url="/login?error=invalid_state")
    try:
        claims = oidc_client.complete_login(db, code, _oidc_redirect_uri(request))
    except Exception:
        return RedirectResponse(url="/login?error=sso_failed")

    user = db.query(User).filter(
        User.sso_subject == claims["sub"],
        User.sso_provider == claims["iss"],
    ).first()
    if user is None:
        # First SSO sign-in: provision a member account (no password). If the
        # email already belongs to an active account, link the SSO identity to it
        # (same IdP owns the org's addresses, so this is expected for enterprise).
        email = (claims.get("email") or f"{claims['sub']}@sso.local").strip().lower()
        user = User(
            email=email,
            display_name=claims.get("name"),
            role="member",
            is_active=True,
            sso_subject=claims["sub"],
            sso_provider=claims["iss"],
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.query(User).filter(func.lower(User.email) == email).first()
            if existing and existing.is_active:
                existing.sso_subject = claims["sub"]
                existing.sso_provider = claims["iss"]
                db.commit()
                user = existing
            else:
                return RedirectResponse(url="/login?error=sso_failed")
        db.refresh(user)

    if not user.is_active:
        return RedirectResponse(url="/login?error=account_disabled")

    # First SSO sign-in with no avatar yet: pull the IdP profile photo
    # (best-effort; never blocks sign-in). Committed by _issue_session below.
    if not user.avatar:
        avatar = oidc_client.fetch_avatar(
            claims.get("access_token"), claims.get("picture"), claims.get("is_microsoft"),
        )
        if avatar:
            user.avatar = avatar

    resp = RedirectResponse(url="/", status_code=303)
    _issue_session(db, user, request, resp)
    return resp


# ── Set / reset password via emailed token (always public) ────────────────────

def _valid_reset_token(db: Session, token: str):
    if not token:
        return None
    return db.query(PasswordResetToken).filter(
        PasswordResetToken.id == token,
        PasswordResetToken.used == False,  # noqa: E712
        PasswordResetToken.expires_at > datetime.utcnow(),
    ).first()


@router.get("/reset-token/{token}")
def reset_token_info(token: str, db: Session = Depends(get_db)):
    """Public. Tells the set-password page whether an invite/reset link is usable."""
    prt = _valid_reset_token(db, token)
    if not prt:
        return {"valid": False, "email": None}
    user = db.query(User).filter(User.id == prt.user_id).first()
    if not user or not user.is_active:
        return {"valid": False, "email": None}
    return {"valid": True, "email": user.email}


@router.post("/set-password")
def set_password(
    body: SetPasswordIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Public. Consume a single-use token, set the password, and sign in."""
    prt = _valid_reset_token(db, body.token)
    if not prt:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired.")
    if not body.new_password:
        raise HTTPException(status_code=400, detail="A password is required.")
    user = db.query(User).filter(User.id == prt.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="This account is not available.")
    user.password_hash = hash_password(body.new_password)
    prt.used = True
    db.commit()
    _issue_session(db, user, request, response)
    return {"user_id": user.id, "display_name": user.display_name, "role": user.role}
