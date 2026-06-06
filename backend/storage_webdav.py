"""
Generic WebDAV storage backend.

Same machinery as the Nextcloud backend, but the user gives the full WebDAV
collection URL directly (e.g. a Synology, ownCloud, or Box WebDAV endpoint)
instead of us constructing the Nextcloud-specific /remote.php/dav path.
"""
from __future__ import annotations
import logging
import os
import tempfile

from storage_backend import StorageBackend

log = logging.getLogger("effro.storage.webdav")


class WebDAVBackend(StorageBackend):

    def __init__(self, server_url: str, username: str, password: str, remote_folder: str = "Effro"):
        self._url = server_url.rstrip("/")
        self._username = username
        self._password = password
        self._folder = remote_folder

    @property
    def provider_name(self) -> str:
        return "webdav"

    def _client(self):
        from webdav3.client import Client
        return Client({
            "webdav_hostname": self._url,
            "webdav_login": self._username,
            "webdav_password": self._password,
            "webdav_timeout": 30,
        })

    def _ensure_folder(self, client, path: str) -> None:
        parts = path.strip("/").split("/")
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else part
            try:
                if not client.check(current):
                    client.mkdir(current)
            except Exception:
                pass

    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        client = self._client()
        parent = "/".join(remote_path.split("/")[:-1])
        if parent:
            self._ensure_folder(client, parent)
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            client.upload_sync(remote_path=remote_path, local_path=tmp_path)
        finally:
            os.unlink(tmp_path)
        return remote_path

    def download_bytes(self, remote_path: str) -> bytes:
        client = self._client()
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name
        try:
            client.download_sync(remote_path=remote_path, local_path=tmp_path)
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            os.unlink(tmp_path)

    def delete(self, remote_path: str) -> None:
        try:
            self._client().clean(remote_path)
        except Exception:
            pass

    def list(self, prefix: str = "") -> list[str]:
        try:
            client = self._client()
            folder = self._folder
            items = client.list(folder)
            return [f"{folder}/{i}" for i in items if i.startswith(prefix)]
        except Exception:
            return []

    def test(self) -> tuple[bool, str]:
        if not self._url:
            return False, "WebDAV URL is required."
        if not self._username:
            return False, "Username is required."
        if not self._password:
            return False, "Password is required."
        try:
            client = self._client()
            if client.check("/"):
                return True, f"Connected to WebDAV at {self._url}"
            return False, "Connected but could not verify access - check the username and path."
        except Exception as e:
            msg = str(e).lower()
            if "401" in msg or "unauthorized" in msg:
                return False, "Invalid username or password."
            if "connection" in msg or "refused" in msg or "timeout" in msg:
                return False, f"Could not reach {self._url} - check the URL and your network."
            return False, f"WebDAV error: {e}"
