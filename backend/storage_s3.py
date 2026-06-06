"""
S3-compatible storage backend.

One backend for any S3 API: Backblaze B2, Wasabi, Cloudflare R2, MinIO,
DigitalOcean Spaces, AWS S3. Auth is an access key + secret key (no OAuth).
We sign requests with SigV4 by hand over httpx, so there is no boto3 / SDK to
bundle. Path-style addressing ({endpoint}/{bucket}/{key}) for broad
compatibility with non-AWS endpoints.

Config (in storage_config): provider='s3', server_url=endpoint, bucket, region,
username=access key, password=secret key (encrypted), remote_folder=key prefix.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

import httpx

from storage_backend import StorageBackend

log = logging.getLogger("effro.storage.s3")

_EMPTY_HASH = hashlib.sha256(b"").hexdigest()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


class S3Backend(StorageBackend):

    def __init__(self, *, endpoint: str, bucket: str, region: str,
                 access_key: str, secret_key: str, prefix: str = "Effro Backups"):
        self._endpoint = (endpoint or "").rstrip("/")
        self._bucket = bucket or ""
        self._region = region or "us-east-1"
        self._ak = access_key or ""
        self._sk = secret_key or ""
        self._prefix = (prefix or "").strip().strip("/")

    @property
    def provider_name(self) -> str:
        return "s3"

    def _key(self, name: str) -> str:
        base = os.path.basename(name)
        return f"{self._prefix}/{base}" if self._prefix else base

    # ── SigV4 signed request ──────────────────────────────────────────────────
    def _request(self, method: str, *, key: str | None = None, query: dict | None = None,
                 data: bytes = b"") -> httpx.Response:
        host = urlsplit(self._endpoint).netloc
        enc_bucket = quote(self._bucket, safe="")
        if key is None:
            path = f"/{enc_bucket}"
        else:
            path = f"/{enc_bucket}/" + "/".join(quote(seg, safe="") for seg in key.split("/"))

        query = query or {}
        cqs = "&".join(
            f"{quote(k, safe='')}={quote(str(v), safe='')}"
            for k, v in sorted(query.items())
        )

        now = datetime.now(timezone.utc)
        amzdate = now.strftime("%Y%m%dT%H%M%SZ")
        datestamp = now.strftime("%Y%m%d")
        payload_hash = _sha256(data) if data else _EMPTY_HASH

        canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amzdate}\n"
        signed_headers = "host;x-amz-content-sha256;x-amz-date"
        canonical_request = f"{method}\n{path}\n{cqs}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"

        scope = f"{datestamp}/{self._region}/s3/aws4_request"
        string_to_sign = f"AWS4-HMAC-SHA256\n{amzdate}\n{scope}\n{_sha256(canonical_request.encode('utf-8'))}"

        k_date = _hmac(("AWS4" + self._sk).encode("utf-8"), datestamp)
        k_region = _hmac(k_date, self._region)
        k_service = _hmac(k_region, "s3")
        k_signing = _hmac(k_service, "aws4_request")
        signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        authorization = (
            f"AWS4-HMAC-SHA256 Credential={self._ak}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        url = f"{self._endpoint}{path}" + (f"?{cqs}" if cqs else "")
        headers = {
            "Authorization": authorization,
            "x-amz-date": amzdate,
            "x-amz-content-sha256": payload_hash,
        }
        return httpx.request(method, url, headers=headers, content=data, timeout=180.0)

    # ── Interface ─────────────────────────────────────────────────────────────
    def upload_bytes(self, data: bytes, remote_path: str) -> str:
        name = os.path.basename(remote_path)
        r = self._request("PUT", key=self._key(name), data=data)
        if r.status_code >= 400:
            raise RuntimeError(f"S3 upload failed ({r.status_code}): {r.text[:200]}")
        return name

    def download_bytes(self, remote_path: str) -> bytes:
        r = self._request("GET", key=self._key(remote_path))
        if r.status_code >= 400:
            raise RuntimeError(f"S3 download failed ({r.status_code}): {r.text[:200]}")
        return r.content

    def delete(self, remote_path: str) -> None:
        try:
            self._request("DELETE", key=self._key(remote_path))
        except Exception:
            pass

    def list(self, prefix: str = "") -> list[str]:
        try:
            full_prefix = f"{self._prefix}/{prefix}" if self._prefix else prefix
            r = self._request("GET", query={"list-type": "2", "prefix": full_prefix})
            if r.status_code >= 400:
                return []
            keys = re.findall(r"<Key>(.*?)</Key>", r.text)
            names = []
            for k in keys:
                base = k.rsplit("/", 1)[-1]
                if base.startswith(prefix):
                    names.append(base)
            return names
        except Exception as e:
            log.warning("S3 list failed: %s", e)
            return []

    def test(self) -> tuple[bool, str]:
        if not self._endpoint:
            return False, "Endpoint URL is required."
        if not self._bucket:
            return False, "Bucket name is required."
        if not self._ak or not self._sk:
            return False, "Access key and secret key are required."
        try:
            r = self._request("GET", query={"list-type": "2", "max-keys": "1"})
            if r.status_code < 400:
                return True, f"Connected to bucket '{self._bucket}'."
            if r.status_code in (401, 403):
                return False, "Access denied - check the access key, secret key, and bucket permissions."
            if r.status_code == 404:
                return False, f"Bucket '{self._bucket}' not found at this endpoint."
            return False, f"S3 error {r.status_code}: {r.text[:160]}"
        except Exception as e:
            return False, f"Could not reach the endpoint: {e}"
