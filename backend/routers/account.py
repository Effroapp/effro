"""
GDPR data-subject endpoints: data export and account deletion. Both are gated
(a user acts only on their own account) and require the user to be real - the
flag-off synthetic local admin has no DB row / password, so on the desktop build
export returns just content and delete 401s (the desktop DB is never at risk).

SCOPE NOTE: there is no per-user ownership of areas/threads/entries yet (an open
product decision - see the strategy doc). Today an instance is single-user
(desktop) or single-tenant-per-org, so "the user's data" is the whole instance's
content. Export returns all of it; delete erases all of it. Once per-area
ownership lands (Phase 3) - and on Postgres (Phase 4), where audit_logs.area_id
ON DELETE CASCADE will actually fire - both must be scoped to the user and the
audit anonymisation must happen before any area delete.
"""
import hashlib
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from auth_utils import SESSION_COOKIE, verify_password
from models import (
    User, UserSession, Area, Thread, Entry, AuditLog, WorkSession, DeletionLog,
)

router = APIRouter(prefix="/account", tags=["account"])


class DeleteAccountIn(BaseModel):
    password: str


def _row(obj) -> dict:
    """Serialise an ORM row to a plain dict of its columns."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@router.get("/export")
def export_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return everything held for the user as a JSON download (data portability)."""
    user = db.query(User).filter(User.id == current_user.id).first()
    user_data = None
    if user:
        user_data = _row(user)
        user_data.pop("password_hash", None)  # never export the hash

    payload = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user": user_data,
        # No per-user ownership yet -> export the whole instance's content.
        "areas": [_row(a) for a in db.query(Area).all()],
        "threads": [_row(t) for t in db.query(Thread).all()],
        "entries": [_row(e) for e in db.query(Entry).all()],
        "work_sessions": [_row(w) for w in db.query(WorkSession).all()],
        "audit_log": [
            _row(x) for x in db.query(AuditLog)
            .filter(AuditLog.user_id == current_user.id).all()
        ],
    }
    filename = f"effro-export-{datetime.utcnow().date().isoformat()}.json"
    return Response(
        content=json.dumps(payload, indent=2, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("")
def delete_account(
    body: DeleteAccountIn,
    response: Response,
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Erase the account and its data (right to erasure), password-confirmed."""
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Password is incorrect.")

    email_hash = hashlib.sha256((user.email or "").encode("utf-8")).hexdigest()

    # Anonymise audit rows first (keep the action record, drop the person), then
    # hard-delete content. See the module SCOPE NOTE for the ownership/Postgres
    # caveats. Delete order respects FKs: entries -> threads -> areas.
    db.query(AuditLog).filter(AuditLog.user_id == user.id).update(
        {AuditLog.user_id: None}, synchronize_session=False
    )
    db.query(Entry).delete(synchronize_session=False)
    db.query(Thread).delete(synchronize_session=False)
    db.query(Area).delete(synchronize_session=False)
    db.query(WorkSession).delete(synchronize_session=False)
    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)

    # Tombstone the user. email is NOT NULL + unique, so anonymise it to a unique
    # sentinel rather than blanking to NULL.
    user.is_active = False
    user.password_hash = None
    user.display_name = None
    user.email = f"deleted-{user.id}@deleted.invalid"

    db.add(DeletionLog(email_hash=email_hash))
    db.commit()

    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
