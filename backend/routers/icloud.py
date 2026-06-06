"""
iCloud router - Calendar (CalDAV) + Apple Mail (IMAP) integration.

Credential-based (Apple ID + app-specific password), not OAuth, so there is no
auth redirect flow - just save/test the credentials.

  GET    /icloud/config        - apple_id + masked password, is_configured
  PUT    /icloud/config        - persist Apple ID + app password
  GET    /icloud/profile       - connected + apple_id + last_synced
  POST   /icloud/test          - verify CalDAV + IMAP login
  DELETE /icloud/disconnect    - clear credentials
  POST   /icloud/sync-now      - pull Calendar + flagged Mail into Signals
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
import icloud_client as ic
from database import get_db

log = logging.getLogger("effro.routers.icloud")
router = APIRouter(prefix="/icloud", tags=["icloud"])


@router.get("/config", response_model=schemas.IcloudConfigOut)
def get_icloud_config(db: Session = Depends(get_db)):
    cfg = ic.get_config(db)
    pw = cfg.get("app_password") or ""
    masked = ("•" * 8 + pw[-4:]) if len(pw) >= 4 else ("•" * 8 if pw else None)
    return schemas.IcloudConfigOut(
        apple_id=cfg.get("apple_id"),
        app_password_masked=masked,
        is_configured=bool(cfg.get("apple_id") and cfg.get("app_password")),
    )


@router.put("/config", response_model=schemas.IcloudConfigOut)
def save_icloud_config(payload: schemas.IcloudConfigIn, db: Session = Depends(get_db)):
    if not payload.apple_id.strip() or not payload.app_password.strip():
        raise HTTPException(status_code=400, detail="apple_id and app_password are required")
    ic.save_config(db, apple_id=payload.apple_id, app_password=payload.app_password)
    return get_icloud_config(db)


@router.get("/profile", response_model=schemas.IcloudProfileOut)
def get_profile(db: Session = Depends(get_db)):
    cfg = ic.get_config(db)
    if not (cfg.get("apple_id") and cfg.get("app_password")):
        return schemas.IcloudProfileOut(connected=False)
    return schemas.IcloudProfileOut(
        connected=True, apple_id=cfg.get("apple_id"), last_synced=cfg.get("last_synced"),
    )


@router.post("/test")
def test_icloud(db: Session = Depends(get_db)):
    ok, message = ic.test_connection(db)
    return {"ok": ok, "message": message}


@router.delete("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    ic.clear_config(db)
    return {"ok": True}


@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    from services_icloud import run_icloud_sync
    return run_icloud_sync(db)
