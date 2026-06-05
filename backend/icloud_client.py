"""
iCloud client - Calendar over CalDAV and Apple Mail over IMAP.

Apple has no OAuth for consumer iCloud, so auth is the user's Apple ID plus an
app-specific password (appleid.apple.com -> Sign-In and Security -> App-Specific
Passwords). Credentials live encrypted in app_settings; there is no token to
refresh. No heavy deps: CalDAV is raw httpx + stdlib ElementTree, mail is
stdlib imaplib.
"""
from __future__ import annotations

import email
import imaplib
import json
import logging
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy.orm import Session

import models

log = logging.getLogger("trace.icloud")

CALDAV_ROOT = "https://caldav.icloud.com"
IMAP_HOST = "imap.mail.me.com"

_ICLOUD_CONFIG_KEY = "icloud_config"
_NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav"}


# ─── Config ──────────────────────────────────────────────────────────────────

def get_config(db: Session) -> dict:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _ICLOUD_CONFIG_KEY).first()
    if not row or not row.value:
        return {}
    try:
        cfg = json.loads(row.value)
        if cfg.get("app_password"):
            from storage_backend import decrypt_secret
            cfg["app_password"] = decrypt_secret(cfg["app_password"])
        return cfg
    except Exception as e:
        log.warning("iCloud config parse failed: %s", e)
        return {}


def save_config(db: Session, *, apple_id: str, app_password: str) -> None:
    from storage_backend import encrypt_secret
    payload = {"apple_id": apple_id.strip(), "app_password": encrypt_secret(app_password.strip(), db)}
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _ICLOUD_CONFIG_KEY).first()
    if row:
        row.value = json.dumps(payload)
    else:
        db.add(models.AppSettings(key=_ICLOUD_CONFIG_KEY, value=json.dumps(payload)))
    db.commit()


def clear_config(db: Session) -> None:
    db.query(models.AppSettings).filter(models.AppSettings.key == _ICLOUD_CONFIG_KEY).delete()
    db.commit()


def set_last_synced(db: Session, iso: str) -> None:
    """Stamp last_synced without touching the encrypted password."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _ICLOUD_CONFIG_KEY).first()
    if not row or not row.value:
        return
    try:
        data = json.loads(row.value)
    except Exception:
        return
    data["last_synced"] = iso
    row.value = json.dumps(data)
    db.commit()


def _creds(db: Session):
    cfg = get_config(db)
    return cfg.get("apple_id"), cfg.get("app_password")


# ─── CalDAV ──────────────────────────────────────────────────────────────────

def _propfind(client: httpx.Client, url: str, body: str, depth: str = "0") -> ET.Element:
    r = client.request(
        "PROPFIND", url,
        headers={"Depth": depth, "Content-Type": "application/xml; charset=utf-8"},
        content=body.encode("utf-8"),
    )
    r.raise_for_status()
    return ET.fromstring(r.text)


def _discover_calendars(client: httpx.Client) -> list[str]:
    """current-user-principal -> calendar-home-set -> calendar collections."""
    # 1. principal
    tree = _propfind(client, CALDAV_ROOT + "/", (
        '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
    ))
    href = tree.find(".//d:current-user-principal/d:href", _NS)
    if href is None or not href.text:
        return []
    principal_url = urljoin(CALDAV_ROOT + "/", href.text)

    # 2. calendar-home-set
    tree = _propfind(client, principal_url, (
        '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        '<d:prop><c:calendar-home-set/></d:prop></d:propfind>'
    ))
    home = tree.find(".//c:calendar-home-set/d:href", _NS)
    if home is None or not home.text:
        return []
    home_url = urljoin(principal_url, home.text)

    # 3. list calendar collections (resourcetype contains <calendar/>)
    tree = _propfind(client, home_url, (
        '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        '<d:prop><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>'
    ), depth="1")
    cals = []
    for resp in tree.findall(".//d:response", _NS):
        rt = resp.find(".//d:resourcetype", _NS)
        if rt is None or rt.find("c:calendar", _NS) is None:
            continue
        # only calendars that hold events
        comps = [c.get("name") for c in resp.findall(".//c:supported-calendar-component-set/c:comp", _NS)]
        if comps and "VEVENT" not in comps:
            continue
        h = resp.find("d:href", _NS)
        if h is not None and h.text:
            cals.append(urljoin(home_url, h.text))
    return cals


def fetch_calendar_events(db: Session, *, days_ahead: int = 7) -> list[dict]:
    apple_id, app_password = _creds(db)
    if not apple_id or not app_password:
        return []
    now = datetime.now(timezone.utc)
    start = now.strftime("%Y%m%dT%H%M%SZ")
    end = (now + timedelta(days=days_ahead)).strftime("%Y%m%dT%H%M%SZ")
    report = (
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        '<d:prop><c:calendar-data><c:expand start="%s" end="%s"/></c:calendar-data></d:prop>'
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
        '<c:time-range start="%s" end="%s"/>'
        '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'
    ) % (start, end, start, end)

    events: list[dict] = []
    with httpx.Client(auth=(apple_id, app_password), timeout=30.0, follow_redirects=True) as client:
        for cal_url in _discover_calendars(client):
            try:
                r = client.request(
                    "REPORT", cal_url,
                    headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
                    content=report.encode("utf-8"),
                )
                if r.status_code >= 400:
                    continue
                tree = ET.fromstring(r.text)
                for cdata in tree.findall(".//c:calendar-data", _NS):
                    if cdata.text:
                        events.extend(_parse_vevents(cdata.text))
            except Exception as e:
                log.warning("iCloud calendar REPORT failed for %s: %s", cal_url, e)
    return events


def _parse_vevents(ics: str) -> list[dict]:
    """Minimal iCalendar VEVENT parser (lines already expanded by the server)."""
    # Unfold folded lines (continuation lines start with a space/tab).
    ics = re.sub(r"\r\n[ \t]", "", ics).replace("\r\n", "\n")
    out = []
    for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", ics, re.DOTALL):
        props = {}
        for line in block.strip().split("\n"):
            if ":" not in line:
                continue
            name, value = line.split(":", 1)
            key = name.split(";", 1)[0].upper()
            props[key] = (name, value.strip())
        start_dt, all_day = _parse_ics_dt(props.get("DTSTART"))
        end_dt, _ = _parse_ics_dt(props.get("DTEND"))
        out.append({
            "uid": (props.get("UID", ("", ""))[1]) or None,
            "summary": (props.get("SUMMARY", ("", ""))[1]) or "(no title)",
            "start": start_dt,
            "end": end_dt,
            "all_day": all_day,
            "location": (props.get("LOCATION", ("", ""))[1]) or None,
            "organizer": _clean_organizer(props.get("ORGANIZER")),
        })
    return out


def _clean_organizer(prop) -> Optional[str]:
    if not prop:
        return None
    name, value = prop
    m = re.search(r"CN=([^;:]+)", name)
    if m:
        return m.group(1)
    return value.replace("mailto:", "") or None


def _parse_ics_dt(prop):
    """(naive-UTC datetime, all_day) from an iCalendar DTSTART/DTEND property."""
    if not prop:
        return None, False
    name, value = prop
    params = name.upper()
    try:
        if "VALUE=DATE" in params and "VALUE=DATE-TIME" not in params:
            return datetime.strptime(value, "%Y%m%d"), True
        if value.endswith("Z"):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ"), False
        # Floating or TZID local time -> interpret via TZID if present.
        naive = datetime.strptime(value, "%Y%m%dT%H%M%S")
        m = re.search(r"TZID=([^;:]+)", name)
        if m:
            try:
                from zoneinfo import ZoneInfo
                aware = naive.replace(tzinfo=ZoneInfo(m.group(1)))
                return aware.astimezone(timezone.utc).replace(tzinfo=None), False
            except Exception:
                return naive, False
        return naive, False
    except Exception:
        return None, False


# ─── IMAP (Apple Mail) ───────────────────────────────────────────────────────

def fetch_flagged_mail(db: Session, *, limit: int = 25) -> list[dict]:
    apple_id, app_password = _creds(db)
    if not apple_id or not app_password:
        return []
    out = []
    try:
        M = imaplib.IMAP4_SSL(IMAP_HOST, 993)
        M.login(apple_id, app_password)
        try:
            M.select("INBOX", readonly=True)
            typ, data = M.search(None, "FLAGGED")
            if typ == "OK":
                ids = data[0].split()[-limit:]
                if ids:
                    typ, msgs = M.fetch(b",".join(ids), "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)])")
                    for part in msgs:
                        if not isinstance(part, tuple):
                            continue
                        hdr = email.message_from_bytes(part[1])
                        out.append({
                            "uid": _decode_header(hdr.get("Message-ID")) or None,
                            "subject": _decode_header(hdr.get("Subject")) or "(no subject)",
                            "sender": _decode_header(hdr.get("From")),
                            "date": hdr.get("Date"),
                        })
        finally:
            try:
                M.logout()
            except Exception:
                pass
    except Exception as e:
        log.warning("iCloud IMAP fetch failed: %s", e)
    return out


def _decode_header(raw) -> Optional[str]:
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
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt and dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


# ─── Connectivity test ───────────────────────────────────────────────────────

def test_connection(db: Session) -> tuple[bool, str]:
    apple_id, app_password = _creds(db)
    if not apple_id or not app_password:
        return False, "Apple ID and app-specific password are required."
    # CalDAV principal check
    try:
        with httpx.Client(auth=(apple_id, app_password), timeout=20.0, follow_redirects=True) as client:
            r = client.request(
                "PROPFIND", CALDAV_ROOT + "/",
                headers={"Depth": "0", "Content-Type": "application/xml; charset=utf-8"},
                content=b'<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
            )
            if r.status_code in (401, 403):
                return False, "Apple rejected the credentials. Use an app-specific password, not your normal Apple ID password."
            if r.status_code >= 400:
                return False, f"iCloud calendar error: HTTP {r.status_code}"
    except Exception as e:
        return False, f"Could not reach iCloud calendar: {e}"
    # IMAP login check
    try:
        M = imaplib.IMAP4_SSL(IMAP_HOST, 993)
        try:
            M.login(apple_id, app_password)
        finally:
            try:
                M.logout()
            except Exception:
                pass
    except Exception:
        return True, "Calendar connected. Mail sign-in failed - check the app password allows Mail, or calendar-only is fine."
    return True, f"Connected to iCloud as {apple_id}."
