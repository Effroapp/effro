"""
Dropbox router - OAuth + config for the Dropbox Cloud Storage backend.

  GET    /dropbox/config          - app key/secret config (secret masked)
  PUT    /dropbox/config          - persist app key/secret
  GET    /dropbox/profile         - "connected as <email>" view, no tokens
  GET    /dropbox/auth/login      - start OAuth (web flow)
  GET    /dropbox/auth/callback   - Dropbox redirects here on consent
  DELETE /dropbox/auth/disconnect - drop tokens + account

Dropbox is storage-only (encrypted backups), so there is no sync job here.
"""
from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import models
import schemas
import dropbox_client as dbx
from database import get_db

log = logging.getLogger("effro.routers.dropbox")
router = APIRouter(prefix="/dropbox", tags=["dropbox"])


@router.get("/config", response_model=schemas.DropboxConfigOut)
def get_dropbox_config(db: Session = Depends(get_db)):
    cfg = dbx.get_config(db)
    secret = cfg.get("app_secret") or ""
    masked = ("•" * 8 + secret[-4:]) if len(secret) >= 4 else ("•" * 8 if secret else None)
    return schemas.DropboxConfigOut(
        app_key=cfg.get("app_key"),
        app_secret_masked=masked,
        is_configured=bool(cfg.get("app_key") and cfg.get("app_secret")),
    )


@router.put("/config", response_model=schemas.DropboxConfigOut)
def save_dropbox_config(payload: schemas.DropboxConfigIn, db: Session = Depends(get_db)):
    if not payload.app_key.strip() or not payload.app_secret.strip():
        raise HTTPException(status_code=400, detail="app_key and app_secret are required")
    dbx.save_config(db, app_key=payload.app_key, app_secret=payload.app_secret)
    return get_dropbox_config(db)


@router.get("/profile", response_model=schemas.DropboxProfileOut)
def get_profile(db: Session = Depends(get_db)):
    integration = db.query(models.DropboxIntegration).first()
    if not integration:
        return schemas.DropboxProfileOut(connected=False)
    return schemas.DropboxProfileOut(
        connected=True,
        display_name=integration.display_name,
        email=integration.email,
        connected_at=integration.connected_at.isoformat() if integration.connected_at else None,
    )


@router.get("/auth/login")
def auth_login(db: Session = Depends(get_db)):
    try:
        state = secrets.token_urlsafe(32)
        dbx.add_state(db, state)
        auth_url = dbx.get_auth_url(db, state=state)
    except ValueError as e:
        return RedirectResponse(url=f"/settings?dropbox_error={str(e).replace(' ', '_')}")
    return RedirectResponse(url=auth_url)


@router.get("/auth/callback")
def auth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if error:
        return RedirectResponse(url=f"/settings?dropbox_error={error}")
    if not state or not dbx.pop_state(db, state):
        return RedirectResponse(url="/settings?dropbox_error=invalid_state")
    if not code:
        return RedirectResponse(url="/settings?dropbox_error=no_code")
    try:
        _complete_auth(db, code)
    except Exception as e:
        log.error("Dropbox OAuth completion failed: %s", e)
        from urllib.parse import quote
        return RedirectResponse(url=f"/settings?dropbox_error={quote(str(e)[:400], safe='')}")
    return RedirectResponse(url="/settings?dropbox_connected=true")


def _complete_auth(db: Session, code: str) -> None:
    token_result = dbx.exchange_code_for_tokens(db, code)
    access_token = token_result["access_token"]
    refresh_token = token_result.get("refresh_token")
    expires_in = token_result.get("expires_in", 14400)
    account_id = token_result.get("account_id")

    account = {}
    try:
        account = dbx.fetch_account(access_token)
    except Exception as e:
        log.warning("Dropbox account fetch failed (non-fatal): %s", e)
    if not account_id:
        account_id = account.get("account_id") or "dropbox"

    integration = (
        db.query(models.DropboxIntegration)
        .filter(models.DropboxIntegration.dropbox_account_id == account_id)
        .first()
    )
    if not integration:
        integration = models.DropboxIntegration(dropbox_account_id=account_id)
        db.add(integration)

    dbx.store_tokens(db, integration=integration, access_token=access_token,
                     refresh_token=refresh_token, expires_in=expires_in)
    integration.display_name = (account.get("name") or {}).get("display_name")
    integration.email = account.get("email")
    db.commit()
    log.info("Dropbox account connected: %s", integration.email)


@router.delete("/auth/disconnect")
def auth_disconnect(db: Session = Depends(get_db)):
    deleted = db.query(models.DropboxIntegration).delete()
    db.commit()
    return {"deleted": deleted}
