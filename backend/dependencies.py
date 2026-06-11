"""
The authentication gate used by every data route.

EFFRO_AUTH_ENABLED switches between two behaviours WITHOUT changing any call
site:

  * OFF (unset/false - the default, used by the Tauri desktop build):
    get_current_user returns a synthetic local admin instead of raising 401, so
    the desktop app runs with no login while still exercising every auth code
    path (audit attribution, admin checks, ownership filters). The gate is open.

  * ON (set in the Dockerfile for any server deployment): a valid session
    cookie is required; otherwise 401.

The flag is read at call time (not import time) so tests and the shell can
toggle it via the environment.
"""
import os
from datetime import datetime
from typing import Optional

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserSession
from auth_utils import SESSION_COOKIE


def auth_enabled() -> bool:
    """True when real authentication is enforced."""
    return os.environ.get("EFFRO_AUTH_ENABLED", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def folio_enabled() -> bool:
    """True when the Folio feature is switched on (read at call time, like the
    auth/licence flags). On by default now that Folio has shipped; set
    EFFRO_FOLIO_ENABLED to a falsey value (0/false/no/off) to hide it again."""
    return os.environ.get("EFFRO_FOLIO_ENABLED", "true").strip().lower() in (
        "1", "true", "yes", "on",
    )


def require_folio_enabled() -> None:
    """Router dependency: 404 when Folio is off, so the feature is invisible
    (not just forbidden) on instances that have not enabled it."""
    if not folio_enabled():
        raise HTTPException(status_code=404, detail="Not found")


def _local_user() -> User:
    """A non-persisted stand-in returned when the gate is open.

    id=1 lines up with the first row a hosted install's /auth/setup would
    create, so audit_logs.user_id stays meaningful in both modes. This instance
    is never added to a session or the DB, and downstream code only reads scalar
    attributes off it (id/email/role) - never its relationships.
    """
    return User(
        id=1,
        email="local@effro",
        display_name="Local user",
        role="admin",
        is_active=True,
    )


def get_current_user(
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    if not auth_enabled():
        return _local_user()
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = db.query(UserSession).filter(
        UserSession.id == session_token,
        UserSession.is_active == True,  # noqa: E712 (SQLAlchemy needs ==)
        UserSession.expires_at > datetime.utcnow(),
    ).first()
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    # Defence in depth: a still-active session row must also belong to a
    # still-active user. Suspending or GDPR-deleting a user sets
    # User.is_active=False; without this check their existing sessions would stay
    # valid until natural expiry (up to SESSION_EXPIRY_DAYS). Same generic
    # message as above so we don't reveal that the account was disabled.
    if not session.user or not session.user.is_active:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    session.last_seen_at = datetime.utcnow()
    db.commit()
    return session.user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
