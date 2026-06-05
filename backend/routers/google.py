"""
Google integration router.

Exposes (mirrors the Microsoft router):
  GET    /google/config            - Google OAuth app config (secret masked)
  PUT    /google/config            - persist user-supplied OAuth client creds
  GET    /google/profile           - "connected as <email>" view, no tokens
  GET    /google/auth/login        - kicks off the OAuth flow (web flow)
  GET    /google/auth/callback     - Google redirects here on consent
  POST   /google/auth/exchange     - desktop flow: frontend posts {code, state}
  DELETE /google/auth/disconnect   - drop tokens + profile
  POST   /google/sync-now          - one-off manual sync (drives Signals)

Security boundary: the user registers the Google Cloud OAuth app and signs in
through their own browser. The app only does the code -> token exchange after
consent.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import models
import schemas
import google_client as gc
from database import get_db

log = logging.getLogger("trace.routers.google")
router = APIRouter(prefix="/google", tags=["google"])


# ─── Config ──────────────────────────────────────────────────────────────────

@router.get("/config", response_model=schemas.GoogleConfigOut)
def get_google_config(db: Session = Depends(get_db)):
    cfg = gc.get_config(db)
    secret = cfg.get("client_secret") or ""
    masked = None
    if secret:
        masked = "•" * 8 + secret[-4:] if len(secret) >= 4 else "•" * 8
    return schemas.GoogleConfigOut(
        client_id=cfg.get("client_id"),
        client_secret_masked=masked,
        is_configured=bool(cfg.get("client_id") and cfg.get("client_secret")),
    )


@router.put("/config", response_model=schemas.GoogleConfigOut)
def save_google_config(payload: schemas.GoogleConfigIn, db: Session = Depends(get_db)):
    if not payload.client_id.strip() or not payload.client_secret.strip():
        raise HTTPException(status_code=400, detail="client_id and client_secret are required")
    gc.save_config(db, client_id=payload.client_id, client_secret=payload.client_secret)
    return get_google_config(db)


# ─── Profile ─────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=schemas.GoogleProfileOut)
def get_profile(db: Session = Depends(get_db)):
    integration = db.query(models.GoogleIntegration).first()
    if not integration:
        return schemas.GoogleProfileOut(connected=False)
    return schemas.GoogleProfileOut(
        connected=True,
        display_name=integration.display_name,
        email=integration.email,
        connected_at=integration.connected_at.isoformat() if integration.connected_at else None,
        last_synced=integration.last_synced.isoformat() if integration.last_synced else None,
    )


# ─── OAuth ───────────────────────────────────────────────────────────────────

@router.get("/auth/login")
def auth_login(db: Session = Depends(get_db)):
    try:
        state = secrets.token_urlsafe(32)
        gc.add_state(db, state)
        auth_url = gc.get_auth_url(db, state=state)
    except ValueError as e:
        return RedirectResponse(url=f"/settings?google_error={str(e).replace(' ', '_')}")
    return RedirectResponse(url=auth_url)


@router.get("/auth/callback")
async def auth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if error:
        log.warning("Google OAuth error: %s", error)
        return RedirectResponse(url=f"/settings?google_error={error}")
    if not state or not gc.pop_state(db, state):
        return RedirectResponse(url="/settings?google_error=invalid_state")
    if not code:
        return RedirectResponse(url="/settings?google_error=no_code")
    try:
        await _complete_auth(db, code)
    except Exception as e:
        log.error("Google OAuth completion failed: %s", e)
        from urllib.parse import quote
        return RedirectResponse(url=f"/settings?google_error={quote(str(e)[:400], safe='')}")
    return RedirectResponse(url="/settings?google_connected=true")


@router.post("/auth/exchange", response_model=schemas.GoogleProfileOut)
async def auth_exchange(payload: dict = Body(...), db: Session = Depends(get_db)):
    code = (payload.get("code") or "").strip()
    state = (payload.get("state") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")
    if state and not gc.pop_state(db, state):
        raise HTTPException(status_code=400, detail="Invalid OAuth state parameter")
    try:
        await _complete_auth(db, code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return get_profile(db)


async def _complete_auth(db: Session, code: str) -> None:
    """code -> tokens -> profile -> DB."""
    token_result = gc.exchange_code_for_tokens(db, code)
    access_token = token_result["access_token"]
    refresh_token = token_result.get("refresh_token")
    expires_in = token_result.get("expires_in", 3600)

    profile = await gc.fetch_user_profile(access_token)
    google_user_id = profile.get("sub")
    if not google_user_id:
        raise ValueError("Google profile fetch returned no id")

    integration = (
        db.query(models.GoogleIntegration)
        .filter(models.GoogleIntegration.google_user_id == google_user_id)
        .first()
    )
    if not integration:
        integration = models.GoogleIntegration(google_user_id=google_user_id)
        db.add(integration)

    gc.store_tokens(
        db,
        integration=integration,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
    )
    integration.display_name = profile.get("name")
    integration.email = profile.get("email")
    integration.avatar_url = profile.get("picture")
    integration.last_synced = datetime.utcnow()
    db.commit()
    log.info("Google account connected: %s", integration.email)


@router.delete("/auth/disconnect")
def auth_disconnect(db: Session = Depends(get_db)):
    deleted = db.query(models.GoogleIntegration).delete()
    db.commit()
    return {"deleted": deleted}


# ─── Sync ─────────────────────────────────────────────────────────────────────

@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    """Run the same job as the scheduler, on demand."""
    from services_google import run_google_sync
    return run_google_sync(db)
