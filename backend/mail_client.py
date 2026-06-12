"""
Mail client - flagged messages from any IMAP mailbox become Signals.

Generic counterpart to the iCloud Mail integration: point it at any IMAP
server (Fastmail, Gmail, an Outlook mailbox, self-hosted...) with the host,
username and an app password. Like iCloud and Gmail, only FLAGGED mail is
pulled - flagging (starring) an email is the deliberate "send this to Effro"
gesture, so the triage feed stays calm instead of mirroring a whole inbox.

Credentials are stored Fernet-encrypted in app_settings. All reads use
BODY.PEEK over a readonly mailbox, so nothing in the mailbox is ever changed.
"""
from __future__ import annotations

import email
import email.header
import imaplib
import logging
import ssl
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Optional

from sqlalchemy.orm import Session

import integration_config
import mail_body

log = logging.getLogger("effro.mail")

_MAIL_CONFIG_KEY = "mail_config"
DEFAULT_PORT = 993


# ─── Config (shared store, password encrypted at rest) ───────────────────────

def get_config(db: Session) -> dict:
    return integration_config.load(db, _MAIL_CONFIG_KEY, secret_fields=("password",))


def save_config(db: Session, *, host: str, username: str, password: str,
                port: Optional[int] = None) -> None:
    values = {
        "host": host.strip(),
        "username": username.strip(),
        "password": password,
    }
    if port:                       # omitted -> keep the stored port (or the 993 default)
        values["port"] = int(port)
    integration_config.save(db, _MAIL_CONFIG_KEY, values, secret_fields=("password",))


def clear_config(db: Session) -> None:
    integration_config.clear(db, _MAIL_CONFIG_KEY)


def set_meta(db: Session, **fields) -> None:
    """Stamp non-secret fields (last_synced) without touching the password."""
    integration_config.set_meta(db, _MAIL_CONFIG_KEY, **fields)


def _creds(db: Session) -> tuple[Optional[str], Optional[int], Optional[str], Optional[str]]:
    cfg = get_config(db)
    return cfg.get("host"), cfg.get("port") or DEFAULT_PORT, cfg.get("username"), cfg.get("password")


# ─── IMAP ────────────────────────────────────────────────────────────────────

def _tls() -> ssl.SSLContext:
    """A verifying TLS context. The stdlib's imaplib does NOT verify server
    certificates by default before Python 3.13, which would let a middlebox
    read the app password - never connect without this."""
    return ssl.create_default_context()


def _decode_header(raw) -> Optional[str]:
    """Decode an RFC 2047 header (=?UTF-8?B?...?=) to readable text."""
    if not raw:
        return None
    try:
        parts = email.header.decode_header(raw)
        return "".join(
            (b.decode(enc or "utf-8", "replace") if isinstance(b, bytes) else b)
            for b, enc in parts
        )
    except Exception:
        return str(raw)


def parse_mail_date(s: Optional[str]) -> Optional[datetime]:
    """RFC 2822 Date header -> naive LOCAL wall-clock. Signal starts_at follows
    the meeting_at convention (displayed as-is, feeds Entry.meeting_at on
    accept), unlike created_at which is naive UTC."""
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt and dt.tzinfo:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def fetch_flagged_mail(db: Session, *, limit: int = 25) -> list[dict]:
    """The most recent flagged messages: headers plus a clean text body (see
    mail_body.extract_body) and attachment names. Fetched with a partial PEEK
    (first 256 KB - text parts come first; pulling whole messages would drag
    attachment megabytes). Read-only, so the mailbox is never modified;
    failures return [] and the sync just skips."""
    host, port, username, password = _creds(db)
    if not host or not username or not password:
        return []
    out = []
    try:
        M = imaplib.IMAP4_SSL(host, port, ssl_context=_tls())
        try:
            M.login(username, password)
            M.select("INBOX", readonly=True)
            typ, data = M.search(None, "FLAGGED")
            if typ == "OK":
                ids = data[0].split()[-limit:]
                if ids:
                    typ, msgs = M.fetch(b",".join(ids), "(BODY.PEEK[]<0.262144>)")
                    for part in msgs:
                        if not isinstance(part, tuple):
                            continue
                        msg = email.message_from_bytes(part[1])
                        body, attachments = mail_body.extract_body(msg)
                        out.append({
                            "uid": _decode_header(msg.get("Message-ID")) or None,
                            "subject": _decode_header(msg.get("Subject")) or "(no subject)",
                            "sender": _decode_header(msg.get("From")),
                            "date": msg.get("Date"),
                            "body": body,
                            "attachments": attachments,
                        })
        finally:
            try:
                M.logout()
            except Exception:
                pass
    except Exception as e:
        log.warning("Mail IMAP fetch failed: %s", e)
    return out


def test_connection(db: Session) -> tuple[bool, str]:
    host, port, username, password = _creds(db)
    if not host or not username or not password:
        return False, "An IMAP host, username and app password are required."
    try:
        M = imaplib.IMAP4_SSL(host, port, ssl_context=_tls())
        try:
            M.login(username, password)
        finally:
            try:
                M.logout()
            except Exception:
                pass
    except imaplib.IMAP4.error as e:
        return False, f"The mail server rejected the sign-in: {e}"
    except Exception as e:
        return False, f"Could not reach {host}: {e}"
    return True, f"Connected to {host} as {username}."
