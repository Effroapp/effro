"""
Dropbox storage backend - encrypted DB backups to a folder in the user's
Dropbox, via the Dropbox HTTP content API. Reuses the Dropbox OAuth connection
(dropbox_client); the access token is fetched just-in-time per call, so this
backend needs no DB handle threaded in and works on the test dry-run path.

Recommend a Dropbox app with "App folder" access in the setup guide, so Effro
only ever sees its own folder, nothing else in the user's Dropbox.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

import httpx

from storage_backend import StorageBackend

log = logging.getLogger("trace.storage.dropbox")

UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload"
DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download"
DELETE_URL = "https://api.dropboxapi.com/2/files/delete_v2"
LIST_URL = "https://api.dropboxapi.com/2/files/list_folder"


class DropboxBackend(StorageBackend):

    def __init__(self, remote_folder: str = "Effro Backups"):
        folder = (remote_folder or "Effro Backups").strip().strip("/") or "Effro Backups"
        self._folder = folder

    @property
    def provider_name(self) -> str:
        return "dropbox"

    def _token(self) -> Optional[str]:
        from database import SessionLocal
        import dropbox_client
        db = SessionLocal()
        try:
            return dropbox_client.get_valid_access_token(db)
        finally:
            db.close()

    def _require_token(self) -> str:
        token = self._token()
        if not token:
            raise RuntimeError(
                "Dropbox not connected. Connect it in Settings -> Storage -> Dropbox first."
            )
        return token

    def _path(self, name: str) -> str:
        return f"/{self._folder}/{os.path.basename(name)}"

    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        token = self._require_token()
        name = os.path.basename(remote_path)
        arg = {"path": self._path(name), "mode": "overwrite", "autorename": False, "mute": True}
        r = httpx.post(
            UPLOAD_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Dropbox-API-Arg": json.dumps(arg),
                "Content-Type": "application/octet-stream",
            },
            content=data,
            timeout=180.0,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Dropbox upload failed: {r.text[:200]}")
        return name

    def download_bytes(self, remote_path: str) -> bytes:
        token = self._require_token()
        r = httpx.post(
            DOWNLOAD_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Dropbox-API-Arg": json.dumps({"path": self._path(remote_path)}),
            },
            timeout=180.0,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Dropbox download failed: {r.text[:200]}")
        return r.content

    def delete(self, remote_path: str) -> None:
        try:
            token = self._require_token()
            httpx.post(
                DELETE_URL,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                content=json.dumps({"path": self._path(remote_path)}),
                timeout=30.0,
            )
        except Exception:
            pass

    def list(self, prefix: str = "") -> list[str]:
        try:
            token = self._require_token()
            r = httpx.post(
                LIST_URL,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                content=json.dumps({"path": f"/{self._folder}"}),
                timeout=30.0,
            )
            if r.status_code >= 400:
                # path/not_found just means the folder has no backups yet.
                return []
            entries = r.json().get("entries", [])
            return [e["name"] for e in entries if e.get("name", "").startswith(prefix)]
        except Exception as e:
            log.warning("Dropbox list failed: %s", e)
            return []

    def test(self) -> tuple[bool, str]:
        token = self._token()
        if not token:
            return False, "Connect your Dropbox account below first, then test again."
        try:
            import dropbox_client
            account = dropbox_client.fetch_account(token)
            email = account.get("email") or "your account"
            return True, f"Connected to Dropbox as {email} (backups go to the '{self._folder}' folder)."
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                return False, "Dropbox rejected the request. Reconnect Dropbox below."
            return False, f"Dropbox error: {e}"
        except Exception as e:
            return False, f"Could not reach Dropbox: {e}"
