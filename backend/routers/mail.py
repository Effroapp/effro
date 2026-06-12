"""
Mail router - flagged messages from any IMAP mailbox become Signals.

Credential-based (host + username + app password), like iCloud. Read-only
against the mailbox; flag an email in any client to send it to Effro.

  GET    /mail/config       - host/username + password masked + is_configured
  PUT    /mail/config       - persist the mailbox details
  GET    /mail/profile      - connected + username + host + last_synced
  POST   /mail/test         - verify the sign-in
  DELETE /mail/disconnect   - clear the credentials
  POST   /mail/sync-now     - pull flagged mail into Signals
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
import mail_client as mc
from database import get_db

log = logging.getLogger("effro.routers.mail")
router = APIRouter(prefix="/mail", tags=["mail"])


@router.get("/config", response_model=schemas.MailConfigOut)
def get_mail_config(db: Session = Depends(get_db)):
    cfg = mc.get_config(db)
    pwd = cfg.get("password") or ""
    masked = ("•" * 8 + pwd[-4:]) if len(pwd) >= 4 else ("•" * 8 if pwd else None)
    return schemas.MailConfigOut(
        host=cfg.get("host"), port=cfg.get("port"), username=cfg.get("username"),
        password_masked=masked,
        is_configured=bool(cfg.get("host") and cfg.get("username") and pwd),
    )


@router.put("/config", response_model=schemas.MailConfigOut)
def save_mail_config(payload: schemas.MailConfigIn, db: Session = Depends(get_db)):
    if not payload.host.strip() or not payload.username.strip() or not payload.password.strip():
        raise HTTPException(status_code=400, detail="host, username and password are required")
    mc.save_config(db, host=payload.host, username=payload.username,
                   password=payload.password, port=payload.port)
    return get_mail_config(db)


@router.get("/profile", response_model=schemas.MailProfileOut)
def get_profile(db: Session = Depends(get_db)):
    cfg = mc.get_config(db)
    if not (cfg.get("host") and cfg.get("username") and cfg.get("password")):
        return schemas.MailProfileOut(connected=False)
    return schemas.MailProfileOut(
        connected=True, username=cfg.get("username"), host=cfg.get("host"),
        last_synced=cfg.get("last_synced"),
    )


@router.post("/test")
def test_mail(db: Session = Depends(get_db)):
    ok, message = mc.test_connection(db)
    return {"ok": ok, "message": message}


@router.delete("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    mc.clear_config(db)
    return {"ok": True}


@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    from services_mail import run_mail_sync
    return run_mail_sync(db)
