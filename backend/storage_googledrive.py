"""
Google Drive storage backend.

Targets the encrypted DB backups at a folder in the user's Google Drive,
reusing the Google OAuth connection from the Drive/Docs integration (no
separate credentials). Only the drive.file scope is needed: the app creates
its own backup folder and files, and drive.file gives it access to exactly
those, nothing else in the user's Drive.

Token handling: the access token lives in the GoogleIntegration row, refreshed
just-in-time by google_client. We open a short-lived session per call to fetch
a valid token, the same pattern storage_backend.decrypt_secret uses, so this
backend needs no DB handle threaded in (and works on the test dry-run path).
"""

from __future__ import annotations
import json
import logging
import os
from typing import Optional

import httpx

from storage_backend import StorageBackend

log = logging.getLogger("trace.storage.googledrive")

FILES_URL = "https://www.googleapis.com/drive/v3/files"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"


class GoogleDriveBackend(StorageBackend):

    def __init__(self, remote_folder: str = "Effro Backups"):
        self._folder = (remote_folder or "Effro Backups").strip() or "Effro Backups"
        self._folder_id_cache: Optional[str] = None

    @property
    def provider_name(self) -> str:
        return "google_drive"

    # ── Auth ──────────────────────────────────────────────────────────────────
    def _token(self) -> Optional[str]:
        from database import SessionLocal
        import google_client
        db = SessionLocal()
        try:
            return google_client.get_valid_access_token(db)
        finally:
            db.close()

    def _require_token(self) -> str:
        token = self._token()
        if not token:
            raise RuntimeError(
                "Google account not connected. Connect it in Settings -> Integrations -> Google Docs first."
            )
        return token

    def _headers(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    # ── Folder resolution (find-or-create, cached) ────────────────────────────
    def _folder_id(self, token: str) -> str:
        if self._folder_id_cache:
            return self._folder_id_cache
        safe = self._folder.replace("'", "\\'")
        r = httpx.get(
            FILES_URL,
            headers=self._headers(token),
            params={
                "q": f"name='{safe}' and mimeType='{FOLDER_MIME}' and trashed=false",
                "fields": "files(id,name)",
                "spaces": "drive",
            },
            timeout=30.0,
        )
        r.raise_for_status()
        files = r.json().get("files", [])
        if files:
            self._folder_id_cache = files[0]["id"]
            return self._folder_id_cache
        # Create it.
        r = httpx.post(
            FILES_URL,
            headers={**self._headers(token), "Content-Type": "application/json"},
            params={"fields": "id"},
            content=json.dumps({"name": self._folder, "mimeType": FOLDER_MIME}).encode(),
            timeout=30.0,
        )
        r.raise_for_status()
        self._folder_id_cache = r.json()["id"]
        return self._folder_id_cache

    def _find_file(self, token: str, name: str) -> Optional[str]:
        folder_id = self._folder_id(token)
        safe = name.replace("'", "\\'")
        r = httpx.get(
            FILES_URL,
            headers=self._headers(token),
            params={
                "q": f"name='{safe}' and '{folder_id}' in parents and trashed=false",
                "fields": "files(id,name)",
            },
            timeout=30.0,
        )
        r.raise_for_status()
        files = r.json().get("files", [])
        return files[0]["id"] if files else None

    # ── Interface ─────────────────────────────────────────────────────────────
    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        token = self._require_token()
        folder_id = self._folder_id(token)
        name = os.path.basename(remote_path)

        # Overwrite a same-named file (e.g. a re-run on the same day) so we don't
        # accumulate duplicates that break the date-sorted prune.
        existing = self._find_file(token, name)
        if existing:
            try:
                httpx.delete(f"{FILES_URL}/{existing}", headers=self._headers(token), timeout=30.0)
            except Exception:
                pass

        boundary = "effro-backup-boundary-9f2a"
        metadata = {"name": name, "parents": [folder_id]}
        pre = (
            f"--{boundary}\r\n"
            "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{json.dumps(metadata)}\r\n"
            f"--{boundary}\r\n"
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        post = f"\r\n--{boundary}--".encode("utf-8")
        body = pre + data + post

        r = httpx.post(
            UPLOAD_URL,
            headers={**self._headers(token), "Content-Type": f"multipart/related; boundary={boundary}"},
            params={"uploadType": "multipart", "fields": "id,name"},
            content=body,
            timeout=180.0,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Google Drive upload failed: {r.text[:200]}")
        return name

    def download_bytes(self, remote_path: str) -> bytes:
        token = self._require_token()
        file_id = self._find_file(token, os.path.basename(remote_path))
        if not file_id:
            raise RuntimeError(f"Backup not found on Google Drive: {remote_path}")
        r = httpx.get(
            f"{FILES_URL}/{file_id}",
            headers=self._headers(token),
            params={"alt": "media"},
            timeout=180.0,
        )
        r.raise_for_status()
        return r.content

    def delete(self, remote_path: str) -> None:
        try:
            token = self._require_token()
            file_id = self._find_file(token, os.path.basename(remote_path))
            if file_id:
                httpx.delete(f"{FILES_URL}/{file_id}", headers=self._headers(token), timeout=30.0)
        except Exception:
            pass

    def list(self, prefix: str = "") -> list[str]:
        try:
            token = self._require_token()
            folder_id = self._folder_id(token)
            names: list[str] = []
            page_token = None
            while True:
                params = {
                    "q": f"'{folder_id}' in parents and trashed=false",
                    "fields": "nextPageToken, files(name)",
                    "pageSize": "200",
                }
                if page_token:
                    params["pageToken"] = page_token
                r = httpx.get(FILES_URL, headers=self._headers(token), params=params, timeout=30.0)
                r.raise_for_status()
                data = r.json()
                names.extend(f["name"] for f in data.get("files", []) if f["name"].startswith(prefix))
                page_token = data.get("nextPageToken")
                if not page_token:
                    break
            return names
        except Exception as e:
            log.warning("Google Drive list failed: %s", e)
            return []

    def test(self) -> tuple[bool, str]:
        token = self._token()
        if not token:
            return False, "Connect your Google account in Settings -> Integrations -> Google Docs first, then choose Google Drive here."
        try:
            self._folder_id(token)
            return True, f"Connected to Google Drive (backups go to the '{self._folder}' folder)."
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                return False, "Google rejected the request. Reconnect Google in Settings -> Integrations."
            return False, f"Google Drive error: {e}"
        except Exception as e:
            return False, f"Could not reach Google Drive: {e}"
