"""
Storage configuration + backup REST endpoints.

Routes (all under /api/storage):
  GET    /storage/config       - current config (no secrets)
  PUT    /storage/config       - save (encrypts the password before persisting)
  DELETE /storage/config       - disconnect, fall back to local
  POST   /storage/test         - test the currently-saved config
  POST   /storage/backup/run   - trigger an immediate backup (background)
  GET    /storage/backup/logs  - most recent 20 sync log entries
"""

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from database import get_db
from storage_backend import (
    get_storage_backend,
    build_storage_backend,
    get_storage_config_for_api,
    write_storage_config,
    _read_storage_config,
    encrypt_secret,
)

router = APIRouter(tags=["storage"])
log = logging.getLogger("effro.storage.router")


@router.get("/storage/config", response_model=schemas.StorageConfigOut)
def get_config(db: Session = Depends(get_db)):
    return get_storage_config_for_api(db)


@router.put("/storage/config", response_model=schemas.StorageConfigOut)
def save_config(payload: schemas.StorageConfig, db: Session = Depends(get_db)):
    """
    Persist a new storage config.

    Password handling:
      - Real password → encrypted with Fernet before write.
      - Masked echo (frontend sent back bullet characters) → preserve the
        stored encrypted value rather than overwriting it with bullets.
        Lets the user tweak server URL / folder without re-entering the key.
    """
    existing = _read_storage_config(db)

    is_masked = (
        payload.password
        and len(payload.password) > 0
        and set(payload.password.strip()).issubset({"•"})
    )

    config = {
        "provider": payload.provider,
        "server_url": (payload.server_url or "").rstrip("/"),
        "username": payload.username or "",
        "remote_folder": payload.remote_folder or "Effro",
        "backup_enabled": payload.backup_enabled,
        "password": (
            existing.get("password", "")
            if is_masked
            else encrypt_secret(payload.password or "", db)
        ),
    }

    write_storage_config(db, config)
    return get_storage_config_for_api(db)


@router.delete("/storage/config", response_model=schemas.StorageConfigOut)
def disconnect(db: Session = Depends(get_db)):
    """Reset to local-only storage. Does NOT delete any files on the remote."""
    write_storage_config(db, {"provider": "local"})
    return get_storage_config_for_api(db)


@router.post("/storage/test")
def test_connection(
    payload: Optional[schemas.StorageConfig] = None,
    db: Session = Depends(get_db),
):
    """
    Dry-run a connection check.

    If `payload` is supplied, build a transient backend from those values
    and test against them WITHOUT saving. This is the path the wizard takes -
    a failed test no longer corrupts the stored config (which used to make
    `is_connected` falsely report success).

    With no payload, test the currently-saved backend - used by future
    Manage-view "re-test" affordances.
    """
    if payload is not None:
        backend = build_storage_backend(payload.dict())
    else:
        backend = get_storage_backend(db)
    ok, message = backend.test()
    return {"ok": ok, "message": message, "provider": backend.provider_name}


@router.post("/storage/backup/run")
def run_backup(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Kick off an immediate backup. Runs in the background so the HTTP request
    returns instantly - the UI polls /storage/backup/logs to see the result.
    """
    config = get_storage_config_for_api(db)
    if not config["is_connected"]:
        raise HTTPException(
            status_code=400,
            detail="No remote backend connected. Configure cloud storage first."
        )
    background_tasks.add_task(_do_backup)
    return {"queued": True, "message": "Backup started - check the log in a few seconds."}


def _do_backup() -> None:
    """
    Background task entrypoint - creates its own DB session because the
    request session is closed before this runs (FastAPI tears it down once
    the response goes out).
    """
    from database import SessionLocal
    from storage_backup import run_backup as _run
    db = SessionLocal()
    try:
        _run(db)
    finally:
        db.close()


@router.get("/storage/backup/logs", response_model=list[schemas.StorageSyncLogOut])
def get_backup_logs(db: Session = Depends(get_db)):
    from models import StorageSyncLog
    return (
        db.query(StorageSyncLog)
        .order_by(StorageSyncLog.occurred_at.desc())
        .limit(20)
        .all()
    )
