"""
Encrypted database backup for Effro.

The flow (run nightly by scheduler.py, or manually via POST /storage/backup/run):
  1. sqlite3 backup() API → consistent snapshot of effro.db (safe on a live DB
     with WAL active; never use shutil.copy here).
  2. Fernet-encrypt the bytes with the per-install key from app_settings.
  3. Upload to {remote_folder}/backups/effro-backup-YYYY-MM-DD.db.enc.
  4. Log the outcome in storage_sync_logs so the UI's Manage view can show it.
  5. Prune older backups, keeping the most recent RETENTION_COUNT.

Skips cleanly when there's no remote backend configured - the nightly job
checks before getting here, but defensive too.
"""

from __future__ import annotations
import logging
import os
import sqlite3
import tempfile
from datetime import datetime, timezone

log = logging.getLogger("effro.backup")

# Keep a week's worth on the remote. Plenty for personal use; old backups
# get pruned automatically every run.
RETENTION_COUNT = 7
BACKUP_PREFIX = "effro-backup-"


def run_backup(db_session) -> dict:
    """
    Run a full encrypted backup. Returns {"status": "success"|"failed"|"skipped", ...}.
    Never raises - failures are logged + recorded in storage_sync_logs.
    """
    from database import DB_PATH
    from storage_backend import get_storage_backend, get_or_create_fernet_key
    from models import StorageSyncLog

    backend = get_storage_backend(db_session)

    if backend.provider_name == "local":
        log.info("No remote backend - skipping backup.")
        return {"status": "skipped", "reason": "No remote backend configured."}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"{BACKUP_PREFIX}{today}.db.enc"
    config_path = f"backups/{filename}"

    try:
        # ── 1. Safe SQLite snapshot via the backup API ───────────────────────
        # P3: never use shutil.copy on a live SQLite with WAL - you'll get
        # a corrupt backup. The sqlite3 connect().backup() API is the only
        # safe way to do this.
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp_path = tmp.name

        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(tmp_path)
        src.backup(dst)
        src.close()
        dst.close()

        with open(tmp_path, "rb") as f:
            raw = f.read()
        os.unlink(tmp_path)

        # ── 2. Encrypt ──────────────────────────────────────────────────────
        from cryptography.fernet import Fernet
        key = get_or_create_fernet_key(db_session)
        encrypted = Fernet(key).encrypt(raw)

        # ── 3. Upload ───────────────────────────────────────────────────────
        remote_path = backend.upload_bytes(encrypted, config_path)
        size = len(encrypted)

        # ── 4. Prune ────────────────────────────────────────────────────────
        _prune_old_backups(backend)

        # ── 5. Log success ──────────────────────────────────────────────────
        db_session.add(StorageSyncLog(
            event_type="backup",
            status="success",
            provider=backend.provider_name,
            remote_path=remote_path,
            size_bytes=size,
        ))
        db_session.commit()

        log.info("Backup complete: %s (%d bytes encrypted)", filename, size)
        return {"status": "success", "path": remote_path, "size": size}

    except Exception as e:
        log.error("Backup failed: %s", e)
        # Best-effort log - if the DB session is also dead this will silently
        # fail, but the main `log.error` already wrote stderr.
        try:
            db_session.add(StorageSyncLog(
                event_type="backup",
                status="failed",
                provider=getattr(backend, "provider_name", "unknown"),
                error_message=str(e)[:500],
            ))
            db_session.commit()
        except Exception:
            pass
        return {"status": "failed", "error": str(e)}


def _prune_old_backups(backend) -> None:
    """Keep only the most recent RETENTION_COUNT backup files on the remote."""
    try:
        all_items = backend.list(prefix=BACKUP_PREFIX)
        # YYYY-MM-DD in the filename means a plain sort gives chronological order.
        backup_items = sorted([
            p for p in all_items
            if BACKUP_PREFIX in os.path.basename(p)
        ])
        to_delete = (
            backup_items[:-RETENTION_COUNT]
            if len(backup_items) > RETENTION_COUNT
            else []
        )
        for path in to_delete:
            backend.delete(path)
            log.info("Pruned old backup: %s", path)
    except Exception as e:
        # Pruning is non-fatal - log and continue.
        log.warning("Backup pruning failed (non-fatal): %s", e)
