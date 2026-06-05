"""
Storage abstraction for Effro.

The user picks a cloud backend in Settings → Storage (currently Nextcloud,
others coming). Attachments are written locally first, then a background
task uploads them to the remote. The SQLite DB itself never syncs - only
encrypted snapshots produced by storage_backup.py go remote.

Design:
  - `StorageBackend` is the interface every adapter implements.
  - `LocalBackend` is the default fallback when nothing's configured.
  - `get_storage_backend(db)` is the factory called by routers.
  - Secrets (Nextcloud passwords) are Fernet-encrypted on write,
    decrypted on read. The key lives in the same `app_settings` table
    as the ciphertext - this protects against a backup file leaking,
    not against full DB compromise. (Documented trade-off.)
"""

from __future__ import annotations
import json
import logging
import os
from abc import ABC, abstractmethod
from sqlalchemy.orm import Session

log = logging.getLogger("trace.storage")

# Where attachments land on disk. Resolved from env so the Tauri shell can
# point it at the user-configurable data directory at startup.
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "./data/uploads")

_STORAGE_CONFIG_KEY = "storage_config"
_ENCRYPTION_KEY_SETTING = "storage_encryption_key"


# ── Interface ─────────────────────────────────────────────────────────────────

class StorageBackend(ABC):
    """Abstract base - every cloud adapter implements these five methods."""

    @abstractmethod
    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        """
        Upload `data` to `remote_path`. Returns the final remote path
        (may be normalised by the adapter). Raises RuntimeError with a
        user-readable message on failure.
        """
        ...

    @abstractmethod
    def download_bytes(self, remote_path: str) -> bytes:
        """Download a file and return its bytes."""
        ...

    @abstractmethod
    def delete(self, remote_path: str) -> None:
        """Delete a file. Silently succeeds if the file isn't there."""
        ...

    @abstractmethod
    def list(self, prefix: str = "") -> list[str]:
        """List remote paths that start with `prefix`."""
        ...

    @abstractmethod
    def test(self) -> tuple[bool, str]:
        """Quick connectivity check. Returns (ok, human-readable message)."""
        ...

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Short identifier, e.g. 'local', 'nextcloud'."""
        ...


# ── Local backend (always available) ─────────────────────────────────────────

class LocalBackend(StorageBackend):
    """
    Default backend - writes attachments to the UPLOAD_DIR on disk.
    Used when no cloud sync is configured.
    """

    def __init__(self, upload_dir: str = UPLOAD_DIR):
        self._dir = upload_dir
        os.makedirs(upload_dir, exist_ok=True)

    @property
    def provider_name(self) -> str:
        return "local"

    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        dest = os.path.join(self._dir, os.path.basename(remote_path))
        with open(dest, "wb") as f:
            f.write(data)
        return dest

    def download_bytes(self, remote_path: str) -> bytes:
        path = (
            remote_path
            if os.path.isabs(remote_path)
            else os.path.join(self._dir, remote_path)
        )
        with open(path, "rb") as f:
            return f.read()

    def delete(self, remote_path: str) -> None:
        path = (
            remote_path
            if os.path.isabs(remote_path)
            else os.path.join(self._dir, remote_path)
        )
        try:
            os.remove(path)
        except FileNotFoundError:
            pass

    def list(self, prefix: str = "") -> list[str]:
        return [
            os.path.join(self._dir, f)
            for f in os.listdir(self._dir)
            if f.startswith(prefix)
        ]

    def test(self) -> tuple[bool, str]:
        if os.path.isdir(self._dir):
            return True, f"Local storage active at {self._dir}"
        return False, f"Upload directory not found: {self._dir}"


# ── Factory ───────────────────────────────────────────────────────────────────

def get_storage_backend(db: Session) -> StorageBackend:
    """
    Resolve the active backend for the current SAVED config.
    Routers call this on every request - cheap because config is just a JSON
    row in app_settings.
    """
    return build_storage_backend(_read_storage_config(db))


def build_storage_backend(config: dict) -> StorageBackend:
    """
    Build a backend from any config dict - no DB read.

    Used by the test endpoint so we can dry-run a user's input without
    saving it to the DB first. Critical: without this split, a failed
    Test would still persist the (bad) config, then `is_connected`
    would falsely report a working connection on the next page load.

    Password handling: if the supplied password starts with "gAAAAA" it's
    a Fernet token we wrote ourselves (already in app_settings) - decrypt.
    Otherwise treat as plaintext from a form field.
    """
    provider = config.get("provider", "local")

    if provider == "nextcloud":
        # Lazy import - webdavclient3 isn't loaded unless Nextcloud is in use,
        # which keeps cold-start time tighter for local-only installs.
        from storage_nextcloud import NextcloudBackend
        raw_password = config.get("password", "") or ""
        password = decrypt_secret(raw_password) if raw_password.startswith("gAAAAA") else raw_password
        return NextcloudBackend(
            server_url=config.get("server_url", ""),
            username=config.get("username", ""),
            password=password,
            remote_folder=config.get("remote_folder", "Effro"),
        )

    if provider == "google_drive":
        # Reuses the Google OAuth connection - no secrets in the storage config.
        from storage_googledrive import GoogleDriveBackend
        return GoogleDriveBackend(remote_folder=config.get("remote_folder", "Effro Backups"))

    return LocalBackend(UPLOAD_DIR)


# ── Config helpers ────────────────────────────────────────────────────────────

def _read_storage_config(db: Session) -> dict:
    """Internal - returns the raw config dict (with encrypted password)."""
    from models import AppSettings
    row = db.query(AppSettings).filter(AppSettings.key == _STORAGE_CONFIG_KEY).first()
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


def write_storage_config(db: Session, config: dict) -> None:
    """Persist the storage config. Caller is responsible for encrypting secrets first."""
    from models import AppSettings
    row = db.query(AppSettings).filter(AppSettings.key == _STORAGE_CONFIG_KEY).first()
    if row:
        row.value = json.dumps(config)
    else:
        db.add(AppSettings(key=_STORAGE_CONFIG_KEY, value=json.dumps(config)))
    db.commit()


def get_storage_config_for_api(db: Session) -> dict:
    """
    API-safe view of the storage config - no raw passwords, plus the
    timestamp + status of the most recent backup so the UI can render
    a "Backed up <date>" hint without a second round-trip.
    """
    config = _read_storage_config(db)
    from models import StorageSyncLog
    last = (
        db.query(StorageSyncLog)
        .filter(StorageSyncLog.event_type == "backup")
        .order_by(StorageSyncLog.occurred_at.desc())
        .first()
    )
    return {
        "provider": config.get("provider", "local"),
        "is_connected": config.get("provider", "local") != "local",
        "remote_folder": config.get("remote_folder", "Effro"),
        "backup_enabled": config.get("backup_enabled", True),
        "server_url": config.get("server_url"),
        "username": config.get("username"),
        "last_backup_at": last.occurred_at.isoformat() if last else None,
        "last_backup_status": last.status if last else None,
    }


# ── Encryption helpers ────────────────────────────────────────────────────────
# Fernet symmetric encryption. The key is generated on first use and stored
# in app_settings alongside the encrypted values.
#
# Trust model: key and ciphertext live in the same SQLite file, so this
# protects against casual inspection of a backup file sitting in a Nextcloud
# folder - NOT against an attacker with full DB access. Documented so we
# don't accidentally trust it for more than it gives us.

def get_or_create_fernet_key(db: Session) -> bytes:
    """Return the persistent encryption key, generating one on first use."""
    from models import AppSettings
    from cryptography.fernet import Fernet
    row = (
        db.query(AppSettings)
        .filter(AppSettings.key == _ENCRYPTION_KEY_SETTING)
        .first()
    )
    if row and row.value:
        return row.value.encode()
    key = Fernet.generate_key()
    db.add(AppSettings(key=_ENCRYPTION_KEY_SETTING, value=key.decode()))
    db.commit()
    return key


def encrypt_secret(value: str, db: Session) -> str:
    """Encrypt a secret string. Empty input → empty output (don't encrypt nothing)."""
    if not value:
        return ""
    from cryptography.fernet import Fernet
    key = get_or_create_fernet_key(db)
    return Fernet(key).encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    """
    Decrypt a Fernet token, or pass through if it doesn't look encrypted.

    All Fernet tokens begin with 'gAAAAA' (version byte + base64 padding) -
    we use that as the detection heuristic so values stored before encryption
    was added still round-trip cleanly.
    """
    if not value or not value.startswith("gAAAAA"):
        return value
    try:
        from cryptography.fernet import Fernet
        from database import SessionLocal
        from models import AppSettings
        db = SessionLocal()
        try:
            row = (
                db.query(AppSettings)
                .filter(AppSettings.key == _ENCRYPTION_KEY_SETTING)
                .first()
            )
            if not row:
                return value
            return Fernet(row.value.encode()).decrypt(value.encode()).decode()
        finally:
            db.close()
    except Exception:
        return value
