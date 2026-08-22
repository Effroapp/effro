"""
User preferences router - durable, per-user key/value state.

Why this exists: the desktop shell clears all webview browsing data on every
version update as a deliberate cache bust, which takes localStorage with it.
State that has to survive an update therefore lives in the database instead,
keyed by the current user so a hosted deployment gives each person their own
set.

  - GET /prefs   -> every pref for the current user, as one dict
  - PUT /prefs   -> merge a partial dict into it, null deletes a key

Values are JSON-encoded on the way in and decoded on the way out, so a caller
can store a string, a number, a boolean or a small object without thinking
about it.

Keys in use today (the frontend owns these names):
  onboarding.completed_version  - "v1" once the wizard has been finished
  profile.display_name          - the name shown in the sidebar and avatar
  profile.avatar                - profile photo as a base64 data URL
  intro.<storageKey>            - one per dismissed IntroPanel
"""
import json
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import User, UserPref

router = APIRouter(tags=["prefs"])

# Matches models.UserPref.key. Anything longer is a client bug, not a big pref.
MAX_KEY_LENGTH = 120

# Generous ceiling on one value. The largest thing we store is an avatar as a
# base64 data URL, which lands around a megabyte, so this is roughly four times
# the real worst case: big enough never to bite in normal use, small enough that
# a runaway client cannot quietly fill the database.
MAX_VALUE_BYTES = 4 * 1024 * 1024

# The same ceiling applied to one request, so a batch of large values cannot
# get around the per-value limit.
MAX_PATCH_BYTES = 8 * 1024 * 1024


def _decode(raw: str):
    """Decode a stored value, tolerating a row that was written as a bare
    string by an older client rather than dropping it."""
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def _all_for_user(db: Session, user_id: int) -> Dict[str, Any]:
    rows = db.query(UserPref).filter(UserPref.user_id == user_id).all()
    return {r.key: _decode(r.value) for r in rows}


@router.get("/prefs")
def get_prefs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Every pref held for the current user, as one dict."""
    return _all_for_user(db, current_user.id)


@router.put("/prefs")
def update_prefs(
    patch: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Merge a partial dict of prefs. Keys not mentioned are left alone, and a key
    sent as null is deleted. Returns the full set afterwards so the caller can
    reconcile its cache in one round trip.
    """
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="Expected an object of prefs.")

    encoded: Dict[str, Any] = {}
    total = 0
    for key, value in patch.items():
        if not isinstance(key, str) or not key.strip():
            raise HTTPException(status_code=400, detail="Pref keys must be non-empty strings.")
        if len(key) > MAX_KEY_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Pref key is too long (limit {MAX_KEY_LENGTH} characters).",
            )
        if value is None:
            encoded[key] = None
            continue
        try:
            blob = json.dumps(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Pref '{key}' is not JSON-serialisable.")
        size = len(blob.encode("utf-8"))
        if size > MAX_VALUE_BYTES:
            raise HTTPException(status_code=413, detail=f"Pref '{key}' is too large.")
        total += size
        if total > MAX_PATCH_BYTES:
            raise HTTPException(status_code=413, detail="That set of prefs is too large.")
        encoded[key] = blob

    for key, blob in encoded.items():
        row = db.query(UserPref).filter(
            UserPref.user_id == current_user.id,
            UserPref.key == key,
        ).first()
        if blob is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(UserPref(user_id=current_user.id, key=key, value=blob))
        else:
            row.value = blob
    db.commit()

    return _all_for_user(db, current_user.id)
