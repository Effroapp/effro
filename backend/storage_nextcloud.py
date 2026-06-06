"""
Nextcloud storage backend (WebDAV via webdavclient3).

Auth: Nextcloud **app passwords** (Settings → Security → App passwords),
never the account login password. App passwords are scoped + revocable
and they work alongside 2FA without prompting.

Layout on the remote server (under the user-configured folder):
  Effro/attachments/<stored_name>
  Effro/backups/effro-backup-YYYY-MM-DD.db.enc
"""

from __future__ import annotations
import logging
import os
import tempfile

from storage_backend import StorageBackend

log = logging.getLogger("effro.storage.nextcloud")


class NextcloudBackend(StorageBackend):

    def __init__(
        self,
        server_url: str,
        username: str,
        password: str,
        remote_folder: str = "Effro",
    ):
        self._url = server_url.rstrip("/")
        self._username = username
        self._password = password
        self._folder = remote_folder

    @property
    def provider_name(self) -> str:
        return "nextcloud"

    def _client(self):
        """Build a fresh WebDAV client. Cheap - no connection pooling needed."""
        from webdav3.client import Client
        return Client({
            "webdav_hostname": f"{self._url}/remote.php/dav/files/{self._username}",
            "webdav_login": self._username,
            "webdav_password": self._password,
            "webdav_timeout": 30,
        })

    def _ensure_folder(self, client, path: str) -> None:
        """Create a folder and its parents idempotently - webdav has no mkdir -p."""
        parts = path.strip("/").split("/")
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else part
            try:
                if not client.check(current):
                    client.mkdir(current)
            except Exception:
                # Already exists or transient permission noise - continue.
                pass

    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        # P1: webdavclient3 uploads from a file PATH, not from bytes. We stage
        # to a temp file, upload, then unlink. The `finally` block guarantees
        # the temp file is cleaned up even if the upload raises.
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
            client = self._client()
            client.clean(remote_path)
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
        """
        Quick reachability + auth check. Translates the most common WebDAV
        errors into something a human can act on.
        """
        if not self._url:
            return False, "Server URL is required."
        if not self._username:
            return False, "Username is required."
        if not self._password:
            return False, "App password is required."
        try:
            client = self._client()
            # Checking the user's WebDAV root is fast and reliably authenticated.
            reachable = client.check("/")
            if reachable:
                return True, f"Connected to Nextcloud at {self._url}"
            return False, "Connected but could not verify access - check the username."
        except Exception as e:
            msg = str(e).lower()
            if "401" in msg or "unauthorized" in msg:
                return False, "Invalid username or app password. Check your Nextcloud Security settings."
            if "502" in msg or "503" in msg or "504" in msg:
                # Proxy got a bad/empty response from the upstream - Nextcloud
                # itself is down, restarting, or your reverse proxy isn't
                # forwarding WebDAV methods (PROPFIND, etc.).
                return False, f"{self._url} is reachable but its upstream returned an error. Is Nextcloud running? If you're behind a reverse proxy, make sure it forwards WebDAV methods."
            if "connection" in msg or "refused" in msg or "timeout" in msg:
                return False, f"Could not reach {self._url} - check the server URL and your network."
            if "404" in msg:
                return False, f"{self._url} does not look like a Nextcloud server - check the URL."
            return False, f"Nextcloud error: {e}"
